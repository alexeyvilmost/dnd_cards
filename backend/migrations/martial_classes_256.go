package migrations

import (
	"database/sql"
	"fmt"
)

// New catalogs only. No running encounter, archived artifact, character or journal is rewritten.
const martialBonusStrike256 = `{
 "activation":{"mode":"active","cost":[{"resource":"bonus_action","amount":1}],"when":[{"kind":"not","of":{"kind":"wearing_armor"}},{"kind":"not","of":{"kind":"wielding_shield"}}]},
 "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
 "effects":[{"resolution":"attack_roll","attack_kind":"unarmed","ability":"str","vs":"ac","on_hit":[{"kind":"damage","amount":"1 + str","type":"bludgeoning"}]}]
}`

func materializeMartialClasses256(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
 DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;`); err != nil {
		return err
	}
	// Fail atomically if mandatory catalog roots are absent, rather than admitting a broken class.
	var roots int
	if err = tx.QueryRow(`SELECT count(*) FROM classes WHERE card_number IN ('CLASS-barbarian','CLASS-monk') AND deleted_at IS NULL`).Scan(&roots); err != nil {
		return err
	}
	if roots != 2 {
		return fmt.Errorf("martial class roots missing: %d", roots)
	}
	if _, err = tx.Exec(`UPDATE classes SET resources=jsonb_set(resources,'{rage_charge,recovery}',
 '{"short_rest":{"mode":"fixed","amount":1},"long_rest":{"mode":"full"}}'::jsonb),updated_at=NOW()
 WHERE card_number='CLASS-barbarian' AND deleted_at IS NULL;
 UPDATE classes SET level_progression=jsonb_set(level_progression,'{2,actions}',
 COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(level_progression#>'{2,actions}') v
 WHERE v <> '"15400000-0000-4000-8000-000000000011"'::jsonb),'[]'::jsonb)),updated_at=NOW()
 WHERE card_number='CLASS-monk' AND deleted_at IS NULL;`); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source)
 VALUES ('25600000-0000-4000-8000-000000000001','Боевые искусства: безоружный удар','Martial Arts: Bonus Unarmed Strike',
 'Бонусным действием совершите безоружный удар. Предварительная Атака не требуется. Нужно быть без доспеха и щита; используются Кость боевых искусств и лучшая из Силы и Ловкости.',
 COALESCE((SELECT image_url FROM actions WHERE card_number='action_basic_unarmed' AND deleted_at IS NULL LIMIT 1),''),
 'common','ACT-monk-bonus-unarmed','class_feature','class_feature','bonus_action',$1::jsonb,'System','PHB 2024')
 ON CONFLICT (card_number) DO NOTHING`, martialBonusStrike256); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',
 COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(mechanics#>'{effects,0,result}') v WHERE v->>'kind' NOT IN ('grant_action','narrative','weapon_attack_profile')),'[]'::jsonb)
 || '[{"kind":"grant_action","value":"ACT-monk-bonus-unarmed"},{"kind":"weapon_attack_profile","weapon_selectors":[{"category":"simple","mode":"melee"},{"category":"martial","mode":"melee","property":"light"}],"ability_options":["str","dex"],"minimum_damage_dice":"martial_arts_die","when":[{"kind":"not","of":{"kind":"wearing_armor"}},{"kind":"not","of":{"kind":"wielding_shield"}}]}]'::jsonb),
 description='Без доспеха и щита: Кость боевых искусств, Сила или Ловкость для безоружного удара и оружия монаха (простое рукопашное и лёгкое воинское рукопашное); отдельный бонусный безоружный удар не требует предварительной Атаки.',support=NULL,updated_at=NOW()
 WHERE card_number='EFF-martial-arts' AND deleted_at IS NULL;
 UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects}',(SELECT jsonb_agg(jsonb_set(e,'{result}',
 (SELECT jsonb_agg(CASE WHEN p->>'kind'='set_value' AND p->>'target'='ac_base' THEN p || '{"when":[{"kind":"not","of":{"kind":"wielding_shield"}}]}'::jsonb ELSE p END)
 FROM jsonb_array_elements(e->'result') p))) FROM jsonb_array_elements(mechanics->'effects') e)),support=NULL,updated_at=NOW()
 WHERE card_number='EFF-monk-unarmored' AND deleted_at IS NULL;
 UPDATE actions SET mechanics=jsonb_set(jsonb_set(mechanics,'{activation,counts_as}','"dash"'::jsonb),'{effects}',
 (SELECT jsonb_agg(jsonb_set(e,'{result}',COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(e->'result') p
 WHERE NOT (p->>'kind'='modifier' AND p#>>'{applies_to,roll}'='speed')),'[]'::jsonb))) FROM jsonb_array_elements(mechanics->'effects') e)),
 support=NULL,updated_at=NOW() WHERE card_number IN ('ACT-monk-step-of-the-wind','ACT-monk-step-of-the-wind-focus') AND deleted_at IS NULL;
 UPDATE actions SET mechanics=jsonb_set(mechanics,'{activation,when}','[{"kind":"not","of":{"kind":"wearing_armor","category":"heavy"}}]'::jsonb),support=NULL,updated_at=NOW()
 WHERE card_number='ACT-rage' AND deleted_at IS NULL;
 UPDATE actions SET mechanics=jsonb_set(mechanics,'{activation,trigger}',
 '{"event":"damage_taken","timing":"before","damage_types_any":["bludgeoning","piercing","slashing"],"circumstances":[{"kind":"event_data_equals","key":"delivery","value":"attack"}]}'::jsonb),
 support=NULL,updated_at=NOW() WHERE card_number='ACT-monk-deflect-attacks' AND deleted_at IS NULL;
 UPDATE actions SET mechanics=jsonb_set(jsonb_set(jsonb_set(mechanics,'{activation,mode}','"triggered"'::jsonb),'{activation,trigger}',
 '{"event":"action_resolved","source_action_card_numbers":["ACT-monk-deflect-attacks"],"damage_reduced_to_zero":true,"secondary_target":true,"target_domain":"action_range"}'::jsonb),
 '{effects}', '[{"resolution":"save","who":"target","ability":"dex","dc":"8 + prof + wis","on_fail":[{"kind":"damage","amount":"martial_arts_die + martial_arts_die + dex","type":"triggering_attack","inherit_attack_critical":false}],"on_success":[]}]'::jsonb),
 description='После снижения урона атаки до 0 можно потратить 1 Фокус и перенаправить её в видимое существо в пределах 60 футов. Спасбросок Ловкости; при провале две Кости боевых искусств + Ловкость урона исходного типа, при успехе урона нет.',
 support=NULL,updated_at=NOW() WHERE card_number='ACT-monk-deflect-redirect' AND deleted_at IS NULL;`); err != nil {
		return fmt.Errorf("repair martial declarations: %w", err)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return err
	}
	return tx.Commit()
}
