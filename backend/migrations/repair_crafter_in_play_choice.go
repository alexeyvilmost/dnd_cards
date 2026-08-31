package migrations

import (
	"database/sql"
	"fmt"
)

const crafterInPlayChoiceMigrationVersion = "126_repair_crafter_in_play_choice"

// repairCrafterInPlayChoice exposes Fast Crafting's item selection to the
// sheet/combat preflight. Without context:in_play the engine spent the use but
// deliberately ignored the unresolved choice, producing no item.
func repairCrafterInPlayChoice(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return fmt.Errorf("disable certified action mechanics guard: %w", err)
	}
	result, err := tx.Exec(`
		UPDATE actions
		SET mechanics = jsonb_set(mechanics, '{effects,0,result,0,context}', '"in_play"'::jsonb, true),
			support = NULL,
			updated_at = NOW()
		WHERE card_number = 'ACT-feat-crafter-fast-craft'
		  AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'choice'
	`)
	if err != nil {
		return fmt.Errorf("repair Crafter in-play choice: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read Crafter update count: %w", err)
	}
	if updated != 1 {
		return fmt.Errorf("repair Crafter in-play choice: updated %d rows, want 1", updated)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
