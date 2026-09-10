package migrations

import (
	"database/sql"
	"fmt"
)

const legacyDashSpeed243 = `[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"character_speed","applies_to":{"roll":"speed"},"duration":{"type":"until_start_of_next_turn"}}]}]`

// Dash grants extra movement, not a change to the creature's Speed statistic.
func materializeDashMovement(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`LOCK TABLE actions IN ACCESS EXCLUSIVE MODE`); err != nil {
		return err
	}
	var unexpected bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM actions WHERE card_number='action_basic_dash' AND COALESCE(mechanics->'effects','null'::jsonb) NOT IN ($1::jsonb,'[]'::jsonb))`, legacyDashSpeed243).Scan(&unexpected); err != nil {
		return err
	}
	if unexpected {
		return fmt.Errorf("Dash migration: unrecognized effects require review")
	}
	var guard string
	if err = tx.QueryRow(`SELECT COALESCE((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='actions'::regclass AND tgname='protect_actions_certified_mechanics'),'')`).Scan(&guard); err != nil {
		return err
	}
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE actions SET mechanics=jsonb_set(jsonb_set(mechanics,'{activation}',(mechanics->'activation') || '{"counts_as":"dash"}'::jsonb),'{effects}','[]'::jsonb), support=NULL, updated_at=NOW() WHERE card_number='action_basic_dash' AND (mechanics#>>'{activation,counts_as}' IS DISTINCT FROM 'dash' OR mechanics->'effects' IS DISTINCT FROM '[]'::jsonb)`)
	if err != nil {
		return err
	}
	if guard != "" {
		if _, err = tx.Exec(guard); err != nil {
			return err
		}
	}
	return tx.Commit()
}
