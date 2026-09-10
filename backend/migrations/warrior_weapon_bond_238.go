package migrations

import "database/sql"

func materializeWarriorWeaponBond(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`UPDATE effects SET mechanics=mechanics||'{"weapon_bond":{"maximum":2,"ritual_minutes":60}}'::jsonb,updated_at=NOW() WHERE card_number='EFFECT-0048'`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE actions SET mechanics='{"activation":{"mode":"active","weapon_bond_recall":true,"cost":[{"resource":"bonus_action","amount":1}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Призыв связанного оружия в свободную руку."}]}]}'::jsonb,updated_at=NOW() WHERE card_number='ACT-subclass-EFFECT-0048'`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
