package migrations

import "database/sql"

const psiWarriorProtectiveField232 = `{"activation":{"mode":"reaction","cost":[{"resource":"reaction"},{"resource":"psi_warrior_energy_die"}],"trigger":{"event":"damage_taken","timing":"before","protective_field":true}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"max(1, psi_warrior_energy_die + int)"}]}]}`

func materializePsiWarriorProtectiveField(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
 SELECT '23200000-0000-4000-8000-000000000001'::uuid,'Защитное поле','Protective Field','Когда вы или видимое вами существо в пределах 30 футов получаете урон, потратьте реакцию и кость псионической энергии воина. Уменьшите урон на бросок кости плюс модификатор Интеллекта, минимум на 1.',image_url,'common','ACT-psi-warrior-protective-field','class_feature','class_feature','reaction',$1::jsonb,'System','PHB 2024',jsonb_build_object('status','untested','mechanics_locked',false)
 FROM actions WHERE card_number='action_basic_dodge' AND deleted_at IS NULL
 ON CONFLICT(card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics,deleted_at=NULL,updated_at=NOW()`, psiWarriorProtectiveField232)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',(mechanics#>'{effects,0,result}')||'[{"kind":"grant_action","value":"ACT-psi-warrior-protective-field"}]'::jsonb),updated_at=NOW() WHERE card_number='EFFECT-0053' AND NOT (mechanics#>'{effects,0,result}') @> '[{"kind":"grant_action","value":"ACT-psi-warrior-protective-field"}]'::jsonb`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
