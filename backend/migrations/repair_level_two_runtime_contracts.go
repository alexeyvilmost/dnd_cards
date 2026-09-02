package migrations

import (
	"database/sql"
	"fmt"
)

const levelTwoRuntimeRepairMigrationVersion = "162_repair_level_two_runtime_contracts"

// repairLevelTwoRuntimeContracts keeps the level-2 catalog aligned with the
// 2024 rules at the action boundary. The earlier materialization made these
// rows visible, but retained legacy timing and choice contracts.
func repairLevelTwoRuntimeContracts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;`); err != nil {
		return err
	}

	if _, err = tx.Exec(`
		UPDATE actions
		SET action_type = 'class_feature',
			resource = 'free_action',
			description = 'Без действия потратьте ячейку заклинания 1 круга и восстановите 1 очко чародейства.',
			mechanics = '{"activation":{"mode":"active","cost":[{"resource":"spell_slot_1"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"sorcery_points","amount":1}]}]}'::jsonb,
			support = jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Corrected no-action Font of Magic conversion; browser verification pending'),
			updated_at = NOW()
		WHERE card_number = 'ACT-font-convert-slot-1' AND deleted_at IS NULL
	`, levelTwoRuntimeRepairMigrationVersion); err != nil {
		return fmt.Errorf("repair Font of Magic conversion: %w", err)
	}

	if _, err = tx.Exec(`
		UPDATE actions
		SET description = 'Получите дополнительное Действие в этом ходу, которое нельзя потратить на Магическое действие; один раз до короткого или долгого отдыха.',
			mechanics = '{"activation":{"mode":"active","cost":[{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"grant_capped","id":"action_surge_action","amount":1,"max":1}]}],"uses":{"count":1,"per":"short_rest"}}'::jsonb,
			support = jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Non-Magic extra-action economy repaired; browser verification pending'),
			updated_at = NOW()
		WHERE card_number = 'ACT-action-surge' AND deleted_at IS NULL
	`, levelTwoRuntimeRepairMigrationVersion); err != nil {
		return fmt.Errorf("repair Action Surge economy: %w", err)
	}

	if _, err = tx.Exec(`
		UPDATE actions
		SET description = 'Бонусным действием примите один из четырёх известных обликов зверя с ПО не выше 1/4 и без скорости полёта. Получите 2 временных хита и сохраняйте облик 1 час.',
			mechanics = '{
				"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"wild_shape"}]},
				"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},
				"effects":[{
					"kind":"choice","id":"wild_shape_form","prompt":"Выберите известный облик зверя","count":1,"context":"in_play","resolution":"on_use",
					"options":{"source":"explicit","items":[
						{"id":"rat","name":"Крыса","grants":[{"kind":"grant_effect","value":"EFFECT-wild-shape-rat"},{"kind":"temp_hp","amount":2}]},
						{"id":"riding_horse","name":"Верховая лошадь","grants":[{"kind":"grant_effect","value":"EFFECT-wild-shape-riding-horse"},{"kind":"temp_hp","amount":2}]},
						{"id":"spider","name":"Паук","grants":[{"kind":"grant_effect","value":"EFFECT-wild-shape-spider"},{"kind":"temp_hp","amount":2}]},
						{"id":"wolf","name":"Волк","grants":[{"kind":"grant_effect","value":"EFFECT-wild-shape-wolf"},{"kind":"temp_hp","amount":2}]}
					]}
				}]
			}'::jsonb,
			support = jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Corrected runtime choice and recommended forms; browser verification pending'),
			updated_at = NOW()
		WHERE card_number = 'ACT-wild-shape' AND deleted_at IS NULL
	`, levelTwoRuntimeRepairMigrationVersion); err != nil {
		return fmt.Errorf("repair Wild Shape runtime contract: %w", err)
	}

	// Wild Shape is represented by real library effects. Besides giving every
	// sheet/mini-sheet an exact hover card, the shared stack id guarantees that
	// choosing another form replaces the previous form instead of accumulating
	// incompatible statistics.
	wildShapeEffects := []struct {
		id, card, name, nameEn, description, mechanics string
	}{
		{"16200000-0000-4000-8000-000000000101", "EFFECT-wild-shape-rat", "Дикий облик: Крыса", "Wild Shape: Rat", "КЗ 10; скорость 20 фт., лазание 20 фт.; СИЛ 2, ЛВК 11, ТЕЛ 9. Тёмное зрение 30 фт. Проворная: перемещение не провоцирует атаки по возможности. Доступен Укус (+2, 1 колющего урона).", `{"activation":{"mode":"passive"},"duration":{"type":"hours","amount":1},"stack_id":"wild_shape_form","wild_shape":{"form":"rat","ac":10,"speed":20,"climb":20,"size":0,"str":2,"dex":11,"con":9,"darkvision_ft":30},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"set","value":10,"applies_to":{"roll":"ac"}},{"kind":"modifier","op":"set","value":20,"applies_to":{"roll":"speed"}},{"kind":"modifier","op":"set","value":0,"applies_to":{"roll":"size"}},{"kind":"modifier","op":"deny","applies_to":{"roll":"spellcasting"}},{"kind":"modifier","op":"deny","applies_to":{"roll":"opportunity_attack","filter":{"trigger":"self_movement"}}}]}]}`},
		{"16200000-0000-4000-8000-000000000102", "EFFECT-wild-shape-riding-horse", "Дикий облик: Верховая лошадь", "Wild Shape: Riding Horse", "КЗ 11; скорость 60 фт.; СИЛ 16, ЛВК 13, ТЕЛ 12; Большой размер. Доступны Копыта (+5, 1к8 + 3 дробящего урона).", `{"activation":{"mode":"passive"},"duration":{"type":"hours","amount":1},"stack_id":"wild_shape_form","wild_shape":{"form":"riding_horse","ac":11,"speed":60,"size":3,"str":16,"dex":13,"con":12},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"set","value":11,"applies_to":{"roll":"ac"}},{"kind":"modifier","op":"set","value":60,"applies_to":{"roll":"speed"}},{"kind":"modifier","op":"set","value":3,"applies_to":{"roll":"size"}},{"kind":"modifier","op":"deny","applies_to":{"roll":"spellcasting"}}]}]}`},
		{"16200000-0000-4000-8000-000000000103", "EFFECT-wild-shape-spider", "Дикий облик: Паук", "Wild Shape: Spider", "КЗ 12; скорость 20 фт., лазание 20 фт.; СИЛ 2, ЛВК 14, ТЕЛ 8. Тёмное зрение 30 фт.; Паучье лазание и Хождение по паутине. Доступен Укус (+4, 1 колющий + 1к4 ядовитого урона).", `{"activation":{"mode":"passive"},"duration":{"type":"hours","amount":1},"stack_id":"wild_shape_form","wild_shape":{"form":"spider","ac":12,"speed":20,"climb":20,"size":0,"str":2,"dex":14,"con":8,"darkvision_ft":30,"traits":["spider_climb","web_walker"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"set","value":12,"applies_to":{"roll":"ac"}},{"kind":"modifier","op":"set","value":20,"applies_to":{"roll":"speed"}},{"kind":"modifier","op":"set","value":0,"applies_to":{"roll":"size"}},{"kind":"modifier","op":"deny","applies_to":{"roll":"spellcasting"}}]}]}`},
		{"16200000-0000-4000-8000-000000000104", "EFFECT-wild-shape-wolf", "Дикий облик: Волк", "Wild Shape: Wolf", "КЗ 12; скорость 40 фт.; СИЛ 14, ЛВК 15, ТЕЛ 12. Тёмное зрение 60 фт.; Тактика стаи. Доступен Укус (+4, 1к6 + 2 колющего урона; цель Среднего размера или меньше падает Ничком).", `{"activation":{"mode":"passive"},"duration":{"type":"hours","amount":1},"stack_id":"wild_shape_form","wild_shape":{"form":"wolf","ac":12,"speed":40,"size":2,"str":14,"dex":15,"con":12,"darkvision_ft":60,"traits":["pack_tactics"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"set","value":12,"applies_to":{"roll":"ac"}},{"kind":"modifier","op":"set","value":40,"applies_to":{"roll":"speed"}},{"kind":"modifier","op":"set","value":2,"applies_to":{"roll":"size"}},{"kind":"modifier","op":"deny","applies_to":{"roll":"spellcasting"}}]}]}`},
	}
	for _, effect := range wildShapeEffects {
		if _, err = tx.Exec(`INSERT INTO effects (id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
			VALUES ($1::uuid,$2,$3,$4,$4,'','common',$5,'class_ability',$6::jsonb,false,'System','SRD 5.2.1',jsonb_build_object('status','untested','certification_version',$7::text,'mechanics_locked',false,'note','Wild Shape browser verification pending'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,detailed_description=EXCLUDED.detailed_description,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,updated_at=NOW()`, effect.id, effect.name, effect.nameEn, effect.description, effect.card, effect.mechanics, levelTwoRuntimeRepairMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", effect.card, err)
		}
	}

	wildShapeActions := []struct {
		id, card, name, description, requiredEffect, mechanics string
	}{
		{"16200000-0000-4000-8000-000000000201", "ACT-wild-shape-rat-bite", "Крыса: Укус", "Рукопашная атака +2; 1 колющего урона.", "EFFECT-wild-shape-rat", `{"requires_active_effect":"EFFECT-wild-shape-rat","activation":{"mode":"active","cost":[{"resource":"action"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"attack_roll","attack_kind":"melee","ability":"str","attack_bonus_override":2,"vs":"ac","on_hit":[{"kind":"damage","amount":1,"type":"piercing"}]}]}`},
		{"16200000-0000-4000-8000-000000000202", "ACT-wild-shape-riding-horse-hooves", "Верховая лошадь: Копыта", "Рукопашная атака +5; 1к8 + 3 дробящего урона.", "EFFECT-wild-shape-riding-horse", `{"requires_active_effect":"EFFECT-wild-shape-riding-horse","activation":{"mode":"active","cost":[{"resource":"action"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"attack_roll","attack_kind":"melee","ability":"str","attack_bonus_override":5,"vs":"ac","on_hit":[{"kind":"damage","amount":"1d8 + 3","type":"bludgeoning"}]}]}`},
		{"16200000-0000-4000-8000-000000000203", "ACT-wild-shape-spider-bite", "Паук: Укус", "Рукопашная атака +4; 1 колющего + 1к4 ядовитого урона.", "EFFECT-wild-shape-spider", `{"requires_active_effect":"EFFECT-wild-shape-spider","activation":{"mode":"active","cost":[{"resource":"action"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"attack_roll","attack_kind":"melee","ability":"dex","attack_bonus_override":4,"vs":"ac","on_hit":[{"kind":"damage","amount":1,"type":"piercing"},{"kind":"damage","amount":"1d4","type":"poison"}]}]}`},
		{"16200000-0000-4000-8000-000000000204", "ACT-wild-shape-wolf-bite", "Волк: Укус", "Рукопашная атака +4; 1к6 + 2 колющего урона; цель Среднего размера или меньше падает Ничком.", "EFFECT-wild-shape-wolf", `{"requires_active_effect":"EFFECT-wild-shape-wolf","activation":{"mode":"active","cost":[{"resource":"action"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"attack_roll","attack_kind":"melee","ability":"str","attack_bonus_override":4,"vs":"ac","on_hit":[{"kind":"damage","amount":"1d6 + 2","type":"piercing"},{"kind":"grant_effect","value":"COND-prone"}]}]}`},
	}
	for _, action := range wildShapeActions {
		if _, err = tx.Exec(`INSERT INTO actions (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES ($1::uuid,$2,$2,$3,'','common',$4,'class_feature','class_feature','action',$5::jsonb,'System','SRD 5.2.1',jsonb_build_object('status','untested','certification_version',$6::text,'mechanics_locked',false,'note','Wild Shape browser verification pending'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,description=EXCLUDED.description,resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,updated_at=NOW()`, action.id, action.name, action.description, action.card, action.mechanics, levelTwoRuntimeRepairMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", action.card, err)
		}
		if _, err = tx.Exec(`UPDATE classes SET level_progression=jsonb_set(level_progression,'{2,actions}',COALESCE(level_progression#>'{2,actions}','[]'::jsonb)||jsonb_build_array($1::text),true),updated_at=NOW() WHERE card_number='CLASS-druid' AND NOT (COALESCE(level_progression#>'{2,actions}','[]'::jsonb) ? $1::text)`, action.id); err != nil {
			return fmt.Errorf("grant %s to druid level 2: %w", action.card, err)
		}
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return err
	}
	return tx.Commit()
}
