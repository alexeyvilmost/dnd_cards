package migrations

import (
	"fmt"

	"gorm.io/gorm"
)

const multiclassSubclassesMigrationVersion = "168_multiclass_subclasses"

// addMulticlassSubclasses gives every owned class its own subclass selection.
// The legacy Forge stored the primary subclass only in
// resolved_choices['builder:subclass']; keep that selection during backfill.
func addMulticlassSubclasses(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`ALTER TABLE characters_v3
			ADD COLUMN IF NOT EXISTS subclass_ids JSONB NOT NULL DEFAULT '{}'::jsonb`).Error; err != nil {
			return fmt.Errorf("add characters_v3.subclass_ids: %w", err)
		}
		if err := tx.Exec(`UPDATE characters_v3
			SET subclass_ids = jsonb_build_object(
				class_id::text,
				resolved_choices->'builder:subclass'->>0
			)
			WHERE class_id IS NOT NULL
			  AND COALESCE(subclass_ids, '{}'::jsonb) = '{}'::jsonb
			  AND jsonb_typeof(resolved_choices->'builder:subclass') = 'array'
			  AND COALESCE(resolved_choices->'builder:subclass'->>0, '') <> ''`).Error; err != nil {
			return fmt.Errorf("backfill primary subclass ownership: %w", err)
		}
		return nil
	})
}
