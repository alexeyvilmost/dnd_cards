package migrations

import (
	"database/sql"
	"fmt"
)

const levelThreeCoreMigrationVersion = "165_materialize_level_three_core"

type levelThreeCoreAction struct {
	id, card, name, nameEn, description, resource, mechanics string
}

var levelThreeCoreActions = []levelThreeCoreAction{
	{
		"16500000-0000-4000-8000-000000000001", "ACT-monk-deflect-attacks",
		"Отразить атаку", "Deflect Attacks",
		"Реакцией уменьшите дробящий, колющий или рубящий урон на 1к10 + Ловкость + уровень Монаха.",
		"reaction",
		`{"activation":{"mode":"reaction","cost":[{"resource":"reaction"}],"trigger":{"event":"damage_taken","timing":"after"}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"1d10 + dex + class_level:monk","filter":{"damage_types":["bludgeoning","piercing","slashing"]}}]}]}`,
	},
	{
		"16500000-0000-4000-8000-000000000002", "ACT-monk-deflect-redirect",
		"Перенаправить отражённую атаку", "Redirect Deflected Attack",
		"Если Отражение снизило урон до 0, потратьте 1 Фокус: цель делает спасбросок Ловкости и при провале получает 2к6 + Ловкость урона Чистой силой, при успехе — половину.",
		"free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"focus"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"save","ability":"dex","dc":"8 + prof + wis","on_fail":[{"kind":"damage","amount":"2d6 + dex","type":"force"}],"on_success":[{"kind":"damage","amount":"floor((2d6 + dex)/2)","type":"force"}]}]}`,
	},
	{
		"16500000-0000-4000-8000-000000000003", "ACT-paladin-divine-sense",
		"Божественное чувство", "Divine Sense",
		"На 10 минут узнавайте местоположение и тип Небожителей, Исчадий и Нежити в пределах 60 футов, а также присутствие освящённых и осквернённых мест или предметов.",
		"bonus_action",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFFECT-paladin-divine-sense"}]}]}`,
	},
	{
		"16500000-0000-4000-8000-000000000004", "ACT-rogue-steady-aim",
		"Точный прицел", "Steady Aim",
		"Если вы ещё не двигались в этот ход, Бонусным действием получите Преимущество на следующую атаку этого хода; ваша Скорость становится 0 до конца хода.",
		"bonus_action",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFFECT-rogue-steady-aim-advantage"},{"kind":"grant_effect","value":"EFFECT-rogue-steady-aim-speed"}]}]}`,
	},
}

type levelThreeCoreEffect struct {
	id, card, name, nameEn, description, mechanics string
}

var levelThreeCoreEffects = []levelThreeCoreEffect{
	{
		"16500000-0000-4000-8000-000000000101", "EFF-monk-deflect-attacks",
		"Отражение атак", "Deflect Attacks",
		"Открывает реакцию уменьшения физического урона и отдельное продолжение для перенаправления полностью отражённой атаки.",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","values":["ACT-monk-deflect-attacks","ACT-monk-deflect-redirect"]}]}]}`,
	},
	{
		"16500000-0000-4000-8000-000000000102", "EFF-paladin-channel-divinity",
		"Проведение божественности", "Channel Divinity",
		"Два использования. Одно восстанавливается после Короткого отдыха, все — после Долгого. Открывает Божественное чувство и варианты подкласса.",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-paladin-divine-sense"}]}]}`,
	},
	{
		"16500000-0000-4000-8000-000000000103", "EFF-rogue-steady-aim",
		"Точный прицел", "Steady Aim",
		"Открывает Бонусное действие Точного прицела.",
		`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-rogue-steady-aim"}]}]}`,
	},
	{
		"16500000-0000-4000-8000-000000000104", "EFFECT-paladin-divine-sense",
		"Божественное чувство: восприятие", "Divine Sense: Awareness",
		"Вы знаете местоположение и тип Небожителей, Исчадий и Нежити в пределах 60 футов и чувствуете освящённые или осквернённые места и предметы. Длительность — 10 минут.",
		`{"kind":"information_access","capability":"detect_creature_types_and_hallow","policy":{"range_ft":60,"creature_types":["celestial","fiend","undead"],"detects_active_hallow":true},"duration":{"type":"rounds","amount":100},"stack_id":"paladin:divine-sense","stack_type":"overwrite"}`,
	},
	{
		"16500000-0000-4000-8000-000000000105", "EFFECT-rogue-steady-aim-advantage",
		"Точный прицел: преимущество", "Steady Aim: Advantage",
		"Преимущество на следующую атаку этого хода.",
		`{"kind":"modifier","op":"advantage","consume":"next","applies_to":{"roll":"attack"},"duration":{"type":"until_end_of_turn"},"stack_id":"rogue:steady-aim:advantage","stack_type":"overwrite"}`,
	},
	{
		"16500000-0000-4000-8000-000000000106", "EFFECT-rogue-steady-aim-speed",
		"Точный прицел: скорость 0", "Steady Aim: Speed 0",
		"Скорость становится 0 до конца текущего хода.",
		`{"kind":"modifier","op":"set","value":0,"applies_to":{"roll":"speed"},"duration":{"type":"until_end_of_turn"},"stack_id":"rogue:steady-aim:speed","stack_type":"overwrite"}`,
	},
}

func materializeLevelThreeCore(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
		DROP TRIGGER IF EXISTS protect_classes_certified_mechanics ON classes;
	`); err != nil {
		return fmt.Errorf("disable certified guards: %w", err)
	}

	for _, action := range levelThreeCoreActions {
		if _, err = tx.Exec(`INSERT INTO actions
			(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES ($1::uuid,$2,$3,$4,'','common',$5,'class_feature','class_feature',$6,$7::jsonb,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$8::text,'mechanics_locked',false,'note','Level-3 browser verification pending'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,
			support=EXCLUDED.support,updated_at=NOW()`, action.id, action.name, action.nameEn,
			action.description, action.card, action.resource, action.mechanics, levelThreeCoreMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", action.card, err)
		}
	}

	for _, effect := range levelThreeCoreEffects {
		if _, err = tx.Exec(`INSERT INTO effects
			(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
			VALUES ($1::uuid,$2,$3,$4,'','','common',$5,'class_ability',$6::jsonb,false,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$7::text,'mechanics_locked',false,'note','Level-3 browser verification pending'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
			support=EXCLUDED.support,updated_at=NOW()`, effect.id, effect.name, effect.nameEn,
			effect.description, effect.card, effect.mechanics, levelThreeCoreMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", effect.card, err)
		}
	}

	// The old seed offered only Nature and Insight. Primal Knowledge uses the
	// complete Barbarian level-1 skill list; the rage-based ability substitution
	// stays explicit in the card until the check UI can choose an alternate stat.
	if _, err = tx.Exec(`UPDATE effects SET
		description='Выберите ещё один навык Варвара: Уход за животными, Атлетика, Запугивание, Природа, Восприятие или Выживание. Во время Ярости Акробатика, Запугивание, Восприятие, Скрытность и Выживание могут использовать Силу.',
		mechanics='{"activation":{"mode":"passive"},"effects":[{"kind":"choice","id":"barbarian_primal_skill","prompt":"Первобытные знания: выберите дополнительный навык Варвара","count":1,"resolution":"on_acquire","options":{"source":"explicit","items":[{"id":"animal_handling","name":"Уход за животными"},{"id":"athletics","name":"Атлетика"},{"id":"intimidation","name":"Запугивание"},{"id":"nature","name":"Природа"},{"id":"perception","name":"Восприятие"},{"id":"survival","name":"Выживание"}]},"grant":{"kind":"grant_proficiency","prof":"skill"}},{"resolution":"auto","result":[{"kind":"narrative","description":"Во время Ярости проверки Акробатики, Запугивания, Восприятия, Скрытности и Выживания могут использовать Силу."}]}]}'::jsonb,
		support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Correct skill denominator; alternate-ability roll UI pending'),updated_at=NOW()
		WHERE card_number='EFF-primal-knowledge' AND deleted_at IS NULL`, levelThreeCoreMigrationVersion); err != nil {
		return fmt.Errorf("repair Primal Knowledge: %w", err)
	}

	type progressionBind struct{ classCard, effectCard string }
	for _, binding := range []progressionBind{
		{"CLASS-monk", "EFF-monk-deflect-attacks"},
		{"CLASS-paladin", "EFF-paladin-channel-divinity"},
		{"CLASS-rogue", "EFF-rogue-steady-aim"},
	} {
		if _, err = tx.Exec(`UPDATE classes c SET level_progression=jsonb_set(COALESCE(c.level_progression,'{}'::jsonb),'{3,effects}',
			CASE WHEN COALESCE(c.level_progression#>'{3,effects}','[]'::jsonb) ? e.id::text
			THEN COALESCE(c.level_progression#>'{3,effects}','[]'::jsonb)
			ELSE COALESCE(c.level_progression#>'{3,effects}','[]'::jsonb)||jsonb_build_array(e.id::text) END,true),updated_at=NOW()
			FROM effects e WHERE c.card_number=$1 AND e.card_number=$2 AND c.deleted_at IS NULL AND e.deleted_at IS NULL`,
			binding.classCard, binding.effectCard); err != nil {
			return fmt.Errorf("bind %s to %s: %w", binding.effectCard, binding.classCard, err)
		}
	}

	if _, err = tx.Exec(`UPDATE classes SET resources=jsonb_set(COALESCE(resources,'{}'::jsonb),'{channel_divinity}',
		'{"by_level":{"3":2,"11":3},"per":"short_rest","recovery":{"short_rest":{"mode":"fixed","amount":1},"long_rest":{"mode":"full"}}}'::jsonb,true),updated_at=NOW()
		WHERE card_number='CLASS-paladin' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("add Paladin Channel Divinity resource: %w", err)
	}
	if _, err = tx.Exec(`UPDATE classes SET resources=jsonb_set(COALESCE(resources,'{}'::jsonb),'{focus,by_level,3}','3'::jsonb,true),updated_at=NOW()
		WHERE card_number='CLASS-monk' AND deleted_at IS NULL`); err != nil {
		return fmt.Errorf("scale Monk Focus: %w", err)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified guards: %w", err)
	}
	return tx.Commit()
}
