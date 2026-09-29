package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"

	"dnd-cards-backend/audiopresentation"
)

// Frozen approved recordings and authored assignments. Later catalog changes
// must not rewrite the historical migration.
//
//go:embed audio_289_seed.json
var audio289Seed []byte

// Selected sounds are presentation metadata; mechanics and battle history are
// never read or changed by this migration.
func installSelectedAudio289(db *sql.DB) error {
	catalog, err := audiopresentation.Decode(audio289Seed)
	if err != nil {
		return fmt.Errorf("decode approved audio catalog: %w", err)
	}
	var legacy []audiopresentation.Cue
	if err = json.Unmarshal(audio260Seed, &legacy); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`ALTER TABLE audio_cues ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
	 ALTER TABLE entity_audio_bindings DROP CONSTRAINT IF EXISTS entity_audio_bindings_event_check;
	 ALTER TABLE entity_audio_bindings ADD CONSTRAINT entity_audio_bindings_event_check
	 CHECK(event IN ('cast','charge','launch','hit','miss','healing','activate'));`); err != nil {
		return err
	}
	// Retain the old recordings and assignments on disk/in the database, but do
	// not expose the unchanged procedural seed as the new active sound library.
	// A renamed/replaced/customized legacy row remains an administrator's choice.
	for _, cue := range legacy {
		if _, err = tx.Exec(`UPDATE audio_cues SET active=false
		 WHERE key=$1 AND name=$2 AND channel=$3 AND url=$4 AND gain=$5
		 AND loop=$6 AND license=$7 AND version=1`, cue.Key, cue.Name, cue.Channel, cue.URL, cue.Gain, cue.Loop, cue.License); err != nil {
			return err
		}
	}
	for _, cue := range catalog.Cues {
		// The user explicitly approved these cue keys and recording files. This
		// also replaces the old dice.roll recording with the selected MP3.
		if _, err = tx.Exec(`INSERT INTO audio_cues(key,name,channel,url,gain,loop,license,version,active)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)
		 ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,channel=EXCLUDED.channel,
		 url=EXCLUDED.url,gain=EXCLUDED.gain,loop=EXCLUDED.loop,license=EXCLUDED.license,
		 version=EXCLUDED.version,active=true`, cue.Key, cue.Name, cue.Channel, cue.URL, cue.Gain, cue.Loop, cue.License, cue.Version); err != nil {
			return err
		}
	}
	for _, binding := range catalog.Bindings {
		if _, err = tx.Exec(`INSERT INTO entity_audio_bindings(entity_type,entity_id,event,cue_key)
		 SELECT $1,$2,$3,$4 WHERE
		 ($1='spell' AND EXISTS(SELECT 1 FROM spells WHERE id::text=$2 AND deleted_at IS NULL)) OR
		 ($1='action' AND EXISTS(SELECT 1 FROM actions WHERE id::text=$2 AND deleted_at IS NULL)) OR
		 ($1='card' AND EXISTS(SELECT 1 FROM cards WHERE id::text=$2 AND deleted_at IS NULL)) OR
		 ($1='effect' AND EXISTS(SELECT 1 FROM effects WHERE id::text=$2 AND deleted_at IS NULL))
		 ON CONFLICT(entity_type,entity_id,event) DO NOTHING`, binding.EntityType, binding.EntityID, binding.Event, binding.CueKey); err != nil {
			return err
		}
	}
	return tx.Commit()
}
