package migrations

import (
	"database/sql"
	"fmt"
)

const disengageRuntimeMechanics = `{
  "name":"Отход",
  "activation":{"cost":[{"resource":"action"}],"mode":"active"},
  "effects":[{"resolution":"auto","result":[{
    "kind":"modifier",
    "applies_to":{"interaction":"opportunity_attack","trigger":"self_movement"},
    "op":"deny",
    "duration":{"type":"until_start_of_next_turn"},
    "stack_id":"basic-action:disengage"
  }]}],
  "targeting":{"shape":"self"}
}`

// applyDisengageRuntimeEffect replaces the former narrative payload with the
// existing reusable persistent-modifier primitive. The opportunity-attack
// resolver can later query the same applies_to contract without another data
// migration; today the sheet already persists and expires the effect.
func applyDisengageRuntimeEffect(db *sql.DB) error {
	result, err := db.Exec(`
		UPDATE actions
		SET mechanics = $1::jsonb,
			support = NULL,
			updated_at = NOW()
		WHERE card_number = 'action_basic_disengage'
		  AND deleted_at IS NULL
		  AND mechanics IS DISTINCT FROM $1::jsonb
	`, disengageRuntimeMechanics)
	if err != nil {
		return fmt.Errorf("apply Disengage runtime effect: %w", err)
	}
	if _, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("read Disengage update count: %w", err)
	}
	return nil
}
