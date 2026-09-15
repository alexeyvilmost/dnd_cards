package migrations

import (
	"database/sql"
	"dnd-cards-backend/charactertemplates"
	"fmt"
)

func createCharacterTemplates250(db *sql.DB) error {
	rows, err := charactertemplates.Presets()
	if err != nil {
		return err
	}
	if len(rows) != 3 {
		return fmt.Errorf("expected three Forge-validated presets, got %d", len(rows))
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS character_templates (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL CHECK(length(trim(name)) > 0),
		description text NOT NULL DEFAULT '', preset_key varchar(80) UNIQUE,
		character jsonb NOT NULL CHECK(jsonb_typeof(character)='object'
			AND NOT (character ?| ARRAY['id','user_id','user','group_id','group','current_encounter_id','access_mode','runtime_revision'])),
		version integer NOT NULL DEFAULT 1 CHECK(version > 0),
		created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW()
	)`); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err = tx.Exec(`INSERT INTO character_templates(id,name,description,preset_key,character)
			VALUES($1::uuid,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING`,
			row.ID, row.Name, row.Description, row.PresetKey, string(row.Character)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Retain global admin-authored templates and existing personal copies on a code rollback.
func retainCharacterTemplates250(_ *sql.DB) error { return nil }
