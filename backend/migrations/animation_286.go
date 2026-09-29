package migrations

import (
	"database/sql"
	"dnd-cards-backend/animationpresentation"
	"encoding/json"
)

// Presentation lives separately from mechanics, certification and saved battles.
func createCombatAnimation286(db *sql.DB) error {
	catalog, err := animationpresentation.Defaults()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE animation_profiles (
	 key text PRIMARY KEY, definition jsonb NOT NULL CHECK(jsonb_typeof(definition) = 'object')
	);
	CREATE TABLE entity_animation_bindings (
	 entity_type text NOT NULL CHECK(entity_type IN ('spell','action','card','effect')),
	 entity_id text NOT NULL, profile_key text NOT NULL REFERENCES animation_profiles(key),
	 PRIMARY KEY(entity_type, entity_id)
	);`); err != nil {
		return err
	}
	for _, definition := range catalog.Profiles {
		var identity struct {
			Key string `json:"key"`
		}
		if err = json.Unmarshal(definition, &identity); err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO animation_profiles(key,definition) VALUES($1,$2::jsonb)`, identity.Key, string(definition)); err != nil {
			return err
		}
	}
	for _, binding := range catalog.Bindings {
		// Bind only entities actually present in this installation. IDs are authored
		// metadata, never runtime recognition rules. Variants absent here stay in
		// the shared offline catalog until their content migration creates them.
		if _, err = tx.Exec(`INSERT INTO entity_animation_bindings(entity_type,entity_id,profile_key)
		 SELECT $1,$2,$3 WHERE ($1='spell' AND EXISTS(SELECT 1 FROM spells WHERE id::text=$2 AND deleted_at IS NULL))
		 OR ($1='action' AND EXISTS(SELECT 1 FROM actions WHERE id::text=$2 AND deleted_at IS NULL))`, binding.EntityType, binding.EntityID, binding.ProfileKey); err != nil {
			return err
		}
	}
	return tx.Commit()
}
