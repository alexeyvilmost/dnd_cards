package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed animation_288_force_delta.json
var animation288DeltaJSON []byte

// Change only authored presentation colors. Mechanics, damage kinds, immutable
// battle artifacts and administrator-customized profiles remain untouched.
func updateForceAnimation288(db *sql.DB) error {
	var delta struct {
		Profiles []struct {
			Definition         json.RawMessage `json:"definition"`
			PreviousDefinition json.RawMessage `json:"previous_definition"`
		} `json:"profiles"`
	}
	if err := json.Unmarshal(animation288DeltaJSON, &delta); err != nil {
		return fmt.Errorf("decode force palette delta: %w", err)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, profile := range delta.Profiles {
		var identity struct {
			Key string `json:"key"`
		}
		if err := json.Unmarshal(profile.Definition, &identity); err != nil || identity.Key == "" {
			return fmt.Errorf("invalid force palette definition: %s", profile.Definition)
		}
		if _, err = tx.Exec(`INSERT INTO animation_profiles(key,definition) VALUES($1,$2::jsonb)
		 ON CONFLICT(key) DO UPDATE SET definition=EXCLUDED.definition
		 WHERE animation_profiles.definition=$3::jsonb`, identity.Key, string(profile.Definition), string(profile.PreviousDefinition)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
