package migrations

import (
	"database/sql"
	"fmt"
)

const rangerFavoredEnemy2024MigrationVersion = "159_repair_ranger_favored_enemy_2024"

const rangerFavoredEnemy2024Mechanics = `{
	"activation":{"mode":"passive"},
	"effects":[{
		"resolution":"auto",
		"result":[{
			"kind":"grant_spell",
			"value":"SPELL-0223",
			"label":"prepared",
			"freeuse":{"count":2,"per":"long_rest"}
		}]
	}]
}`

// repairRangerFavoredEnemy2024 removes the obsolete 2014 creature-type
// choice. In the 2024 rules Favored Enemy always prepares Hunter's Mark and
// grants two slot-free casts at the levels covered by this MVP.
func repairRangerFavoredEnemy2024(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("temporarily unlock Favored Enemy repair: %w", err)
	}
	if _, err = tx.Exec(`
		UPDATE effects
		SET description = 'Метка охотника всегда подготовлена. Вы можете дважды сотворить её без ячейки до долгого отдыха.',
			mechanics = $1::jsonb,
			support = jsonb_build_object(
				'status', 'untested',
				'certification_version', $2::text,
				'mechanics_locked', false,
				'note', 'Corrected 2024 Favored Enemy contract; browser verification pending'
			),
			updated_at = NOW()
		WHERE card_number = 'EFF-favored-enemy'
		  AND deleted_at IS NULL
	`, rangerFavoredEnemy2024Mechanics, rangerFavoredEnemy2024MigrationVersion); err != nil {
		return fmt.Errorf("repair 2024 Ranger Favored Enemy: %w", err)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
