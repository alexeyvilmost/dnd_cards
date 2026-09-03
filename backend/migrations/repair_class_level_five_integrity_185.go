package migrations

import (
	"database/sql"
	"fmt"
)

// This repair deliberately leaves every touched row untested.  It closes
// concrete executable gaps found by the class/subclass level-5 audit, but the
// browser sheet/combat/clarity pass remains the certification authority.
const classLevelFiveIntegrityVersion = "185_repair_class_level_five_integrity"

type classLevelFiveEffectRepair struct {
	card, mechanics, note string
}

var classLevelFiveEffectRepairs = []classLevelFiveEffectRepair{
	{
		"EFFECT-0058",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"crit_range","value":-1,"applies_to":{"roll":"attack","filter":{"attackKind":"weapon"}}},{"kind":"modifier","op":"crit_range","value":-1,"applies_to":{"roll":"attack","filter":{"attackKind":"unarmed"}}}]}]}`,
		"Weapon and Unarmed Strike attack rolls now use the executable 19-20 critical range; browser verification pending.",
	},
	{
		"EFFECT-0233",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"class_level:sorcerer","applies_to":{"roll":"max_hp"}},{"kind":"set_value","target":"ac_base","formula":"10 + dex + cha"}]}]}`,
		"Draconic Resilience now scales maximum HP by Sorcerer level and exposes its unarmored AC method; browser verification pending.",
	},
	{
		"EFFECT-0215",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"1d4","type":"psychic","scope":"self","filter":{"attackKind":"weapon"},"once_per_turn":"fey-wanderer:dreadful-strikes","duration":{"type":"manual"}}]}]}`,
		"The first weapon hit each turn receives the executable Psychic rider. The per-creature reset nuance still needs a target-keyed ledger; browser verification pending.",
	},
	{
		"EFFECT-0217",
		`{"activation":{"mode":"passive"},"effects":[{"kind":"choice","id":"fey_wanderer_otherworldly_glamour_skill","count":1,"resolution":"on_acquire","prompt":"Потустороннее очарование: выберите владение навыком","options":{"source":"explicit","items":[{"id":"deception","name":"Обман"},{"id":"performance","name":"Выступление"},{"id":"persuasion","name":"Убеждение"}]},"grant":{"kind":"grant_proficiency","prof":"skill"}},{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"max(1,wis)","applies_to":{"roll":"ability_check","filter":{"ability":"cha"}}}]}]}`,
		"The declared Charisma-check bonus and one-of-three skill proficiency are executable; browser verification pending.",
	},
	{
		"EFFECT-0187",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_speed","mode":"climb","value":"character_speed"},{"kind":"narrative","description":"Дальность прыжков определяется по Ловкости, а не по Силе; тактический расчёт прыжка пока требует решения ведущего."}]}]}`,
		"The climb speed is executable and visible. Dexterity-based jump distance remains a disclosed board limitation; browser verification pending.",
	},
}

type classLevelFiveActionRepair struct {
	card, actionType, resource, mechanics, note string
}

var classLevelFiveActionRepairs = []classLevelFiveActionRepair{
	{
		"ACT-monk-slow-fall", "class_feature", "reaction",
		`{"activation":{"mode":"reaction","cost":[{"resource":"reaction"}],"trigger":{"event":"damage_taken","filter":{"source":"fall"}}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"5 * class_level:monk","filter":{"source":"fall"}}]}]}`,
		"Replaced the nonexistent monk_level token with the canonical class_level:monk formula; browser verification pending.",
	},
	{
		"ACT-subclass-EFFECT-0106", "class_feature", "bonus_action",
		`{"uses":{"count":"max(1,wis)","per":"short_rest"},"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"attack_roll","attack_kind":"weapon_melee","ability":"auto","vs":"ac","on_hit":[{"kind":"damage","dice":"weapon","type":"weapon"}]}]}`,
		"War Priest now spends one bounded use and performs a real melee-weapon attack. Unarmed and ranged modes still need an attack-declaration choice; browser verification pending.",
	},
}

const vowOfEnmityTargetEffectID = "18500000-0000-4000-8000-000000000001"
const vowOfEnmityTargetEffectCard = "EFFECT-paladin-vow-of-enmity-target"
const vowOfEnmityTargetEffectMechanics = `{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"paladin:vow-of-enmity","stack_type":"overwrite","effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"advantage","scope":"target","applies_to":{"roll":"attack"},"when":[{"kind":"roller_is_condition_source"}]}]}]}`
const vowOfEnmityActionMechanics = `{"activation":{"mode":"active","cost":[{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"grant_effect","value":"EFFECT-paladin-vow-of-enmity-target"}]}]}`

func repairClassLevelFiveIntegrity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock class level-five repairs: %w", err)
	}

	for _, repair := range classLevelFiveEffectRepairs {
		result, execErr := tx.Exec(`UPDATE effects SET mechanics=$2::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$3::text,
			'mechanics_locked',false,'note',$4::text),updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`,
			repair.card, repair.mechanics, classLevelFiveIntegrityVersion, repair.note)
		if execErr != nil {
			return fmt.Errorf("repair effect %s: %w", repair.card, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair effect %s affected %d rows: %w", repair.card, rows, rowsErr)
		}
	}

	for _, repair := range classLevelFiveActionRepairs {
		result, execErr := tx.Exec(`UPDATE actions SET action_type=$2,resource=$3,mechanics=$4::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$5::text,
			'mechanics_locked',false,'note',$6::text),updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`,
			repair.card, repair.actionType, repair.resource, repair.mechanics,
			classLevelFiveIntegrityVersion, repair.note)
		if execErr != nil {
			return fmt.Errorf("repair action %s: %w", repair.card, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair action %s affected %d rows: %w", repair.card, rows, rowsErr)
		}
	}

	if _, err = tx.Exec(`INSERT INTO effects
		(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,
		 mechanics,repeatable,author,source,support)
		VALUES($1::uuid,'Обет вражды: цель','Vow of Enmity: Target',
		 'Только наложивший Обет паладин совершает броски атаки по этой цели с Преимуществом.','','',
		 'common',$2,'positive_effect',$3::jsonb,false,'System','PHB 2024',
		 jsonb_build_object('status','untested','certification_version',$4::text,
		 'mechanics_locked',false,'note','Owner-bound target marker; browser verification pending'))
		ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,
		description=EXCLUDED.description,effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
		support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`,
		vowOfEnmityTargetEffectID, vowOfEnmityTargetEffectCard,
		vowOfEnmityTargetEffectMechanics, classLevelFiveIntegrityVersion); err != nil {
		return fmt.Errorf("upsert Vow of Enmity target effect: %w", err)
	}

	result, err := tx.Exec(`UPDATE actions SET action_type='class_feature',resource='free_action',
		mechanics=$2::jsonb,
		support=jsonb_build_object('status','untested','certification_version',$3::text,
		'mechanics_locked',false,'note',
		'Applies an exact library-owned, source-bound one-minute target marker. The Attack-action timing and transfer after target defeat remain browser/manual boundaries.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`,
		"ACT-subclass-EFFECT-0166", vowOfEnmityActionMechanics, classLevelFiveIntegrityVersion)
	if err != nil {
		return fmt.Errorf("repair Vow of Enmity action: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Vow of Enmity action affected %d rows: %w", rows, rowsErr)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
