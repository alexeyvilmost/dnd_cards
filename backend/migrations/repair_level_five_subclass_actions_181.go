package migrations

import (
	"database/sql"
	"fmt"
	"strings"
)

const levelFiveSubclassActionsRepairVersion = "181_repair_level_five_subclass_actions"

type levelFiveSubclassActionRepair struct {
	card, resource, description, mechanics, note string
}

// These rows deliberately own complete action mechanics instead of patching
// the projection produced by migration 167. That projection copied the source
// effect's result-level resource spend and, on a replay, could copy the source's
// later passive activation and grant_action back into the action. A complete
// postimage makes this repair deterministic and replay-safe.
var levelFiveSubclassActionRepairs = []levelFiveSubclassActionRepair{
	{
		"ACT-subclass-EFFECT-0016", "bonus_action",
		"Бонусным действием потратьте Бардовское вдохновение. До шести других союзников в пределах 60 футов получают 2к8 временных хитов; каждый может Реакцией переместиться до своей Скорости без Провоцированных атак.",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"bardic_inspiration"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"multiple","min_targets":1,"max_targets":6,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"temp_hp","amount":"2d8"},{"kind":"narrative","description":"Получившая временные хиты цель может Реакцией переместиться до своей Скорости без Провоцированных атак."}]}]}`,
		"Resource accounting and level-5 temporary HP are executable; reaction movement and the level-3/4 d6 die step still need a dedicated multi-actor choice primitive.",
	},
	{
		"ACT-subclass-EFFECT-0037", "bonus_action",
		"Бонусным действием потратьте одну к12 из запаса Воина богов и восстановите выпавшее количество Хитов. Запас из четырёх костей восстанавливается после Долгого отдыха.",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"healing","amount":"1d12"}]}],"uses":{"count":4,"per":"long_rest"}}`,
		"Safe one-die executable slice; spending several dice in one bonus action needs a variable-cost runtime choice.",
	},
	{
		"ACT-subclass-EFFECT-0111", "action",
		"Действием Магия потратьте Проведение божественности и восстановите одной Окровавленной цели в пределах 30 футов до 5 × уровень Жреца Хитов.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["self","ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"healing","amount":"5 * class_level:cleric"},{"kind":"narrative","description":"Правило ограничивает итог не более чем половиной максимума Хитов цели."}]}]}`,
		"Single-target conservative execution prevents multiplying the healing pool; split allocation and the half-maximum cap still need an allocation/cap primitive.",
	},
	{
		"ACT-subclass-EFFECT-0115", "bonus_action",
		"Бонусным действием потратьте Проведение божественности и создайте Двуличность в видимой точке в пределах 30 футов на 1 минуту.",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"world","actor_targets":false,"shape":"single","min_targets":0,"max_targets":0,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":[]},"effects":[{"resolution":"auto","result":[{"kind":"world_entity","entity_type":"invoke_duplicity","constraints":{"initial_range_ft":30,"tether_ft":120,"intangible":true},"command":{"resource":"bonus_action","operations":["move"],"max_distance_ft":30},"duration":{"type":"minutes","amount":1}},{"kind":"narrative","description":"Заклинания можно творить из пространства иллюзии; когда вы и иллюзия рядом с целью, действует описанное Преимущество."}]}]}`,
		"The illusion lifecycle and command cost are data-driven; spell-origin and proximity advantage still need board integration.",
	},
	{
		"ACT-subclass-EFFECT-0120", "action",
		"Действием Магия потратьте Проведение божественности: выбранные враги в 30-футовой Эманации совершают спасбросок Телосложения и получают 2к10 + уровень Жреца урона Излучением, половину при успехе.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":20,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["enemy","neutral"],"area":{"kind":"sphere","radius_ft":30}},"effects":[{"resolution":"save","who":"target","ability":"con","dc":"8 + prof + spellcasting","on_fail":[{"kind":"damage","dice":"2d10 + class_level:cleric","type":"radiant"}],"on_success":[{"kind":"damage","dice":"2d10 + class_level:cleric","type":"radiant","on_success":"half"}]},{"resolution":"auto","result":[{"kind":"narrative","description":"Магическая Тьма в Эманации рассеивается."}]}]}`,
		"Cost, class-level damage and half-on-save are executable; selective magical-darkness dispelling remains a board adapter operation.",
	},
	{
		"ACT-subclass-EFFECT-0125", "bonus_action",
		"Бонусным действием потратьте одно использование Шагов феи и телепортируйтесь на 30 футов; выберите Освежающий или Дразнящий дополнительный эффект.",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}]},"targeting":{"domain":"world","actor_targets":false,"shape":"single","min_targets":0,"max_targets":0,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":[]},"effects":[{"resolution":"auto","result":[{"kind":"movement","value":"teleport","distance":30},{"kind":"narrative","description":"Выберите Освежающий шаг (1к10 временных хитов) или Дразнящий шаг (спасбросок Мудрости для соседних существ)."}]}],"uses":{"count":"max(1,cha)","per":"long_rest"}}`,
		"Teleport, bonus-action cost and bounded uses are executable; the two post-teleport branches need a destination-aware in-play choice.",
	},
	{
		"ACT-subclass-EFFECT-0142", "bonus_action",
		"Бонусным действием потратьте одну к6 из запаса Лечащего света и восстановите выпавшее количество Хитов себе или видимой цели в пределах 60 футов.",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["self","ally","neutral"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"healing","amount":"1d6"}]}],"uses":{"count":"1 + class_level:warlock","per":"long_rest"}}`,
		"Exploit closed: each activation spends exactly one bounded die before healing; multi-die spending needs a variable-cost runtime choice.",
	},
	{
		"ACT-subclass-EFFECT-0147", "action",
		"Действием Магия потратьте 1 Фокус и восстановите цели в пределах 5 футов Хиты, равные Кости боевых искусств + Мудрость.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"focus"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["self","ally","neutral"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"healing","amount":"martial_arts_die + wis"},{"kind":"narrative","description":"Во время Шквала ударов это лечение может заменить один удар без дополнительной траты Фокуса."}]}]}`,
		"Canonical focus resource and ordinary action healing are executable; Flurry replacement timing needs an attack-replacement offer.",
	},
	{
		"ACT-subclass-EFFECT-0166", "action",
		"Во время действия Атака потратьте Проведение божественности и объявите видимое существо в пределах 30 футов заклятым врагом на 1 минуту.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"narrative","description":"Владелец Обета совершает броски атаки по этой цели с Преимуществом 1 минуту; после падения цели Обет можно перенести."}]}]}`,
		"Resource spend is atomic; source-actor-only targeted advantage and zero-HP transfer need an owner-scoped target marker.",
	},
	{
		"ACT-subclass-EFFECT-0170", "action",
		"Действием Магия потратьте Проведение божественности. Выбранные враги в пределах 15 футов совершают спасбросок Силы; при провале становятся Опутанными на 1 минуту и повторяют спасбросок в конце хода.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":20,"range_ft":0,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"],"area":{"kind":"sphere","radius_ft":15}},"effects":[{"resolution":"save","who":"target","ability":"str","dc":"8 + prof + spellcasting","on_fail":[{"kind":"grant_effect","value":"COND-restrained","duration":{"type":"minutes","amount":1},"save_ends":{"ability":"str","dc":"8 + prof + spellcasting","timing":"end_of_turn"}}],"on_success":[]}]}`,
		"Strict library-owned Restrained identity, 15-foot area, one-minute lifecycle and end-turn repeat save are executable.",
	},
	{
		"ACT-subclass-EFFECT-0176", "action",
		"Во время действия Атака потратьте Проведение божественности и наполните рукопашное оружие священной силой на 10 минут.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Выбранное рукопашное оружие добавляет Харизму (минимум +1) к атакам, может наносить урон Излучением и светится 10 минут."}]}]}`,
		"Resource spend is atomic; an equipped-weapon selection and reversible weapon-enchantment lifecycle are still required.",
	},
	{
		"ACT-subclass-EFFECT-0182", "bonus_action",
		"Бонусным действием потратьте Проведение божественности: 1 час получайте Преимущество на Атлетику и Акробатику, а дальность прыжков увеличивается на 10 футов.",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"advantage","applies_to":{"roll":"ability_check","filter":{"skill":"athletics"}},"duration":{"type":"hours","amount":1},"stack_id":"glory:peerless-athlete:athletics","stack_type":"overwrite"},{"kind":"modifier","op":"advantage","applies_to":{"roll":"ability_check","filter":{"skill":"acrobatics"}},"duration":{"type":"hours","amount":1},"stack_id":"glory:peerless-athlete:acrobatics","stack_type":"overwrite"},{"kind":"narrative","description":"Дальность Прыжков в длину и высоту увеличивается на 10 футов в течение 1 часа."}]}]}`,
		"Channel Divinity spend and typed one-hour skill modifiers are executable; tactical jump-path consumption remains board-owned.",
	},
	{
		"ACT-subclass-EFFECT-0192", "action",
		"Действием Атака создайте и метните Психический клинок в цель в пределах 60 футов; при попадании он наносит 1к6 + Ловкость Психического урона.",
		`{"activation":{"mode":"active","cost":[{"resource":"action"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"attack_roll","who":"target","ability":"dex","vs":"ac","on_hit":[{"kind":"damage","dice":"1d6 + dex","type":"psychic"}]},{"resolution":"auto","result":[{"kind":"narrative","description":"Фехтовальное позволяет вместо Ловкости выбрать Силу; вторичный клинок требует отдельной бонусной атаки."}]}]}`,
		"Unlimited free attack removed: the primary blade now spends the Attack action; Strength selection and the 1d4 bonus blade still need weapon-mode actions.",
	},
	{
		"ACT-subclass-EFFECT-0244", "free_action",
		"До броска потратьте использование Потока хаоса, чтобы получить Преимущество на один Тест к20.",
		`{"activation":{"mode":"active","cost":[{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Преимущество применяется к выбранному следующему Тесту к20; сотворение заклинания Чародея ячейкой может восстановить использование и вызывает Волну дикой магии."}]}],"uses":{"count":1,"per":"long_rest"}}`,
		"Bounded use is enforced; before-roll selection and spell-cast refresh/wild-surge coupling need an event-bus boon.",
	},
	{
		"ACT-monk-stunning-strike", "free_action",
		"Раз за ход после попадания оружием ближнего боя или Безоружным ударом потратьте 1 Фокус. Цель совершает спасбросок Телосложения.",
		`{"activation":{"mode":"triggered","cost":[{"resource":"focus"},{"resource":"self_uses"}],"trigger":{"event":"hit","timing":"after"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"save","who":"target","ability":"con","dc":"8 + prof + wis","on_fail":[{"kind":"grant_effect","value":"COND-stunned","duration":{"type":"rounds","amount":1}}],"on_success":[{"kind":"grant_effect","value":"EFFECT-monk-stunning-strike-slow","duration":{"type":"rounds","amount":1}},{"kind":"grant_effect","value":"EFFECT-monk-stunning-strike-opening","duration":{"type":"rounds","amount":1}}]}],"uses":{"count":1,"per":"turn"}}`,
		"Explicit per-turn self_uses cost makes the after-hit offer bounded and keeps the canonical focus pool.",
	},
}

func repairLevelFiveSubclassActions(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock level-five action repairs: %w", err)
	}

	for _, repair := range levelFiveSubclassActionRepairs {
		result, execErr := tx.Exec(`UPDATE actions SET
			resource=$2,description=$3,mechanics=$4::jsonb,
			support=jsonb_build_object(
				'status','untested','certification_version',$5::text,
				'mechanics_locked',false,'note',$6::text),
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`,
			repair.card, repair.resource, repair.description, repair.mechanics,
			levelFiveSubclassActionsRepairVersion, repair.note)
		if execErr != nil {
			return fmt.Errorf("repair %s: %w", repair.card, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair %s affected %d rows: %w", repair.card, rows, rowsErr)
		}

		if strings.HasPrefix(repair.card, "ACT-subclass-") {
			sourceCard := strings.TrimPrefix(repair.card, "ACT-subclass-")
			result, execErr = tx.Exec(`UPDATE effects SET
				mechanics=jsonb_build_object(
					'activation',jsonb_build_object('mode','passive'),
					'effects',jsonb_build_array(jsonb_build_object(
						'resolution','auto','result',jsonb_build_array(
							jsonb_build_object('kind','grant_action','value',$2::text))))),
				support=jsonb_build_object(
					'status','untested','certification_version',$3::text,
					'mechanics_locked',false,
					'note','Capability source only; executable mechanics live on the granted action and require browser verification.'),
				updated_at=NOW()
				WHERE card_number=$1 AND deleted_at IS NULL`,
				sourceCard, repair.card, levelFiveSubclassActionsRepairVersion)
			if execErr != nil {
				return fmt.Errorf("normalize source %s: %w", sourceCard, execErr)
			}
			if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
				return fmt.Errorf("normalize source %s affected %d rows: %w", sourceCard, rows, rowsErr)
			}
		}
	}

	cards := make([]string, 0, len(levelFiveSubclassActionRepairs))
	for _, repair := range levelFiveSubclassActionRepairs {
		cards = append(cards, repair.card)
	}
	var total, activeOrTriggered, invalidSpend, legacyFocus int
	if err = tx.QueryRow(`SELECT count(*),
		count(*) FILTER (WHERE mechanics#>>'{activation,mode}' IN ('active','triggered')),
		count(*) FILTER (WHERE mechanics::text LIKE '%"kind": "resource"%' AND mechanics::text LIKE '%"op": "spend"%'),
		count(*) FILTER (WHERE mechanics::text LIKE '%focus_points%')
		FROM actions WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`, cards).
		Scan(&total, &activeOrTriggered, &invalidSpend, &legacyFocus); err != nil {
		return fmt.Errorf("audit repaired actions: %w", err)
	}
	if total != len(cards) || activeOrTriggered != len(cards) || invalidSpend != 0 || legacyFocus != 0 {
		return fmt.Errorf("bad action postimage total=%d executable=%d result_spend=%d legacy_focus=%d want=%d/0/0",
			total, activeOrTriggered, invalidSpend, legacyFocus, len(cards))
	}

	var limitedReady, healingSafe, psychicSafe, natureSafe int
	if err = tx.QueryRow(`SELECT
		count(*) FILTER (WHERE card_number IN ('ACT-subclass-EFFECT-0037','ACT-subclass-EFFECT-0125','ACT-subclass-EFFECT-0142','ACT-subclass-EFFECT-0244','ACT-monk-stunning-strike')
			AND mechanics#>'{activation,cost}' @> '[{"resource":"self_uses"}]'::jsonb),
		count(*) FILTER (WHERE card_number='ACT-subclass-EFFECT-0142'
			AND mechanics#>>'{effects,0,result,0,kind}'='healing'
			AND mechanics#>>'{uses,count}'='1 + class_level:warlock'),
		count(*) FILTER (WHERE card_number='ACT-subclass-EFFECT-0192'
			AND mechanics#>'{activation,cost}' @> '[{"resource":"action"}]'::jsonb),
		count(*) FILTER (WHERE card_number='ACT-subclass-EFFECT-0170'
			AND mechanics#>>'{targeting,area,radius_ft}'='15'
			AND mechanics#>>'{effects,0,on_fail,0,kind}'='grant_effect'
			AND mechanics#>>'{effects,0,on_fail,0,value}'='COND-restrained'
			AND mechanics#>>'{effects,0,on_fail,0,save_ends,timing}'='end_of_turn')
		FROM actions WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`, cards).
		Scan(&limitedReady, &healingSafe, &psychicSafe, &natureSafe); err != nil {
		return fmt.Errorf("audit high-risk action postconditions: %w", err)
	}
	if limitedReady != 5 || healingSafe != 1 || psychicSafe != 1 || natureSafe != 1 {
		return fmt.Errorf("high-risk action postconditions limited=%d healing=%d psychic=%d nature=%d", limitedReady, healingSafe, psychicSafe, natureSafe)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
