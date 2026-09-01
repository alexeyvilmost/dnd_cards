package migrations

import (
	"database/sql"
	"fmt"
)

const woodElfSpeedMigrationVersion = "131_repair_wood_elf_speed"

const (
	woodElfEffectID   = "89a1ef1a-3448-4233-8294-bdc86153416a"
	woodElfEffectCard = "RE-sub-wood_elf"
)

// repairWoodElfSpeed aligns the live declaration with the interpreter contract:
// grant_speed(walk) is an additive grant, so the Wood Elf payload is +5 rather
// than the final 35-foot total. Keeping the correction data-owned avoids a
// lineage-specific exception in the character sheet.
func repairWoodElfSpeed(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("temporarily disable certified effect mechanics guard: %w", err)
	}

	var matches, exact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM effects WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, woodElfEffectID, woodElfEffectCard).Scan(&matches, &exact); err != nil {
		return fmt.Errorf("inspect Wood Elf effect identity: %w", err)
	}
	if matches != 1 || exact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", woodElfEffectCard, matches, exact)
	}

	result, err := tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(mechanics, '{effects,0,result,0,value}', '5'::jsonb, false),
		    support = NULL,
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'grant_speed'
		  AND mechanics #>> '{effects,0,result,0,mode}' = 'walk'
	`, woodElfEffectID, woodElfEffectCard)
	if err != nil {
		return fmt.Errorf("repair Wood Elf speed grant: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read Wood Elf speed update count: %w", err)
	}
	if updated != 1 {
		return fmt.Errorf("Wood Elf speed declaration is incompatible: updated_rows=%d", updated)
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*) FROM effects
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'grant_speed'
		  AND mechanics #>> '{effects,0,result,0,mode}' = 'walk'
		  AND mechanics #>> '{effects,0,result,0,value}' = '5'
	`, woodElfEffectID, woodElfEffectCard).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Wood Elf speed postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Wood Elf speed postcondition failed: compatible_records=%d", compatible)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
