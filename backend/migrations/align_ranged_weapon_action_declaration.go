package migrations

import (
	"database/sql"
	"fmt"
)

const rangedWeaponActionCardNumber = "action_basic_weapon_ranged"

// alignRangedWeaponActionDeclaration repairs the metadata drift between the
// migration-created action and the declarative release entity. Mechanics stay
// untouched: this migration makes the database projection equal to the single
// versioned content declaration used by live compilation and certification.
func alignRangedWeaponActionDeclaration(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var activeRows int
	if err = tx.QueryRow(`
		SELECT count(*)
		FROM actions
		WHERE card_number = $1 AND deleted_at IS NULL
	`, rangedWeaponActionCardNumber).Scan(&activeRows); err != nil {
		return fmt.Errorf("inspect ranged weapon action declaration: %w", err)
	}
	if activeRows != 1 {
		return fmt.Errorf("ranged weapon action declaration requires exactly one active row, got %d", activeRows)
	}

	if _, err = tx.Exec(`
		UPDATE actions
		SET name_en = 'Ranged Weapon Attack',
			resource = 'action',
			source = 'PHB 2024; micro-MVP L1 overlay canonical entity v1',
			updated_at = NOW()
		WHERE card_number = $1 AND deleted_at IS NULL
		  AND (
			name_en IS DISTINCT FROM 'Ranged Weapon Attack'
			OR resource IS DISTINCT FROM 'action'
			OR source IS DISTINCT FROM 'PHB 2024; micro-MVP L1 overlay canonical entity v1'
		  )
	`, rangedWeaponActionCardNumber); err != nil {
		return fmt.Errorf("align ranged weapon action declaration: %w", err)
	}

	return tx.Commit()
}
