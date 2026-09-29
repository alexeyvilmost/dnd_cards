package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"dnd-cards-backend/audiopresentation"
)

// The approved, longer compositions are frozen separately from the original
// sound and music migration. Revisions of the presentation catalog must not
// change a migration that may already have run on another installation.
//
//go:embed audio_291_seed.json
var audio291Seed []byte

func decodeExpandedMusic291(source []byte) ([]audiopresentation.Cue, error) {
	baseline, err := audiopresentation.Decode(audio289Seed)
	if err != nil {
		return nil, fmt.Errorf("decode frozen original music catalog: %w", err)
	}
	if baseline.Music == nil {
		return nil, fmt.Errorf("frozen original music catalog has no music assignments")
	}
	expected := map[string]string{}
	for _, key := range []string{baseline.Music.Site, baseline.Music.Run} {
		expected[key] = ""
	}
	for _, key := range baseline.Music.Battles {
		expected[key] = ""
	}
	if len(expected) != 17 {
		return nil, fmt.Errorf("expected 17 frozen music assignments, got %d", len(expected))
	}
	for _, cue := range baseline.Cues {
		if _, ok := expected[cue.Key]; ok {
			expected[cue.Key] = cue.URL
		}
	}
	var cues []audiopresentation.Cue
	if err := json.Unmarshal(source, &cues); err != nil {
		return nil, fmt.Errorf("decode expanded music seed: %w", err)
	}
	if len(cues) != len(expected) {
		return nil, fmt.Errorf("expanded music seed has %d cues, want %d", len(cues), len(expected))
	}
	seen := make(map[string]bool, len(cues))
	for _, cue := range cues {
		oldURL, known := expected[cue.Key]
		if !known || seen[cue.Key] || oldURL == "" {
			return nil, fmt.Errorf("unexpected or duplicate expanded music cue %q", cue.Key)
		}
		seen[cue.Key] = true
		if cue.Channel != "music" || cue.Version != 3 || !cue.Loop ||
			cue.Name == "" || cue.License == "" ||
			math.IsNaN(cue.Gain) || cue.Gain <= 0 || cue.Gain > 1 ||
			!strings.HasPrefix(cue.URL, "/audio/music-v3/") ||
			!strings.HasSuffix(cue.URL, ".mp3") || cue.URL == oldURL {
			return nil, fmt.Errorf("invalid expanded music cue %q", cue.Key)
		}
	}
	return cues, nil
}

// This migration changes only the 17 music rows installed by 289. Player
// settings, sound effects, entity assignments and historical combat records
// remain untouched. A second run leaves version 3 and later edits in place.
func installExpandedMusic291(db *sql.DB) error {
	return installExpandedMusicSeed291(db, audio291Seed)
}

func installExpandedMusicSeed291(db *sql.DB, source []byte) error {
	cues, err := decodeExpandedMusic291(source)
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, cue := range cues {
		var channel string
		var version int
		if err := tx.QueryRow(`SELECT channel,version FROM audio_cues WHERE key=$1 FOR UPDATE`, cue.Key).Scan(&channel, &version); err != nil {
			return fmt.Errorf("find existing music cue %q: %w", cue.Key, err)
		}
		if channel != "music" || version < 2 {
			return fmt.Errorf("existing cue %q is not a version 2 music cue", cue.Key)
		}
		if version >= 3 {
			continue
		}
		if _, err := tx.Exec(`UPDATE audio_cues SET name=$2,url=$3,gain=$4,loop=$5,license=$6,version=$7
			WHERE key=$1`, cue.Key, cue.Name, cue.URL, cue.Gain, cue.Loop, cue.License, cue.Version); err != nil {
			return fmt.Errorf("replace music cue %q: %w", cue.Key, err)
		}
	}
	return tx.Commit()
}
