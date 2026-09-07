package migrations

import (
	"database/sql"
	"fmt"
)

// SRD 5.2.1: the Bite rider is automatic, with a different size ceiling
// for each wolf. Keep the historical seed migration immutable.
func materializeRoguelikeWolfRiders(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range []struct {
		card, description string
		maxSize           int
	}{
		{"RL-MA-WOLF-BITE", "При попадании цель Среднего или меньшего размера получает состояние Распластан; спасбросок не требуется.", 2},
		{"RL-MA-DIRE-BITE", "При попадании цель Большого или меньшего размера получает состояние Распластан; спасбросок не требуется.", 3},
	} {
		result, err := tx.Exec(`UPDATE actions SET
			mechanics = jsonb_set(mechanics, '{effects,0,on_hit}',
				jsonb_build_array(mechanics #> '{effects,0,on_hit,0}',
				jsonb_build_object('kind','condition','value','prone','max_target_size',$2::int))),
			description=$3, updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, row.card, row.maxSize, row.description)
		if err != nil {
			return err
		}
		if count, err := result.RowsAffected(); err != nil || count != 1 {
			return fmt.Errorf("expected one wolf bite action %s, got %d: %v", row.card, count, err)
		}
	}
	_, err = tx.Exec(`UPDATE monsters SET ai=(ai - 'knock_prone') ||
		'{"skill_proficiencies":["perception","stealth"],"skill_expertise":["perception"],"darkvision_ft":60}'::jsonb,
		updated_at=NOW() WHERE slug IN ('wolf','dire-wolf') AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
