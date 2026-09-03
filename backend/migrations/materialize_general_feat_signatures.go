package migrations

import (
	"database/sql"
	"fmt"
)

const generalFeatSignaturesMigrationVersion = "172_materialize_general_feat_signatures"

type generalFeatSignature struct{ card, mechanics string }
type generalFeatAction struct{ id, card, name, resource, mechanics string }

var generalFeatActions = []generalFeatAction{
	{"17200000-0000-4000-8000-000000000001", "ACT-general-inspiring-leader", "Воодушевляющее выступление", "free_action", `{"activation":{"mode":"active","cost":[],"trigger":{"event":"rest_end"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"sphere","range_ft":30,"min_targets":1,"max_targets":6,"requires_line_of_sight":false,"allowed_relations":["self","ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"temp_hp","amount":"self_level + spellcasting"}]}]}`},
	{"17200000-0000-4000-8000-000000000002", "ACT-general-poisoner", "Нанести яд", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"poisoner_dose"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","range_ft":0,"min_targets":0,"max_targets":1,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFF-general-potent-poison","duration":{"type":"minutes","amount":1}}]}]}`},
	{"17200000-0000-4000-8000-000000000003", "ACT-general-durable", "Быстрое восстановление", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"hit_die","amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","range_ft":0,"min_targets":0,"max_targets":1,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"healing","hit_die":"target"}]}]}`},
	{"17200000-0000-4000-8000-000000000004", "ACT-general-chef-treat", "Съесть угощение", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"chef_treat"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","range_ft":0,"min_targets":0,"max_targets":1,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"temp_hp","amount":"prof"}]}]}`},
	{"17200000-0000-4000-8000-000000000005", "ACT-general-crusher-push", "Крушитель: оттолкнуть", "free_action", `{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","source_action_card_number":"action_basic_weapon","feat_damage_type":"bludgeoning","feat_once_per_turn":"general_feat.crusher.push","feat_max_relative_size":1}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":600,"min_targets":1,"max_targets":1,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"movement","value":"push","distance":5}]}]}`},
	{"17200000-0000-4000-8000-000000000006", "ACT-general-great-weapon-master-hew", "Мастер большого оружия: добивание", "bonus_action", `{"activation":{"mode":"triggered","cost":[{"resource":"bonus_action"}],"trigger":{"event":"hit","source_action_card_number":"action_basic_weapon","feat_gwm_hew":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"allowed_relations":["enemy"]},"effects":[{"resolution":"attack_roll","ability":"auto","attack_kind":"weapon_melee","vs":"ac","who":"target","on_hit":[{"kind":"damage","dice":"weapon","type":"weapon","ability":"auto"}]}]}`},
	{"17200000-0000-4000-8000-000000000007", "ACT-general-slasher-slow", "Рубака: замедлить", "free_action", `{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","source_action_card_number":"action_basic_weapon","feat_damage_type":"slashing","feat_once_per_turn":"general_feat.slasher.slow"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":600,"min_targets":1,"max_targets":1,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"grant_effect","value":"EFF-general-slasher-slow","duration":{"type":"until_start_of_next_turn"}}]}]}`},
}

// These declarations use rule primitives instead of prose actions. Runtime
// consumers may ignore a primitive they do not yet understand, but can never
// mistake an explanatory sentence for an applied rule.
var generalFeatSignatures = []generalFeatSignature{
	{"FEAT-0011", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"action":"light_weapon_extra_attack","weapon_filter":"melee,!two_handed"},"cost":"bonus_action"},{"kind":"modifier","op":"set","value":2,"applies_to":{"interaction":"draw_or_stow_weapons"}}]} ]`},
	{"FEAT-0012", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"advantage","applies_to":{"check":["deception","performance"],"context":"impersonation"}},{"kind":"modifier","op":"set","value":"8 + cha + prof","applies_to":{"dc":"detect_mimicry"}}]} ]`},
	{"FEAT-0013", `[ {"resolution":"auto","result":[{"kind":"grant_speed","mode":"climb","value":"speed"},{"kind":"modifier","op":"set","value":5,"applies_to":{"movement_cost":"stand_from_prone"}},{"kind":"modifier","op":"set","value":5,"applies_to":{"interaction":"running_jump_approach"}}]} ]`},
	{"FEAT-0015", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"interaction":"unarmed_damage_and_grapple","uses":1,"per":"turn"}},{"kind":"modifier","op":"advantage","applies_to":{"attack_target_condition":"grappled_by_self"}},{"kind":"modifier","op":"deny","applies_to":{"movement_penalty":"move_grappled_target","max_target_size":"self"}}]} ]`},
	{"FEAT-0016", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"add","value":10,"applies_to":{"stat":"speed"}},{"kind":"modifier","op":"deny","applies_to":{"movement_penalty":"difficult_terrain","trigger":"dash"}},{"kind":"modifier","op":"disadvantage","applies_to":{"attack":"opportunity_attack","target":"self"}}]} ]`},
	{"FEAT-0017", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"advantage","applies_to":{"attack":"mounted_smaller_target"}},{"kind":"modifier","op":"evasion","applies_to":{"target":"mount","save":"dex"}},{"kind":"modifier","op":"redirect","applies_to":{"attack_target":"mount","to":"self"}}]} ]`},
	{"FEAT-0018", `[ {"id":"observant_skill","kind":"choice","count":1,"prompt":"Внимательный: навык","options":{"source":"explicit","items":[{"id":"perception","name":"Восприятие"},{"id":"insight","name":"Проницательность"},{"id":"investigation","name":"Расследование"}]},"grant":{"kind":"grant_proficiency_or_expertise","prof":"skill"}}, {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"action":"search","cost":"bonus_action"}}]} ]`},
	{"FEAT-0019", `[ {"resolution":"auto","result":[{"kind":"grant_proficiency","prof":"weapon","value":"martial"}]} ]`},
	{"FEAT-0020", `[ {"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-general-inspiring-leader"}]} ]`},
	{"FEAT-0023", `[ {"resolution":"auto","result":[{"kind":"grant_proficiency","prof":"armor","value":"light"},{"kind":"grant_proficiency","prof":"armor","value":"shield"}]} ]`},
	{"FEAT-0024", `[ {"resolution":"auto","result":[{"kind":"grant_proficiency","prof":"armor","value":"medium"}]} ]`},
	{"FEAT-0025", `[ {"resolution":"auto","result":[{"kind":"grant_proficiency","prof":"armor","value":"heavy"}]} ]`},
	{"FEAT-0026", `[ {"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-general-crusher-push"},{"kind":"modifier","op":"advantage","applies_to":{"attacks_against":"target_of_bludgeoning_critical","duration":"until_start_of_next_turn"}}]} ]`},
	{"FEAT-0027", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"prof","applies_to":{"roll":"damage"},"rule_binding":{"attack_kind":"weapon","weapon_property":"heavy","own_turn":true}},{"kind":"grant_action","value":"ACT-general-great-weapon-master-hew"}]} ]`},
	{"FEAT-0028", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"attack":"polearm_butt","die":"1d4","damage_type":"bludgeoning","cost":"bonus_action"}},{"kind":"modifier","op":"allow","applies_to":{"attack":"polearm_reach_entry","cost":"reaction"}}]} ]`},
	{"FEAT-0029", `[ {"id":"weapon_mastery","kind":"choice","count":1,"prompt":"Мастер оружия: вид оружия","options":{"source":"weapon","filter":"proficient"},"grant":{"kind":"grant_weapon_mastery"},"replace_on":"long_rest"} ]`},
	{"FEAT-0030", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"set","value":3,"applies_to":{"stat":"medium_armor_dex_cap","requirement":{"dex":16}}}]} ]`},
	{"FEAT-0031", `[ {"resolution":"auto","result":[{"kind":"reduce_damage","amount":"prof","filter":{"source":"attack","damage_types":["bludgeoning","piercing","slashing"],"armor":"heavy"}}]} ]`},
	{"FEAT-0032", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"trigger":"melee_hit","requirement":"shield","save":"str","dc":"8 + str + prof","choices":["push_5","COND-prone"],"uses":1,"per":"turn"}},{"kind":"modifier","op":"evasion","applies_to":{"save":"dex","requirement":"shield","cost":"reaction"}}]} ]`},
	{"FEAT-0034", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"deny","applies_to":{"penalty":["half_cover","three_quarters_cover","ranged_attack_enemy_adjacent","ranged_attack_long_range"]}}]} ]`},
	{"FEAT-0035", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"add","value":10,"applies_to":{"speed":"dash"}},{"kind":"modifier","op":"allow","applies_to":{"trigger":"charge_hit_after_10ft","choices":["damage:1d8","push_10"],"uses":1,"per":"turn","max_relative_size":1}}]} ]`},
	{"FEAT-0036", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"prof","applies_to":{"stat":"ac","trigger":"melee_hit","requirement":"finesse_weapon","cost":"reaction","duration":"until_start_of_next_turn"}}]} ]`},
	{"FEAT-0037", `[ {"id":"keen_mind_skill","kind":"choice","count":1,"prompt":"Острый ум: навык","options":{"source":"explicit","items":[{"id":"arcana","name":"Тайная магия"},{"id":"history","name":"История"},{"id":"investigation","name":"Расследование"},{"id":"nature","name":"Природа"},{"id":"religion","name":"Религия"}]},"grant":{"kind":"grant_proficiency_or_expertise","prof":"skill"}}, {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"action":"study","cost":"bonus_action"}}]} ]`},
	{"FEAT-0038", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"ignore","applies_to":{"resistance":"poison"}},{"kind":"grant_proficiency","prof":"tool","value":"poisoners_kit"},{"kind":"grant_action","value":"ACT-general-poisoner"},{"kind":"resource","id":"poisoner_dose","op":"grant","amount":"prof"}]} ]`},
	{"FEAT-0039", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"reroll_damage","keep":"new","once_per_turn":"general_feat.piercer.reroll","applies_to":{"roll":"damage","filter":{"damageType":"piercing"}}},{"kind":"modifier","op":"add_die","value":1,"applies_to":{"critical_damage_type":"piercing"}}]} ]`},
	{"FEAT-0040", `[ {"resolution":"auto","result":[{"kind":"grant_sense","sense":"blindsight","range":10},{"kind":"modifier","op":"advantage","applies_to":{"check":"stealth","action":"hide","context":"combat"}},{"kind":"modifier","op":"deny","applies_to":{"interaction":"reveal_location_on_missed_attack","requirement":"hidden"}}]} ]`},
	{"FEAT-0042", `[ {"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-general-slasher-slow"},{"kind":"modifier","op":"disadvantage","applies_to":{"target_attacks":"slashing_critical","duration":"until_start_of_next_turn"}}]} ]`},
	{"FEAT-0044", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"advantage","applies_to":{"roll":"saving_throw","filter":{"kind":"death"}}},{"kind":"grant_action","value":"ACT-general-durable"}]} ]`},
	{"FEAT-0045", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"allow","applies_to":{"attack":"opportunity","cost":"reaction","trigger":["nearby_disengage","nearby_attack_other"]}},{"kind":"modifier","op":"set","value":0,"applies_to":{"target_stat":"speed","trigger":"opportunity_hit","duration":"end_of_current_turn"}}]} ]`},
	{"FEAT-0050", `[ {"id":"resilient_save","kind":"choice","count":1,"prompt":"Устойчивый: спасбросок","options":{"source":"ability","filter":"not_proficient_save"},"grant":{"kind":"grant_proficiency","prof":"saving_throw"}} ]`},
	{"FEAT-0051", `[ {"resolution":"auto","result":[{"kind":"grant_proficiency","prof":"tool","value":"cooks_utensils"},{"kind":"modifier","op":"add","value":"1d8","applies_to":{"healing":"spend_hit_die_at_short_rest","max_targets":"4 + prof"}},{"kind":"grant_action","value":"ACT-general-chef-treat"},{"kind":"resource","id":"chef_treat","op":"grant","amount":"prof","recharge":"long_rest"}]} ]`},
	{"FEAT-0052", `[ {"resolution":"auto","result":[{"kind":"modifier","op":"deny","applies_to":{"weapon":"crossbow","penalty":["loading","ranged_attack_enemy_adjacent"]}},{"kind":"modifier","op":"allow","applies_to":{"damage_modifier":"ability","attack":"light_crossbow_extra_attack"}}]} ]`},
	{"FEAT-0053", `[ {"id":"skill_expert_proficiencies","kind":"choice","count":2,"prompt":"Эксперт в навыке: владения","options":{"source":"skill"},"grant":{"kind":"grant_proficiency","prof":"skill"}}, {"id":"skill_expert_expertise","kind":"choice","count":1,"prompt":"Эксперт в навыке: экспертность","options":{"source":"skill","filter":"proficient_not_expert"},"grant":{"kind":"grant_expertise","prof":"skill"}} ]`},
}

func materializeGeneralFeatSignatures(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if len(generalFeatSignatures) != 33 {
		return fmt.Errorf("general signature denominator=%d, want 33", len(generalFeatSignatures))
	}
	for _, a := range generalFeatActions {
		if _, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES($1::uuid,$2::text,'',$2::text,'','common',$3::text,'class_feature','feat',$4::text,$5::jsonb,'System','PHB 2024',jsonb_build_object('status','untested','certification_version',$6::text,'mechanics_locked',false,'note','Browser verification required'))
			ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`, a.id, a.name, a.card, a.resource, a.mechanics, generalFeatSignaturesMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", a.card, err)
		}
	}
	if _, err = tx.Exec(`INSERT INTO resources(resource_id,name,name_en,description,category,recharge,sort_order)
		VALUES ('poisoner_dose','Дозы яда','Poison Doses','Дозы сильнодействующего яда черты Отравитель.','feat','manual',1720),
		('chef_treat','Угощения','Chef Treats','Поддерживающие угощения черты Шеф-повар.','feat','long_rest',1721)
		ON CONFLICT(resource_id) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,category=EXCLUDED.category,recharge=EXCLUDED.recharge,deleted_at=NULL,updated_at=NOW()`); err != nil {
		return fmt.Errorf("upsert feat resources: %w", err)
	}
	if _, err = tx.Exec(`INSERT INTO effects(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
		VALUES('17200000-0000-4000-8000-000000000005','Сильнодействующий яд','Potent Poison','Следующее попадание отравленным оружием: спасбросок Телосложения; 2к8 Ядом и Отравление при провале.','','','common','EFF-general-potent-poison','feat_ability',
		'{"activation":{"mode":"triggered","trigger":{"event":"weapon_hit"}},"effects":[{"resolution":"save","ability":"con","dc":"8 + prof + increased_ability_mod","on_fail":[{"kind":"damage","amount":"2d8","damage_type":"poison"},{"kind":"grant_effect","value":"COND-poisoned","duration":{"type":"until_end_of_next_turn"}}]}],"duration":{"type":"minutes","amount":1}}'::jsonb,false,'System','PHB 2024',jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Browser verification required')),
		('17200000-0000-4000-8000-000000000006','Подрезанное движение','Slasher: Hamstrung','Скорость цели снижена на 10 фт. до начала следующего хода владельца черты.','','','common','EFF-general-slasher-slow','feat_ability',
		'{"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":-10,"applies_to":{"roll":"speed"}}]}],"duration":{"type":"until_start_of_next_turn"}}'::jsonb,false,'System','PHB 2024',jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Browser verification required'))
		ON CONFLICT(card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`, generalFeatSignaturesMigrationVersion); err != nil {
		return fmt.Errorf("upsert potent poison: %w", err)
	}
	for _, seed := range generalFeatSignatures {
		res, execErr := tx.Exec(`UPDATE effects e SET mechanics=jsonb_set(e.mechanics,'{effects}',COALESCE((
			SELECT jsonb_agg(item ORDER BY ordinal) FROM jsonb_array_elements(COALESCE(e.mechanics->'effects','[]'::jsonb)) WITH ORDINALITY AS prior(item,ordinal)
			WHERE item->>'id'='general_feat_ability_increase'
		),'[]'::jsonb)||$1::jsonb,true),
			support=jsonb_build_object('status','untested','certification_version',$2::text,'mechanics_locked',false,'note','Signature mechanics materialized; browser verification required'),updated_at=NOW()
			FROM feats f WHERE f.card_number=$3 AND e.card_number='EFF-general-'||f.card_number AND e.deleted_at IS NULL AND f.deleted_at IS NULL`, seed.mechanics, generalFeatSignaturesMigrationVersion, seed.card)
		if execErr != nil {
			return fmt.Errorf("materialize %s: %w", seed.card, execErr)
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return fmt.Errorf("materialize %s updated %d", seed.card, n)
		}
	}
	for card, capability := range map[string]string{
		"FEAT-0026": "general_feat.crusher",
		"FEAT-0027": "general_feat.great_weapon_master",
		"FEAT-0031": "general_feat.heavy_armor_master",
		"FEAT-0034": "general_feat.sharpshooter",
		"FEAT-0039": "general_feat.piercer",
		"FEAT-0042": "general_feat.slasher",
		"FEAT-0052": "general_feat.crossbow_expert",
	} {
		res, execErr := tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{capabilities}',jsonb_build_array(jsonb_build_object('id',$1::text)),true),updated_at=NOW()
			WHERE card_number='EFF-general-'||$2 AND deleted_at IS NULL`, capability, card)
		if execErr != nil {
			return fmt.Errorf("project %s capability: %w", card, execErr)
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return fmt.Errorf("project %s capability updated %d", card, n)
		}
	}
	// Mechanics-protection triggers intentionally invalidate support whenever a
	// payload changes. Restore the explicit untested marker in a separate final
	// statement so PostgreSQL trigger order cannot leave these rows "invalidated".
	if _, err = tx.Exec(`UPDATE effects e SET support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Signature mechanics materialized; browser verification required'),updated_at=NOW()
		FROM feats f WHERE f.card_number=ANY($2::text[]) AND e.card_number='EFF-general-'||f.card_number AND e.deleted_at IS NULL`, generalFeatSignaturesMigrationVersion, func() []string {
		out := make([]string, 0, len(generalFeatSignatures))
		for _, s := range generalFeatSignatures {
			out = append(out, s.card)
		}
		return out
	}()); err != nil {
		return fmt.Errorf("restore feat support: %w", err)
	}
	if _, err = tx.Exec(`UPDATE actions SET support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Browser verification required'),updated_at=NOW() WHERE card_number=ANY($2::text[])`, generalFeatSignaturesMigrationVersion, func() []string {
		out := make([]string, 0, len(generalFeatActions))
		for _, a := range generalFeatActions {
			out = append(out, a.card)
		}
		return out
	}()); err != nil {
		return fmt.Errorf("restore action support: %w", err)
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Browser verification required'),updated_at=NOW() WHERE card_number=ANY($2::text[])`, generalFeatSignaturesMigrationVersion, []string{"EFF-general-potent-poison", "EFF-general-slasher-slow"}); err != nil {
		return fmt.Errorf("restore related feat effect support: %w", err)
	}
	return tx.Commit()
}
