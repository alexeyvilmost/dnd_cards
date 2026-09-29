package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
)

// This frozen delta records the reviewed transition, rather than reapplying a
// mutable seed. In particular, a deleted v1 assignment remains deleted.
//
//go:embed animation_287_catalog_delta.json
var animation287DeltaJSON []byte

type animation287Delta struct {
	Profiles []struct {
		Definition         json.RawMessage `json:"definition"`
		PreviousDefinition json.RawMessage `json:"previous_definition"`
	} `json:"profiles"`
	Bindings []struct {
		EntityType         string  `json:"entity_type"`
		EntityID           string  `json:"entity_id"`
		ProfileKey         string  `json:"profile_key"`
		PreviousProfileKey *string `json:"previous_profile_key"`
	} `json:"bindings"`
}

func expandCombatAnimation287(db *sql.DB) error {
	var delta animation287Delta
	if err := json.Unmarshal(animation287DeltaJSON, &delta); err != nil {
		return fmt.Errorf("decode animation coverage delta: %w", err)
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
			return fmt.Errorf("invalid animation coverage definition: %s", profile.Definition)
		}
		// An administrator's customized definition wins. Only the unchanged v1
		// beam/splash definitions are upgraded to their new rendering primitives.
		if _, err = tx.Exec(`INSERT INTO animation_profiles(key,definition) VALUES($1,$2::jsonb)
		 ON CONFLICT(key) DO UPDATE SET definition=EXCLUDED.definition
		 WHERE animation_profiles.definition=$3::jsonb`, identity.Key, string(profile.Definition), string(profile.PreviousDefinition)); err != nil {
			return err
		}
	}
	for _, binding := range delta.Bindings {
		if binding.PreviousProfileKey != nil {
			// Existing seed repairs never recreate an administrator's deletion and
			// never override a different, manually selected profile.
			if _, err = tx.Exec(`UPDATE entity_animation_bindings SET profile_key=$3
			 WHERE entity_type=$1 AND entity_id=$2 AND profile_key=$4`, binding.EntityType, binding.EntityID, binding.ProfileKey, *binding.PreviousProfileKey); err != nil {
				return err
			}
			continue
		}
		if _, err = tx.Exec(`INSERT INTO entity_animation_bindings(entity_type,entity_id,profile_key)
		 SELECT $1,$2,$3 WHERE ($1='spell' AND EXISTS(SELECT 1 FROM spells WHERE id::text=$2 AND deleted_at IS NULL))
		 OR ($1='action' AND EXISTS(SELECT 1 FROM actions WHERE id::text=$2 AND deleted_at IS NULL))
		 ON CONFLICT(entity_type,entity_id) DO NOTHING`, binding.EntityType, binding.EntityID, binding.ProfileKey); err != nil {
			return err
		}
	}
	return tx.Commit()
}
