package migrations

import "database/sql"

const psiWarriorMovement233 = `{"activation":{"mode":"active","counts_as":"magic","telekinetic_movement":true,"cost":[{"resource":"action"},{"resource":"psi_warrior_telekinetic_movement"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["ally"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Телекинетически перемещено согласное существо без расходования его движения и провоцированных атак."}]}]}`
const psiWarriorMovementRestore233 = `{"activation":{"mode":"active","cost":[{"resource":"psi_warrior_energy_die"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"psi_warrior_telekinetic_movement","amount":1}]}]}`

func materializePsiWarriorMovement(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`UPDATE classes SET resources=COALESCE(resources,'{}'::jsonb)||'{"psi_warrior_telekinetic_movement":{"by_level":{"3":1},"level_source":"warrior","per":"short_rest"}}'::jsonb,updated_at=NOW() WHERE id='a72db803-1dc0-4535-9f31-a55eb016658b'`)
	if err != nil {
		return err
	}
	for _, row := range []struct{ id, name, number, description, mechanics string }{
		{"23300000-0000-4000-8000-000000000001", "Телекинетическое перемещение", "ACT-psi-warrior-movement", "Действием Магия переместите другое согласное видимое существо в пределах 30 футов на расстояние до 30 футов в видимое незанятое место. Один раз между короткими или долгими отдыхами.", psiWarriorMovement233},
		{"23300000-0000-4000-8000-000000000002", "Восстановить телекинетическое перемещение", "ACT-psi-warrior-restore-movement", "Потратьте кость псионической энергии воина без расходования действия, чтобы восстановить использование Телекинетического перемещения.", psiWarriorMovementRestore233},
	} {
		_, err = tx.Exec(`INSERT INTO actions(id,name,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
 SELECT $1::uuid,$2,$3,image_url,'common',$4,'class_feature','class_feature','free_action',$5::jsonb,'System','PHB 2024',jsonb_build_object('status','untested','mechanics_locked',false) FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
 ON CONFLICT(card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics,deleted_at=NULL,updated_at=NOW()`, row.id, row.name, row.description, row.number, row.mechanics)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',(mechanics#>'{effects,0,result}')||jsonb_build_array(jsonb_build_object('kind','grant_action','value',$1::text))),updated_at=NOW() WHERE card_number='EFFECT-0053' AND NOT (mechanics#>'{effects,0,result}') @> jsonb_build_array(jsonb_build_object('kind','grant_action','value',$1::text))`, row.number)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(`INSERT INTO resources(resource_id,name,description,category,recharge,sort_order) VALUES('psi_warrior_telekinetic_movement','Телекинетическое перемещение','Восстанавливается после короткого или долгого отдыха.','class','short_rest',2330) ON CONFLICT(resource_id) DO UPDATE SET name=EXCLUDED.name,recharge=EXCLUDED.recharge,deleted_at=NULL,updated_at=NOW()`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
