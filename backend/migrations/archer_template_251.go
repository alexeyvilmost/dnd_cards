package migrations

import (
	"database/sql"
	"dnd-cards-backend/charactertemplates"
)

// Preserve existing player copies and administrator-authored revisions.
func updateArcherTemplate251(db *sql.DB) error {
	presets, err := charactertemplates.Presets()
	if err != nil {
		return err
	}
	for _, preset := range presets {
		if preset.PresetKey == "archer" {
			_, err = db.Exec(`UPDATE character_templates SET character=$2::jsonb,description=$3,version=version+1,updated_at=NOW()
   WHERE id=$1::uuid AND preset_key='archer' AND version=1
   AND character->>'background_id'='ddde0222-b594-4bac-8103-d32395c294c2'`, preset.ID, string(preset.Character), preset.Description)
			return err
		}
	}
	return nil
}
