package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
)

//go:embed audio_260_seed.json
var audio260Seed []byte

// Presentation metadata only: never changes certified mechanics or combat history.
func createAudio260(db *sql.DB) error {
	var rows []struct {
		Key, Name, Channel, URL, License string
		Gain                             float64
		Loop                             bool
	}
	if err := json.Unmarshal(audio260Seed, &rows); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE audio_cues (
 key text PRIMARY KEY, name text NOT NULL, channel text NOT NULL CHECK(channel IN ('music','effects','ui')),
 url text NOT NULL, gain double precision NOT NULL DEFAULT 1 CHECK(gain>=0 AND gain<=1),
 loop boolean NOT NULL DEFAULT false, license text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1);
 CREATE TABLE entity_audio_bindings(entity_type text NOT NULL,entity_id text NOT NULL,event text NOT NULL CHECK(event IN ('cast','hit','miss','healing')),
 cue_key text NOT NULL REFERENCES audio_cues(key),PRIMARY KEY(entity_type,entity_id,event));`); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err = tx.Exec(`INSERT INTO audio_cues(key,name,channel,url,gain,loop,license) VALUES($1,$2,$3,$4,$5,$6,$7)`, row.Key, row.Name, row.Channel, row.URL, row.Gain, row.Loop, row.License); err != nil {
			return err
		}
	}
	// Authored assignments, not runtime recognition by name or ID. Admin may replace them.
	if _, err = tx.Exec(`INSERT INTO entity_audio_bindings(entity_type,entity_id,event,cue_key)
 SELECT 'action',id::text,'cast','breath.fire' FROM actions WHERE card_number IN ('ACT-breath-fire','ACT-breath-acid','ACT-breath-cold','ACT-breath-lightning','ACT-breath-poison') AND deleted_at IS NULL`); err != nil {
		return err
	}
	return tx.Commit()
}
