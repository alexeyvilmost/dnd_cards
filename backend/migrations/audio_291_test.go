package migrations

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"dnd-cards-backend/audiopresentation"
)

func expandedMusicFixture291(t *testing.T) []byte {
	t.Helper()
	baseline, err := audiopresentation.Decode(audio289Seed)
	if err != nil {
		t.Fatal(err)
	}
	keys := map[string]bool{baseline.Music.Site: true, baseline.Music.Run: true}
	for _, key := range baseline.Music.Battles {
		keys[key] = true
	}
	var cues []audiopresentation.Cue
	for _, cue := range baseline.Cues {
		if !keys[cue.Key] {
			continue
		}
		cue.Name += " — расширенная тема"
		cue.URL = "/audio/music-v3/" + strings.ReplaceAll(cue.Key, ".", "_") + ".test12345678.mp3"
		cue.Version = 3
		cues = append(cues, cue)
	}
	data, err := json.Marshal(cues)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestExpandedMusic291SeedValidation(t *testing.T) {
	if cues, err := decodeExpandedMusic291(audio291Seed); err != nil || len(cues) != 17 {
		t.Fatalf("frozen expanded music seed invalid: %d %v", len(cues), err)
	}
	fixture := expandedMusicFixture291(t)
	if cues, err := decodeExpandedMusic291(fixture); err != nil || len(cues) != 17 {
		t.Fatalf("valid 17-theme seed rejected: %d %v", len(cues), err)
	}
	var cues []audiopresentation.Cue
	if err := json.Unmarshal(fixture, &cues); err != nil {
		t.Fatal(err)
	}
	invalid := []struct {
		name string
		edit func([]audiopresentation.Cue) []audiopresentation.Cue
	}{
		{"missing map", func(rows []audiopresentation.Cue) []audiopresentation.Cue { return rows[:len(rows)-1] }},
		{"duplicate", func(rows []audiopresentation.Cue) []audiopresentation.Cue { rows[1] = rows[0]; return rows }},
		{"sound effect", func(rows []audiopresentation.Cue) []audiopresentation.Cue { rows[0].Channel = "effects"; return rows }},
		{"short version", func(rows []audiopresentation.Cue) []audiopresentation.Cue { rows[0].Version = 2; return rows }},
		{"old file", func(rows []audiopresentation.Cue) []audiopresentation.Cue {
			rows[0].URL = "/audio/music-v2/old.mp3"
			return rows
		}},
		{"not repeatable", func(rows []audiopresentation.Cue) []audiopresentation.Cue { rows[0].Loop = false; return rows }},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			rows := append([]audiopresentation.Cue(nil), cues...)
			rows = test.edit(rows)
			data, err := json.Marshal(rows)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := decodeExpandedMusic291(data); err == nil {
				t.Fatal("invalid expanded music accepted")
			}
		})
	}
}

func TestExpandedMusic291PreservesBindingsEffectsAndLegacy(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "AUDIO_TEST_DATABASE_URL")
	for _, table := range []string{"actions", "spells", "cards", "effects"} {
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(id text PRIMARY KEY,card_number text,deleted_at timestamptz)`, table)); err != nil {
			t.Fatal(err)
		}
	}
	if err := createAudio260(db); err != nil {
		t.Fatal(err)
	}
	if err := installSelectedAudio289(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO audio_cues(key,name,channel,url,gain,loop,license,version,active)
	 VALUES('custom.effect','Custom effect','effects','/audio/custom/effect.mp3',.6,false,'Owned',9,true),
	 ('custom.music','Custom music','music','/audio/custom/music.mp3',.5,true,'Owned',5,true);
	 INSERT INTO entity_audio_bindings(entity_type,entity_id,event,cue_key)
	 VALUES('action','customer-action','hit','custom.effect');
	 UPDATE audio_cues SET active=false WHERE key='music.run';
	 UPDATE audio_cues SET url='/audio/legacy/customized.mp3' WHERE key='music.camp'`); err != nil {
		t.Fatal(err)
	}
	var beforeOther, beforeBindings string
	otherRows := `SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.key),'[]'::jsonb)::text FROM audio_cues c
	 WHERE c.key NOT IN ('music.site','music.run') AND c.key NOT LIKE 'music.battle.%'`
	bindings := `SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.entity_type,b.entity_id,b.event),'[]'::jsonb)::text FROM entity_audio_bindings b`
	if err := db.QueryRow(otherRows).Scan(&beforeOther); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(bindings).Scan(&beforeBindings); err != nil {
		t.Fatal(err)
	}
	fixture := expandedMusicFixture291(t)
	for range 2 {
		if err := installExpandedMusicSeed291(db, fixture); err != nil {
			t.Fatal(err)
		}
	}
	var afterOther, afterBindings string
	if err := db.QueryRow(otherRows).Scan(&afterOther); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(bindings).Scan(&afterBindings); err != nil {
		t.Fatal(err)
	}
	if beforeOther != afterOther || beforeBindings != afterBindings {
		t.Fatal("expanded music changed sound effects, custom music, legacy cues or entity assignments")
	}
	var storedURL string
	var version int
	var active bool
	if err := db.QueryRow(`SELECT url,version,active FROM audio_cues WHERE key='music.run'`).Scan(&storedURL, &version, &active); err != nil {
		t.Fatal(err)
	}
	if version != 3 || active || !strings.HasPrefix(storedURL, "/audio/music-v3/") {
		t.Fatalf("run theme version/url changed unexpectedly: %q %d %t", storedURL, version, active)
	}
	if _, err := db.Exec(`UPDATE audio_cues SET url='/audio/music-v3/customer-edit.mp3' WHERE key='music.site'`); err != nil {
		t.Fatal(err)
	}
	if err := installExpandedMusicSeed291(db, fixture); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT url FROM audio_cues WHERE key='music.site'`).Scan(&storedURL); err != nil || storedURL != "/audio/music-v3/customer-edit.mp3" {
		t.Fatalf("repeat run overwrote later editor change: %q %v", storedURL, err)
	}
}

func TestExpandedMusic291RollsBackIfExpectedThemeIsMissing(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "AUDIO_TEST_DATABASE_URL")
	for _, table := range []string{"actions", "spells", "cards", "effects"} {
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(id text PRIMARY KEY,card_number text,deleted_at timestamptz)`, table)); err != nil {
			t.Fatal(err)
		}
	}
	if err := createAudio260(db); err != nil {
		t.Fatal(err)
	}
	if err := installSelectedAudio289(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM audio_cues WHERE key='music.run'`); err != nil {
		t.Fatal(err)
	}
	if err := installExpandedMusicSeed291(db, expandedMusicFixture291(t)); err == nil {
		t.Fatal("missing expected theme should stop the migration")
	}
	var version int
	if err := db.QueryRow(`SELECT version FROM audio_cues WHERE key='music.site'`).Scan(&version); err != nil || version != 2 {
		t.Fatalf("partial replacement survived a failed migration: version=%d err=%v", version, err)
	}
}

func TestExpandedMusic291RegisteredAfterCriticalAnimations(t *testing.T) {
	all := GetAllMigrations()
	for index, migration := range all {
		if migration.Version != "291_expanded_fantasy_music" {
			continue
		}
		if index == 0 || all[index-1].Version != "290_critical_weapon_animations" {
			t.Fatal("expanded music migration must follow critical animation migration")
		}
		return
	}
	t.Fatal("expanded music migration is not registered")
}
