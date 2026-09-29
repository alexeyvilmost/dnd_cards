package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
)

// These new profiles are deliberately separate from normal hits. Entity
// bindings remain stable, and the catalog's criticalProfile relation selects
// the variant only after a confirmed critical outcome.
//
//go:embed animation_290_critical_profiles.json
var animation290ProfilesJSON []byte

func addCriticalWeaponAnimations290(db *sql.DB) error {
	var seed struct {
		Profiles []json.RawMessage `json:"profiles"`
	}
	if err := json.Unmarshal(animation290ProfilesJSON, &seed); err != nil {
		return fmt.Errorf("decode critical weapon profiles: %w", err)
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
			return fmt.Errorf("invalid critical weapon profile: %s", definition)
		}
		// Do not replace an administrator's existing variant or modify any base
		// profile, entity assignment, mechanics or saved combat data.
		if _, err = tx.Exec(`INSERT INTO animation_profiles(key,definition) VALUES($1,$2::jsonb)
		 ON CONFLICT(key) DO NOTHING`, identity.Key, string(definition)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
