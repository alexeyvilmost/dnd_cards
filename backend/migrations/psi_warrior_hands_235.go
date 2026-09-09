package migrations

import "database/sql"

func materializePsiWarriorHands(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`UPDATE cards SET mechanics=COALESCE(mechanics,'{}'::jsonb)||'{"object_size":"tiny"}'::jsonb,updated_at=NOW() WHERE card_number IN ('CARD-0039','CARD-0839','CARD-0840','CARD-0841','CARD-0842') AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE actions SET description=description || ' Крошечный предмет можно перенести в свободную руку или из своей руки на поле.',updated_at=NOW() WHERE card_number='ACT-psi-warrior-movement' AND description NOT LIKE '%Крошечный предмет%'`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
