package migrations

import (
	"database/sql"
	"fmt"
)

// repairGoliathStoneTargetingContract is a follow-up safety migration for
// environments that may already have recorded migration 113 before its
// self-target declaration was corrected. The canonical compiler contract is
// domain=actor + shape=self + actor_targets=false: the reaction resolves on its
// source actor and must not ask the UI to invent an external target.
func repairGoliathStoneTargetingContract(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return err
	}

	if _, err = tx.Exec(`
		UPDATE actions
		SET mechanics = jsonb_set(
			COALESCE(mechanics, '{}'::jsonb),
			'{targeting,actor_targets}',
			'false'::jsonb,
			true
		), updated_at = NOW()
		WHERE card_number = 'ACT-goliath-stone' AND deleted_at IS NULL
		  AND COALESCE(mechanics->'targeting'->'actor_targets', 'null'::jsonb)
		      IS DISTINCT FROM 'false'::jsonb;
	`); err != nil {
		return err
	}

	var compatibleCount int
	if err = tx.QueryRow(`
		SELECT count(*)
		FROM actions
		WHERE card_number = 'ACT-goliath-stone' AND deleted_at IS NULL
		  AND mechanics->'activation'->>'mode' = 'reaction'
		  AND mechanics->'activation'->'trigger'->>'event' = 'damage_taken'
		  AND mechanics->'activation'->'trigger'->>'timing' = 'before'
		  AND mechanics->'targeting'->>'domain' = 'actor'
		  AND mechanics->'targeting'->>'shape' = 'self'
		  AND mechanics->'targeting'->'actor_targets' = 'false'::jsonb
	`).Scan(&compatibleCount); err != nil {
		return err
	}
	if compatibleCount != 1 {
		return fmt.Errorf(
			"stone endurance targeting compiler postcondition failed: compatible_actions=%d",
			compatibleCount,
		)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return err
	}
	return tx.Commit()
}
