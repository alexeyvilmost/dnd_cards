package migrations

import "database/sql"

func materializeFighterStyleReplacement(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Preserve the installed guard verbatim; do not replace it with an older
	// migration's definition. DDL and content repair are one atomic transaction.
	if _, err = tx.Exec(`LOCK TABLE effects IN ACCESS EXCLUSIVE MODE`); err != nil {
		return err
	}
	var guard string
	if err = tx.QueryRow(`SELECT COALESCE((SELECT pg_get_triggerdef(oid) FROM pg_trigger
 WHERE tgrelid='effects'::regclass AND tgname='protect_effects_certified_mechanics'),'')`).Scan(&guard); err != nil {
		return err
	}
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects}',
 (SELECT jsonb_agg(CASE WHEN e->>'id'='fighter_fighting_style'
 THEN e||'{"replace_on_level_up":1}'::jsonb ELSE e END ORDER BY ord)
 FROM jsonb_array_elements(mechanics->'effects') WITH ORDINALITY AS entries(e,ord))),
 support=NULL, updated_at=NOW() WHERE card_number='EFF-fighting-style'
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(mechanics->'effects') e
 WHERE e->>'id'='fighter_fighting_style' AND e->'replace_on_level_up' IS DISTINCT FROM '1'::jsonb)`)
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
