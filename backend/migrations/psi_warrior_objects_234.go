package migrations

import "database/sql"

func materializePsiWarriorObjects(db *sql.DB) error {
	_, err := db.Exec(`UPDATE actions SET mechanics=jsonb_set(jsonb_set(mechanics,'{targeting,allowed_relations}','["self","ally"]'::jsonb),'{effects,0,result,0,description}',to_jsonb('Цель перемещена телекинезом без расходования её движения и провоцированных атак.'::text)), description='Действием Магия переместите другое согласное существо или незакреплённый предмет не больше Большого, который никто не носит. Цель должна быть видна в пределах 30 футов; перемещение — до 30 футов в видимое незанятое место. Один раз между короткими или долгими отдыхами.', updated_at=NOW() WHERE card_number='ACT-psi-warrior-movement'`)
	return err
}
