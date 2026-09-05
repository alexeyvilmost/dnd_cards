package migrations

import (
	"database/sql"
	"fmt"
)

const secondWindScalingMigrationVersion = "197_repair_second_wind_scaling"

// Second Wind has two uses at Fighter 1 and gains the third use at Fighter 4.
// level_source keeps multiclass characters on their Fighter progression instead
// of accidentally using total character level.
func repairSecondWindScaling(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`UPDATE actions SET
		mechanics=jsonb_set(
			jsonb_set(
				jsonb_set(
					jsonb_set(mechanics,'{uses,count}','2'::jsonb,true),
					'{effects,0,result,0,amount}','"1d10 + class_level:warrior"'::jsonb,true),
				'{uses,by_level}','{"1":2,"4":3}'::jsonb,true),
			'{uses,level_source}','"warrior"'::jsonb,true),
		support=COALESCE(support,'{}'::jsonb) || jsonb_build_object(
			'certification_version',$1::text,
			'note','Second Wind has two uses at Fighter levels 1-3 and three uses from Fighter level 4; uses and healing scale from the CLASS-warrior runtime key.'),
		updated_at=NOW()
		WHERE card_number='ACT-second-wind' AND deleted_at IS NULL`, secondWindScalingMigrationVersion)
	if err != nil {
		return fmt.Errorf("repair Second Wind scaling: %w", err)
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Second Wind scaling affected %d rows: %w", rows, rowsErr)
	}

	var count, levelOne, levelFour, levelSource, healing string
	if err = tx.QueryRow(`SELECT
		mechanics#>>'{uses,count}',
		mechanics#>>'{uses,by_level,1}',
		mechanics#>>'{uses,by_level,4}',
		mechanics#>>'{uses,level_source}',
		mechanics#>>'{effects,0,result,0,amount}'
		FROM actions WHERE card_number='ACT-second-wind' AND deleted_at IS NULL`).
		Scan(&count, &levelOne, &levelFour, &levelSource, &healing); err != nil {
		return fmt.Errorf("verify Second Wind scaling: %w", err)
	}
	if count != "2" || levelOne != "2" || levelFour != "3" || levelSource != "warrior" || healing != "1d10 + class_level:warrior" {
		return fmt.Errorf("bad Second Wind postimage count=%q l1=%q l4=%q source=%q healing=%q", count, levelOne, levelFour, levelSource, healing)
	}

	return tx.Commit()
}
