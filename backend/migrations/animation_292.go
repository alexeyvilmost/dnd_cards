package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed animation_292_critical_spell_profiles.json
var animation292ProfilesJSON []byte

// Adds display variants, without granting spells any new critical-hit rule.
// Selection still requires the authoritative attack's confirmed crit outcome.
func addCriticalSpellAnimations292(db *sql.DB) error {
	var seed struct {
		Profiles []json.RawMessage `json:"profiles"`
	}
	if err := json.Unmarshal(animation292ProfilesJSON, &seed); err != nil {
		return fmt.Errorf("decode critical spell profiles: %w", err)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, definition := range seed.Profiles {
		var identity struct {
			Key string `json:"key"`
		}
		if err := json.Unmarshal(definition, &identity); err != nil || identity.Key == "" {
			return fmt.Errorf("invalid critical spell profile: %s", definition)
		}
		if _, err = tx.Exec(`INSERT INTO animation_profiles(key,definition) VALUES($1,$2::jsonb)
		 ON CONFLICT(key) DO NOTHING`, identity.Key, string(definition)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
