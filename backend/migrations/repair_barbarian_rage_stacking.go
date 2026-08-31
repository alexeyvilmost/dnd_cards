package migrations

import (
	"database/sql"
	"fmt"
)

const barbarianRageStackingMigrationVersion = "130_repair_barbarian_rage_stacking"

const (
	barbarianRageActionID   = "815f7963-ccac-4480-8a4d-6c790d8d2bcb"
	barbarianRageActionCard = "ACT-rage"
)

var barbarianRageStackIDs = []string{
	"class:barbarian:rage:damage",
	"class:barbarian:rage:resistance:bludgeoning",
	"class:barbarian:rage:resistance:piercing",
	"class:barbarian:rage:resistance:slashing",
	"class:barbarian:rage:strength-check",
	"class:barbarian:rage:strength-save",
}

// repairBarbarianRageStacking gives every independent Rage payload a stable
// overwrite slot. Reusing Rage then refreshes its duration instead of stacking
// a second damage bonus, resistance set, and pair of advantages.
func repairBarbarianRageStacking(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return fmt.Errorf("temporarily disable certified action mechanics guard: %w", err)
	}

	var matches, exact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM actions WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, barbarianRageActionID, barbarianRageActionCard).Scan(&matches, &exact); err != nil {
		return fmt.Errorf("inspect Rage action identity: %w", err)
	}
	if matches != 1 || exact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", barbarianRageActionCard, matches, exact)
	}

	for resultIndex, stackID := range barbarianRageStackIDs {
		path := fmt.Sprintf("{effects,0,result,%d,stack_id}", resultIndex+1)
		if _, err := tx.Exec(`
			UPDATE actions
			SET mechanics = jsonb_set(mechanics, $3::text[], to_jsonb($4::text), true),
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		`, barbarianRageActionID, barbarianRageActionCard, path, stackID); err != nil {
			return fmt.Errorf("set Rage stack id %q: %w", stackID, err)
		}
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*) FROM actions
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,1,stack_id}' = $3
		  AND mechanics #>> '{effects,0,result,2,stack_id}' = $4
		  AND mechanics #>> '{effects,0,result,3,stack_id}' = $5
		  AND mechanics #>> '{effects,0,result,4,stack_id}' = $6
		  AND mechanics #>> '{effects,0,result,5,stack_id}' = $7
		  AND mechanics #>> '{effects,0,result,6,stack_id}' = $8
	`, barbarianRageActionID, barbarianRageActionCard,
		barbarianRageStackIDs[0], barbarianRageStackIDs[1], barbarianRageStackIDs[2],
		barbarianRageStackIDs[3], barbarianRageStackIDs[4], barbarianRageStackIDs[5],
	).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Rage stacking postconditions: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Rage stacking postconditions failed: compatible_records=%d", compatible)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
