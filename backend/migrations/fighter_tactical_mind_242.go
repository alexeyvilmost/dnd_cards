package migrations

import "database/sql"

// Only the event timing changes; the declared cost and conditional boon stay shared.
func materializeFighterTacticalMindTiming(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`LOCK TABLE actions IN ACCESS EXCLUSIVE MODE`); err != nil {
		return err
	}
	var guard string
	if err = tx.QueryRow(`SELECT COALESCE((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='actions'::regclass AND tgname='protect_actions_certified_mechanics'),'')`).Scan(&guard); err != nil {
		return err
	}
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{activation}',
 (mechanics->'activation') || '{"mode":"triggered","trigger":{"events":["ability_check_failed"]}}'::jsonb),
 support=NULL, updated_at=NOW() WHERE card_number='ACT-tactical-mind'
 AND (mechanics#>>'{activation,mode}' IS DISTINCT FROM 'triggered'
 OR mechanics#>'{activation,trigger}' IS DISTINCT FROM '{"events":["ability_check_failed"]}'::jsonb)`)
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
