package migrations

import "database/sql"

const psiWarriorStrike231 = `{"activation":{"mode":"triggered","cost":[{"resource":"psi_warrior_energy_die"}],"trigger":{"events":["hit"],"requires_weapon_damage_own_turn":true,"feat_once_per_turn":"psi_warrior.psionic_strike"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":false,"allowed_relations":["enemy","ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"max(0, psi_warrior_energy_die + int)","type":"force","suppress_damage_modifiers":true,"inherit_attack_critical":false}]}]}`

func materializePsiWarriorStrike(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
 SELECT '23100000-0000-4000-8000-000000000001'::uuid,'Псионический удар','Psionic Strike','Один раз в свой ход сразу после попадания и нанесения урона оружием цели в пределах 30 футов потратьте кость псионической энергии воина. Цель получает урон силовым полем, равный броску кости плюс модификатор Интеллекта.',image_url,'common','ACT-psi-warrior-strike','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',jsonb_build_object('status','untested','mechanics_locked',false)
 FROM actions WHERE card_number='action_basic_weapon' AND deleted_at IS NULL
 ON CONFLICT(card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics,deleted_at=NULL,updated_at=NOW()`, psiWarriorStrike231)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',(mechanics#>'{effects,0,result}')||'[{"kind":"grant_action","value":"ACT-psi-warrior-strike"}]'::jsonb),updated_at=NOW() WHERE card_number='EFFECT-0053' AND NOT (mechanics#>'{effects,0,result}') @> '[{"kind":"grant_action","value":"ACT-psi-warrior-strike"}]'::jsonb`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
