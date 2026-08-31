package migrations

import (
	"database/sql"
	"fmt"
)

const miniMVPLimitedActionUsesMigrationVersion = "125_repair_mini_mvp_limited_action_uses"

const repairMiniMVPLimitedActionUsesSQL = `
	UPDATE actions
	SET mechanics = jsonb_set(
		mechanics,
		'{activation,cost}',
		COALESCE(mechanics #> '{activation,cost}', '[]'::jsonb)
			|| '[{"resource":"self_uses","amount":1}]'::jsonb,
		true
	),
	support = NULL,
	updated_at = NOW()
	WHERE card_number IN (
		'ACTION-0005',
		'ACT-feat-musician-song',
		'ACT-feat-crafter-fast-craft'
	)
	AND deleted_at IS NULL
	AND mechanics ? 'uses'
	AND NOT EXISTS (
		SELECT 1
		FROM jsonb_array_elements(COALESCE(mechanics #> '{activation,cost}', '[]'::jsonb)) AS cost
		WHERE cost ->> 'resource' = 'self_uses'
	)`

// repairMiniMVPLimitedActionUses completes the strict executable contract for
// three limited actions introduced by migration 124. A mechanics.uses pool is
// actionable only when activation.cost explicitly spends self_uses; otherwise
// every sheet and combat projection intentionally fails closed.
func repairMiniMVPLimitedActionUses(db *sql.DB) error {
	result, err := db.Exec(repairMiniMVPLimitedActionUsesSQL)
	if err != nil {
		return fmt.Errorf("repair limited action self_uses contracts: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read limited action self_uses update count: %w", err)
	}
	if updated != 3 {
		return fmt.Errorf("repair limited action self_uses contracts: updated %d rows, want 3", updated)
	}
	return nil
}
