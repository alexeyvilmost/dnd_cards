package migrations

import (
	"database/sql"
	"fmt"
)

const giantWolfSpiderMovement246 = `{"movement_speeds":{"walk":40,"climb":40},"movement_traits":[{"id":"spider_climb","name":"Паучье лазание","mechanics":{"kind":"movement_trait","mode":"climb","ignores_ability_checks_on":["difficult_surfaces","vertical_surfaces","ceilings"]}}]}`

// SRD 5.2.1 Giant Wolf Spider: retain its non-walking speed and Spider Climb
// contract even though the first roguelike arena has no vertical surfaces.
func materializeGiantWolfSpiderMovement(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var valid bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM monsters WHERE slug='giant-wolf-spider' AND deleted_at IS NULL
 AND speed=40 AND max_hp=11 AND armor_class=13
 AND (NOT ai ? 'movement_speeds' OR ai->'movement_speeds'=$1::jsonb->'movement_speeds')
 AND (NOT ai ? 'movement_traits' OR ai->'movement_traits'=$1::jsonb->'movement_traits'))`, giantWolfSpiderMovement246).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("Giant Wolf Spider stat block is missing, changed, or has conflicting movement declarations")
	}
	result, err := tx.Exec(`UPDATE monsters SET ai=ai || $1::jsonb,updated_at=NOW()
 WHERE slug='giant-wolf-spider' AND deleted_at IS NULL AND NOT ai @> $1::jsonb`, giantWolfSpiderMovement246)
	if err != nil {
		return err
	}
	if n, e := result.RowsAffected(); e != nil || n > 1 {
		return fmt.Errorf("unexpected Giant Wolf Spider updates: %d (%v)", n, e)
	}
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM monsters WHERE slug='giant-wolf-spider' AND deleted_at IS NULL
 AND ai @> $1::jsonb)`, giantWolfSpiderMovement246).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("Giant Wolf Spider movement declaration was not installed")
	}
	return tx.Commit()
}
