package migrations

import (
	"database/sql"
	"fmt"
)

const generalFeatRuntimeIntegrityVersion = "182_repair_general_feat_runtime_integrity"

const inspiringLeaderMechanics = `{
  "activation":{"mode":"passive"},
  "effects":[
    {
      "id":"general_feat_ability_increase","kind":"choice","count":1,
      "context":"level_up","resolution":"on_acquire",
      "prompt":"Воодушевляющий лидер: выберите характеристику (+1 и формула временных хитов)",
      "options":{"source":"explicit","items":[
        {"id":"wis","name":"Мудрость","grants":[
          {"kind":"grant_ability_score","ability":"wis","amount":1,"cap":20},
          {"kind":"grant_action","value":"ACT-general-inspiring-leader-wis"}
        ]},
        {"id":"cha","name":"Харизма","grants":[
          {"kind":"grant_ability_score","ability":"cha","amount":1,"cap":20},
          {"kind":"grant_action","value":"ACT-general-inspiring-leader-cha"}
        ]}
      ]}
    },
    {"resolution":"auto","result":[
      {"kind":"resource","id":"inspiring_leader_rest","op":"grant","amount":1}
    ]}
  ]
}`

const durableActionMechanics = `{
  "activation":{"mode":"active","cost":[
    {"resource":"bonus_action"},{"resource":"hit_die","amount":1}
  ]},
  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","range_ft":0,
    "min_targets":0,"max_targets":1,"requires_line_of_sight":false,"allowed_relations":["self"]},
  "effects":[{"resolution":"auto","result":[
    {"kind":"healing","hit_die":"target","hit_die_modifier":"con"}
  ]}]
}`

type inspiringLeaderActionSeed struct {
	id, card, ability, name string
}

var inspiringLeaderActionSeeds = []inspiringLeaderActionSeed{
	{"18200000-0000-4000-8000-000000000001", "ACT-general-inspiring-leader-wis", "wis", "Воодушевляющее выступление — Мудрость"},
	{"18200000-0000-4000-8000-000000000002", "ACT-general-inspiring-leader-cha", "cha", "Воодушевляющее выступление — Харизма"},
}

type generalFeatRuntimeActionSeed struct {
	id, card, name, resource, mechanics string
}

var generalFeatRuntimeActionSeeds = []generalFeatRuntimeActionSeed{
	{
		"18200000-0000-4000-8000-000000000010", "ACT-general-defensive-duelist",
		"Защитный дуэлянт", "reaction",
		`{"activation":{"mode":"reaction","cost":[{"resource":"reaction"}],"trigger":{"event":"hit_by_attack","feat_defensive_duelist":true}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","range_ft":0,"min_targets":0,"max_targets":1,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"prof","duration":{"type":"until_start_of_next_turn"},"applies_to":{"roll":"ac"}}]}]}`,
	},
	{
		"18200000-0000-4000-8000-000000000011", "ACT-general-shield-master-push",
		"Мастер щитов: толкнуть", "free_action",
		`{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","source_action_card_number":"action_basic_weapon","feat_once_per_turn":"general_feat.shield_master.bash","feat_requires_shield":true,"feat_requires_melee":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"requires_line_of_sight":true,"allowed_relations":["enemy"]},"effects":[{"resolution":"save","ability":"str","dc":"8 + str + prof","who":"target","on_fail":[{"kind":"movement","value":"push","distance":5}],"on_success":[]}]}`,
	},
	{
		"18200000-0000-4000-8000-000000000012", "ACT-general-shield-master-prone",
		"Мастер щитов: сбить с ног", "free_action",
		`{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","source_action_card_number":"action_basic_weapon","feat_once_per_turn":"general_feat.shield_master.bash","feat_requires_shield":true,"feat_requires_melee":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"requires_line_of_sight":true,"allowed_relations":["enemy"]},"effects":[{"resolution":"save","ability":"str","dc":"8 + str + prof","who":"target","on_fail":[{"kind":"grant_effect","value":"COND-prone"}],"on_success":[]}]}`,
	},
	{
		"18200000-0000-4000-8000-000000000013", "ACT-general-charger-damage",
		"Натиск: дополнительный урон", "free_action",
		`{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","source_action_card_number":"action_basic_weapon","feat_once_per_turn":"general_feat.charger.charge","feat_charger":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"requires_line_of_sight":true,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","dice":"1d8","type":"weapon","suppress_damage_modifiers":true}]}]}`,
	},
	{
		"18200000-0000-4000-8000-000000000014", "ACT-general-charger-push",
		"Натиск: оттолкнуть", "free_action",
		`{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","source_action_card_numbers":["action_basic_weapon","action_basic_unarmed"],"feat_once_per_turn":"general_feat.charger.charge","feat_charger":true,"feat_max_relative_size":1}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"requires_line_of_sight":true,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"movement","value":"push","distance":10}]}]}`,
	},
	{
		"18200000-0000-4000-8000-000000000015", "ACT-general-sentinel-stop",
		"Страж: остановить", "free_action",
		`{"activation":{"mode":"triggered","cost":[],"trigger":{"event":"hit","feat_sentinel_opportunity":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":10,"min_targets":1,"max_targets":1,"requires_line_of_sight":true,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"grant_effect","value":"EFF-general-sentinel-stop","duration":{"type":"until_end_of_turn"}}]}]}`,
	},
}

func inspiringLeaderActionMechanics(ability string) string {
	return fmt.Sprintf(`{
  "activation":{"mode":"active","cost":[{"resource":"inspiring_leader_rest","amount":1}]},
  "targeting":{"domain":"actor","actor_targets":true,"shape":"sphere","range_ft":30,
    "min_targets":1,"max_targets":6,"requires_line_of_sight":false,"allowed_relations":["self","ally"]},
  "effects":[{"resolution":"auto","who":"target","result":[
    {"kind":"temp_hp","amount":"self_level + %s"}
  ]}]
}`, ability)
}

// repairGeneralFeatRuntimeIntegrity closes concrete execution gaps found
// by the 43-feat audit. It deliberately leaves support untested until each
// sheet/combat/clarity dimension is exercised through the browser.
func repairGeneralFeatRuntimeIntegrity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("disable mechanics guards: %w", err)
	}

	if _, err = tx.Exec(`INSERT INTO resources(resource_id,name,name_en,description,category,recharge,sort_order)
		VALUES('inspiring_leader_rest','Воодушевляющее выступление','Inspiring Leader Rest Speech',
		'Одно воодушевляющее выступление после завершения короткого или долгого отдыха.','feat','short_rest',1820)
		ON CONFLICT(resource_id) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,
		description=EXCLUDED.description,category=EXCLUDED.category,recharge=EXCLUDED.recharge,
		deleted_at=NULL,updated_at=NOW()`); err != nil {
		return fmt.Errorf("upsert Inspiring Leader resource: %w", err)
	}

	for _, seed := range inspiringLeaderActionSeeds {
		mechanics := inspiringLeaderActionMechanics(seed.ability)
		result, execErr := tx.Exec(`INSERT INTO actions
			(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES($1::uuid,$2,'Inspiring Performance',
			'После отдыха выберите до шести союзников в пределах 30 футов. Каждый получает временные хиты: уровень + модификатор выбранной характеристики.',
			'','common',$3,'class_feature','feat','free_action',$4::jsonb,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$5::text,'mechanics_locked',false,
			'note','Chosen Wisdom/Charisma is bound to the exact action formula; browser verification pending'))
			ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,action_type=EXCLUDED.action_type,type=EXCLUDED.type,
			resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,
			deleted_at=NULL,updated_at=NOW()`, seed.id, seed.name, seed.card, mechanics, generalFeatRuntimeIntegrityVersion)
		if execErr != nil {
			return fmt.Errorf("upsert %s: %w", seed.card, execErr)
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return fmt.Errorf("upsert %s rows=%d, want 1", seed.card, rows)
		}
	}

	for _, seed := range generalFeatRuntimeActionSeeds {
		result, execErr := tx.Exec(`INSERT INTO actions
			(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES($1::uuid,$2::text,'',$2::text,'','common',$3,'class_feature','feat',$4,$5::jsonb,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$6::text,'mechanics_locked',false,
			'note','Executable General-feat runtime action; browser verification pending'))
			ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
			action_type=EXCLUDED.action_type,type=EXCLUDED.type,resource=EXCLUDED.resource,
			mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`,
			seed.id, seed.name, seed.card, seed.resource, seed.mechanics, generalFeatRuntimeIntegrityVersion)
		if execErr != nil {
			return fmt.Errorf("upsert %s: %w", seed.card, execErr)
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return fmt.Errorf("upsert %s rows=%d, want 1", seed.card, rows)
		}
	}

	// Project runtime ownership and the exact actions from immutable feat
	// effects. These remain untested until their relevant browser dimensions
	// pass; capability presence is never treated as certification.
	featRuntimeBindings := []struct {
		card, capability string
		actions          []string
	}{
		{"EFF-general-FEAT-0015", "general_feat.grappler", nil},
		{"EFF-general-FEAT-0032", "general_feat.shield_master", []string{"ACT-general-shield-master-push", "ACT-general-shield-master-prone"}},
		{"EFF-general-FEAT-0035", "general_feat.charger", []string{"ACT-general-charger-damage", "ACT-general-charger-push"}},
		{"EFF-general-FEAT-0036", "general_feat.defensive_duelist", []string{"ACT-general-defensive-duelist"}},
		{"EFF-general-FEAT-0045", "general_feat.sentinel", []string{"ACT-general-sentinel-stop"}},
	}
	for _, binding := range featRuntimeBindings {
		for _, action := range binding.actions {
			if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects}',
				COALESCE(mechanics->'effects','[]'::jsonb)||jsonb_build_array(
				jsonb_build_object('resolution','auto','result',jsonb_build_array(
				jsonb_build_object('kind','grant_action','value',$1::text)))),true)
				WHERE card_number=$2 AND deleted_at IS NULL
				AND NOT mechanics::text LIKE ('%'||$1::text||'%')`, action, binding.card); err != nil {
				return fmt.Errorf("grant %s from %s: %w", action, binding.card, err)
			}
		}
		if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{capabilities}',
			COALESCE(mechanics->'capabilities','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',$1::text)),true)
			WHERE card_number=$2 AND deleted_at IS NULL
			AND NOT COALESCE(mechanics->'capabilities','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id',$1::text))`,
			binding.capability, binding.card); err != nil {
			return fmt.Errorf("project %s capability: %w", binding.card, err)
		}
	}

	// Actor's check benefit now speaks the same typed roll/filter language as
	// the d20 collector. The mimicry DC remains an inspectable rule fact.
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{capabilities}',
		'[{"id":"general_feat.actor"}]'::jsonb,true),updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0012' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("project Actor capability: %w", err)
	}
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,result,0,applies_to}',
		'{"roll":"ability_check","filter":{"skill":["deception","performance"],"context":"impersonation"}}'::jsonb,true),
		updated_at=NOW() WHERE card_number='EFF-general-FEAT-0012' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("normalize Actor check filter: %w", err)
	}

	if _, err = tx.Exec(`INSERT INTO effects
		(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
		VALUES('18200000-0000-4000-8000-000000000020','Страж: скорость 0','Sentinel: Speed 0',
		'Попадание провоцированной атакой устанавливает скорость цели 0 до конца текущего хода.','','','common',
		'EFF-general-sentinel-stop','feat_ability',
		'{"activation":{"mode":"passive"},"duration":{"type":"until_end_of_turn"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"set","value":0,"applies_to":{"roll":"speed"}}]}]}'::jsonb,
		true,'System','PHB 2024',jsonb_build_object('status','untested','certification_version',$1::text,
		'mechanics_locked',false,'note','Exact library effect for a Sentinel opportunity hit; browser verification pending'))
		ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,
		description=EXCLUDED.description,effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
		repeatable=EXCLUDED.repeatable,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`,
		generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("upsert Sentinel stop effect: %w", err)
	}

	// FEAT-0049 used a historical bare string as support metadata. Replace it
	// with the same structured, truthful audit contract as every other feat.
	if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Both +2 and +1/+1 level-up branches are data-driven; browser verification pending'),updated_at=NOW()
		WHERE card_number='FEAT-0049' AND deleted_at IS NULL`, generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("repair Ability Score Improvement support: %w", err)
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Both +2 and +1/+1 level-up branches are data-driven; browser verification pending'),updated_at=NOW()
		WHERE card_number='asi_ability_choice' AND deleted_at IS NULL`, generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("repair Ability Score Improvement effect support: %w", err)
	}

	result, err := tx.Exec(`UPDATE effects SET mechanics=$1::jsonb,
		support=jsonb_build_object('status','untested','certification_version',$2::text,
		'mechanics_locked',false,'note','Chosen Wisdom/Charisma grants the matching executable action; browser verification pending'),
		updated_at=NOW() WHERE card_number='EFF-general-FEAT-0020' AND deleted_at IS NULL`,
		inspiringLeaderMechanics, generalFeatRuntimeIntegrityVersion)
	if err != nil {
		return fmt.Errorf("repair Inspiring Leader effect: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("repair Inspiring Leader rows=%d, want 1", rows)
	}

	result, err = tx.Exec(`UPDATE actions SET mechanics=$1::jsonb,
		support=jsonb_build_object('status','untested','certification_version',$2::text,
		'mechanics_locked',false,'note','Uses the owner Hit Die and Constitution modifier; browser verification pending'),
		updated_at=NOW() WHERE card_number='ACT-general-durable' AND deleted_at IS NULL`,
		durableActionMechanics, generalFeatRuntimeIntegrityVersion)
	if err != nil {
		return fmt.Errorf("repair Durable action: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("repair Durable rows=%d, want 1", rows)
	}

	result, err = tx.Exec(`UPDATE effects SET
		mechanics=jsonb_set(mechanics,'{capabilities}',
			'[{"id":"general_feat.dual_wielder"}]'::jsonb,true),updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0011' AND deleted_at IS NULL`)
	if err != nil {
		return fmt.Errorf("project Dual Wielder capability: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("project Dual Wielder rows=%d, want 1", rows)
	}

	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note',CASE card_number
			WHEN 'EFF-general-FEAT-0011' THEN 'Dual Wielder one-handed melee extra-weapon policy is executable; browser verification pending'
			WHEN 'EFF-general-FEAT-0026' THEN 'Crusher critical-hit advantage rider is executable for bludgeoning weapons; browser verification pending'
			WHEN 'EFF-general-FEAT-0030' THEN 'Medium-armor Dexterity cap is consumed by the AC pipeline; browser verification pending'
			WHEN 'EFF-general-FEAT-0038' THEN 'Poison damage ignores poison resistance through the declared passive; crafting and browser verification pending'
			WHEN 'EFF-general-FEAT-0042' THEN 'Slasher critical-hit attack-disadvantage rider is executable for slashing weapons; browser verification pending'
			WHEN 'EFF-general-FEAT-0052' THEN 'Crossbow Expert adds the ability modifier only to its Light-property crossbow attack; browser verification pending'
			ELSE 'General-feat runtime integrity repaired; browser verification pending' END),updated_at=NOW()
		WHERE card_number IN ('EFF-general-FEAT-0011','EFF-general-FEAT-0020','EFF-general-FEAT-0026','EFF-general-FEAT-0030','EFF-general-FEAT-0038','EFF-general-FEAT-0042','EFF-general-FEAT-0044','EFF-general-FEAT-0052') AND deleted_at IS NULL`,
		generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("mark repaired effects untested: %w", err)
	}
	if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','General-feat runtime integrity repaired; browser verification pending'),updated_at=NOW()
		WHERE card_number IN ('FEAT-0011','FEAT-0020','FEAT-0026','FEAT-0030','FEAT-0038','FEAT-0042','FEAT-0044','FEAT-0052') AND deleted_at IS NULL`,
		generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("mark repaired feats untested: %w", err)
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','General-feat runtime primitives repaired; browser verification pending'),updated_at=NOW()
		WHERE card_number IN ('EFF-general-FEAT-0012','EFF-general-FEAT-0015','EFF-general-FEAT-0032',
		'EFF-general-FEAT-0035','EFF-general-FEAT-0036','EFF-general-FEAT-0045') AND deleted_at IS NULL`,
		generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("mark additional repaired effects untested: %w", err)
	}
	if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','General-feat runtime primitives repaired; browser verification pending'),updated_at=NOW()
		WHERE card_number IN ('FEAT-0012','FEAT-0015','FEAT-0032','FEAT-0035','FEAT-0036','FEAT-0045')
		AND deleted_at IS NULL`, generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("mark additional repaired feats untested: %w", err)
	}

	var verified int
	if err = tx.QueryRow(`SELECT
		(SELECT count(*) FROM actions WHERE card_number IN
		 ('ACT-general-inspiring-leader-wis','ACT-general-inspiring-leader-cha')
		 AND deleted_at IS NULL AND support->>'status'='untested')
		+
		(SELECT count(*) FROM actions WHERE card_number='ACT-general-durable' AND deleted_at IS NULL
		 AND mechanics#>>'{effects,0,result,0,hit_die_modifier}'='con')`).Scan(&verified); err != nil {
		return fmt.Errorf("verify repaired actions: %w", err)
	}
	if verified != 3 {
		return fmt.Errorf("verified repaired actions=%d, want 3", verified)
	}
	var dualWielder int
	if err = tx.QueryRow(`SELECT count(*) FROM effects WHERE card_number='EFF-general-FEAT-0011'
		AND deleted_at IS NULL AND mechanics@>'{"capabilities":[{"id":"general_feat.dual_wielder"}]}'::jsonb`).
		Scan(&dualWielder); err != nil {
		return fmt.Errorf("verify Dual Wielder capability: %w", err)
	}
	if dualWielder != 1 {
		return fmt.Errorf("Dual Wielder capability rows=%d, want 1", dualWielder)
	}

	result, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(
		jsonb_set(mechanics,'{effects,1,result,1,op}','"critical_extra_die"'::jsonb,true),
		'{effects,1,result,1,applies_to}',
		'{"roll":"damage","filter":{"attackKind":"weapon","damageType":"piercing","critical":true}}'::jsonb,true),
		updated_at=NOW() WHERE card_number='EFF-general-FEAT-0039' AND deleted_at IS NULL
		AND mechanics#>>'{effects,1,result,1,kind}'='modifier'`)
	if err != nil {
		return fmt.Errorf("normalize Piercer critical die: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("normalize Piercer rows=%d, want 1", rows)
	}
	// The mechanics update above follows the shared support batch so restore the
	// explicit audit status after mechanics-protection invalidation.
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Piercer reroll and one extra critical weapon die are executable; browser verification pending'),updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0039' AND deleted_at IS NULL`, generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("mark Piercer untested: %w", err)
	}
	if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Piercer runtime integrity repaired; browser verification pending'),updated_at=NOW()
		WHERE card_number='FEAT-0039' AND deleted_at IS NULL`, generalFeatRuntimeIntegrityVersion); err != nil {
		return fmt.Errorf("mark Piercer feat untested: %w", err)
	}

	result, err = tx.Exec(`UPDATE effects SET
		mechanics=jsonb_set(mechanics,'{duration,type}','"until_start_of_source_next_turn"'::jsonb,true),
		support=jsonb_build_object('status','untested','certification_version',$1::text,
		'mechanics_locked',false,'note','Slasher speed and critical riders expire at the start of the attacker source next turn; browser verification pending'),
		updated_at=NOW() WHERE card_number='EFF-general-slasher-slow' AND deleted_at IS NULL`,
		generalFeatRuntimeIntegrityVersion)
	if err != nil {
		return fmt.Errorf("repair Slasher slow duration: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("repair Slasher slow duration rows=%d, want 1", rows)
	}

	return tx.Commit()
}
