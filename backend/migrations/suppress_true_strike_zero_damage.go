package migrations

import (
	"database/sql"
	"fmt"
)

const trueStrikeZeroDamageMigrationVersion = "135_suppress_true_strike_zero_damage"

func suppressTrueStrikeZeroDamage(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var matches, exact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (
		  WHERE id=$1::uuid AND card_number=$2
		    AND mechanics #>> '{effects,0,on_hit,0,options,items,0,grants,1,dice}' = '0'
		    AND mechanics #>> '{effects,0,on_hit,0,options,items,1,grants,1,dice}' = '0'
		)
		FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
	`, trueStrikeSpellID, trueStrikeCardNumber).Scan(&matches, &exact); err != nil {
		return fmt.Errorf("inspect True Strike scaling identity: %w", err)
	}
	if matches != 1 || exact != 1 {
		return fmt.Errorf("%s scaling identity drifted: matching_rows=%d exact_rows=%d", trueStrikeCardNumber, matches, exact)
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable spell certification guard: %w", err)
	}
	result, err := tx.Exec(`
		UPDATE spells
		SET mechanics=jsonb_set(
		      jsonb_set(
		        jsonb_set(
		          jsonb_set(mechanics,
		            '{effects,0,on_hit,0,options,items,0,grants,1,suppress_damage_modifiers}', 'true'::jsonb, true),
		          '{effects,0,on_hit,0,options,items,0,grants,1,omit_if_zero}', 'true'::jsonb, true),
		        '{effects,0,on_hit,0,options,items,1,grants,1,suppress_damage_modifiers}', 'true'::jsonb, true),
		      '{effects,0,on_hit,0,options,items,1,grants,1,omit_if_zero}', 'true'::jsonb, true),
		    support=jsonb_build_object(
		      'status','untested', 'certification_version',$3::text, 'mechanics_locked',false,
		      'limitations',jsonb_build_array('Требуется повторная браузерная проверка.'),
		      'note','Скрыта неактивная нулевая строка усиления Меткого удара.'
		    ),
		    updated_at=NOW()
		WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL
	`, trueStrikeSpellID, trueStrikeCardNumber, trueStrikeZeroDamageMigrationVersion)
	if err != nil {
		return fmt.Errorf("suppress True Strike zero damage: %w", err)
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		return fmt.Errorf("suppress True Strike zero damage affected %d rows: %w", affected, rowsErr)
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
