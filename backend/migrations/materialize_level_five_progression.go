package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// This migration deliberately leaves every newly introduced contract untested.
// Browser certification is a later, evidence-producing migration; expanding the
// progression must never inherit the level-two certificate by accident.
const levelFiveProgressionMigrationVersion = "167_materialize_level_five_progression"

var levelFiveBaseClassCards = []string{
	"CLASS-barbarian", "CLASS-bard", "CLASS-cleric", "CLASS-druid",
	"CLASS-warrior", "CLASS-monk", "CLASS-paladin", "CLASS-ranger",
	"CLASS-rogue", "CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard",
}

var levelFiveSubclassCards = []string{
	"barbarian_berserker", "barbarian_wild_heart", "barbarian_world_tree", "barbarian_zealot",
	"bard_dance", "bard_glamour", "bard_lore", "bard_valor",
	"cleric_life_domain", "cleric_light_domain", "cleric_trickery_domain", "cleric_war_domain",
	"druid_circle_of_land", "druid_circle_of_moon", "druid_circle_of_sea", "druid_circle_of_stars",
	"fighter_battle_master", "fighter_champion", "fighter_eldritch_knight", "fighter_psi_warrior",
	"monk_elements", "monk_mercy", "monk_open_hand", "monk_shadow",
	"paladin_oath_ancients", "paladin_oath_devotion", "paladin_oath_glory", "paladin_oath_vengeance",
	"ranger_beast_master", "ranger_fey_wanderer", "ranger_gloom_stalker", "ranger_hunter",
	"rogue_arcane_trickster", "rogue_assassin", "rogue_soulknife", "rogue_thief",
	"sorcerer_aberrant", "sorcerer_clockwork", "sorcerer_draconic", "sorcerer_wild_magic",
	"warlock_archfey", "warlock_celestial", "warlock_fiend", "warlock_great_old_one",
	"wizard_abjurer", "wizard_diviner", "wizard_evoker", "wizard_illusionist",
}

type levelFiveActionSeed struct {
	id, card, name, nameEn, description, resource, mechanics string
}

var levelFiveActions = []levelFiveActionSeed{
	{
		"16700000-0000-4000-8000-000000000001", "ACT-fighter-tactical-shift",
		"Тактический сдвиг", "Tactical Shift",
		"Сразу после Второго дыха переместитесь на половину Скорости, не провоцируя Атак.",
		"free_action",
		`{"activation":{"mode":"active","cost":[]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"movement","distance":"floor(speed/2)"},{"kind":"modifier","op":"deny","applies_to":{"interaction":"opportunity_attack","trigger":"self_movement"},"duration":{"type":"until_end_of_turn"}}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000002", "ACT-druid-wild-resurgence-shape",
		"Дикое возрождение: облик", "Wild Resurgence: Wild Shape",
		"Когда нет использований Дикого облика, потратьте ячейку заклинаний и восстановите одно использование.",
		"free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"spell_slot","level":1,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"wild_shape","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000003", "ACT-druid-wild-resurgence-slot",
		"Дикое возрождение: ячейка", "Wild Resurgence: Spell Slot",
		"Потратьте Дикий облик и восстановите ячейку 1-го круга; один раз за Долгий отдых.",
		"free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"wild_shape"},{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"spell_slot_1","amount":1}]}],"uses":{"count":1,"per":"long_rest"}}`,
	},
	{
		"16700000-0000-4000-8000-000000000004", "ACT-monk-stunning-strike",
		"Оглушающий удар", "Stunning Strike",
		"Раз за ход после попадания оружием ближнего боя или Безоружным ударом потратьте 1 Фокус. Цель делает спасбросок Телосложения.",
		"free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"focus"}],"trigger":{"event":"hit","timing":"after"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"save","ability":"con","dc":"8 + prof + wis","on_fail":[{"kind":"grant_effect","value":"COND-stunned","duration":{"type":"rounds","amount":1}}],"on_success":[{"kind":"grant_effect","value":"EFFECT-monk-stunning-strike-slow","duration":{"type":"rounds","amount":1}},{"kind":"grant_effect","value":"EFFECT-monk-stunning-strike-opening","duration":{"type":"rounds","amount":1}}]}],"uses":{"count":1,"per":"turn"}}`,
	},
	{
		"16700000-0000-4000-8000-000000000005", "ACT-rogue-cunning-strike-poison",
		"Хитрый удар: яд", "Cunning Strike: Poison",
		"После попадания Скрытой атакой откажитесь от 1к6 её урона. Цель делает спасбросок Телосложения, при провале Отравлена на 1 минуту с повторным спасброском в конце хода.",
		"free_action",
		`{"activation":{"mode":"active","cost":[],"trigger":{"event":"sneak_attack_hit","timing":"after"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":120,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},"effects":[{"resolution":"save","ability":"con","dc":"8 + prof + dex","on_fail":[{"kind":"grant_effect","value":"COND-poisoned","duration":{"type":"minutes","amount":1}}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000006", "ACT-rogue-cunning-strike-trip",
		"Хитрый удар: подсечка", "Cunning Strike: Trip",
		"После попадания Скрытой атакой откажитесь от 1к6 её урона. Цель Большого или меньшего размера падает Ничком при провале спасброска Ловкости.",
		"free_action",
		`{"activation":{"mode":"active","cost":[],"trigger":{"event":"sneak_attack_hit","timing":"after"}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":120,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"],"filter":"max_size:large"},"effects":[{"resolution":"save","ability":"dex","dc":"8 + prof + dex","on_fail":[{"kind":"grant_effect","value":"COND-prone","duration":{"type":"manual"}}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000007", "ACT-rogue-cunning-strike-withdraw",
		"Хитрый удар: отступление", "Cunning Strike: Withdraw",
		"После попадания Скрытой атакой откажитесь от 1к6 её урона и переместитесь на половину Скорости без Провоцированных атак.",
		"free_action",
		`{"activation":{"mode":"active","cost":[],"trigger":{"event":"sneak_attack_hit","timing":"after"}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"movement","distance":"floor(speed/2)"},{"kind":"modifier","op":"deny","applies_to":{"interaction":"opportunity_attack","trigger":"self_movement"},"duration":{"type":"until_end_of_turn"}}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000008", "ACT-rogue-uncanny-dodge",
		"Невероятное уклонение", "Uncanny Dodge",
		"Когда видимое вами существо попадает по вам атакой, Реакцией уменьшите урон вдвое.",
		"reaction",
		`{"activation":{"mode":"reaction","cost":[{"resource":"reaction"}],"trigger":{"event":"damage_taken","timing":"after"}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"floor(incoming_damage/2)","filter":{"source":"visible_attacker","delivery":"attack"}}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000009", "ACT-wizard-memorize-spell",
		"Запомнить заклинание", "Memorize Spell",
		"После Короткого отдыха замените одно подготовленное заклинание Волшебника на другое из книги заклинаний, для которого есть ячейка.",
		"free_action",
		`{"requirements":[{"type":"state","value":"short_rest_completed"}],"activation":{"mode":"active","cost":[]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"kind":"choice","id":"wizard_memorize_spell","prompt":"Выберите подготовленное заклинание для замены и заклинание из книги","count":1,"resolution":"immediate","options":{"source":"spellbook","filter":{"max_level":"max_available_spell_slot"}},"grant":{"kind":"grant_spell","label":"prepared","replace":true}}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000010", "ACT-dragonborn-draconic-flight",
		"Драконьий полёт", "Draconic Flight",
		"Бонусным действием создайте спектральные крылья на 10 минут; один раз за Долгий отдых.",
		"bonus_action",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFFECT-dragonborn-draconic-flight"}]}],"uses":{"count":1,"per":"long_rest"}}`,
	},
	{
		"16700000-0000-4000-8000-000000000011", "ACT-goliath-large-form",
		"Крупная форма", "Large Form",
		"Бонусным действием станьте Большого размера на 10 минут, если есть место. Скорость +10 футов; один раз за Долгий отдых.",
		"bonus_action",
		`{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFFECT-goliath-large-form"}]}],"uses":{"count":1,"per":"long_rest"}}`,
	},
	{
		"16700000-0000-4000-8000-000000000012", "ACT-cleric-turn-undead-sear",
		"Изгнание нежити: Поражение нежити", "Turn Undead: Sear Undead",
		"Нежить в пределах 30 футов делает спасбросок Мудрости; при провале получает урон Излучением и становится Испуганной и Недееспособной на 1 минуту.",
		"action",
		`{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"channel_divinity"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":20,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["enemy","neutral"],"area":{"kind":"sphere","radius_ft":30},"filter":"creature_type:undead"},"effects":[{"resolution":"save","ability":"wis","dc":"spell_save_dc","on_fail":[{"kind":"damage","amount":"max(1,wis) * d8","type":"radiant"},{"kind":"grant_effect","value":"COND-frightened","duration":{"type":"minutes","amount":1}},{"kind":"grant_effect","value":"COND-incapacitated","duration":{"type":"minutes","amount":1}}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000013", "ACT-sorcerous-restoration",
		"Чародейское восстановление", "Sorcerous Restoration",
		"После Короткого отдыха восстановите половину уровня Чародея (округляя вниз) очков чародейства.",
		"free_action",
		`{"requirements":[{"type":"state","value":"short_rest_completed"}],"activation":{"mode":"active","cost":[]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"sorcery_points","amount":"floor(class_level:sorcerer/2)"}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000014", "ACT-bard-font-slot-1",
		"Источник вдохновения: ячейка 1", "Font of Inspiration: Level 1 Slot",
		"Без действия потратьте ячейку 1-го круга, чтобы восстановить одно Бардовское вдохновение.", "free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"spell_slot","level":1,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"bardic_inspiration","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000015", "ACT-bard-font-slot-2",
		"Источник вдохновения: ячейка 2", "Font of Inspiration: Level 2 Slot",
		"Без действия потратьте ячейку 2-го круга, чтобы восстановить одно Бардовское вдохновение.", "free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"spell_slot","level":2,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"bardic_inspiration","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000016", "ACT-bard-font-slot-3",
		"Источник вдохновения: ячейка 3", "Font of Inspiration: Level 3 Slot",
		"Без действия потратьте ячейку 3-го круга, чтобы восстановить одно Бардовское вдохновение.", "free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"spell_slot","level":3,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"bardic_inspiration","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000017", "ACT-druid-wild-resurgence-shape-2",
		"Дикое возрождение: облик за ячейку 2", "Wild Resurgence: Level 2 Slot", "Потратьте ячейку 2-го круга и восстановите Дикий облик.", "free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"spell_slot","level":2,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"wild_shape","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000018", "ACT-druid-wild-resurgence-shape-3",
		"Дикое возрождение: облик за ячейку 3", "Wild Resurgence: Level 3 Slot", "Потратьте ячейку 3-го круга и восстановите Дикий облик.", "free_action",
		`{"activation":{"mode":"active","cost":[{"resource":"spell_slot","level":3,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"wild_shape","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000019", "ACT-font-create-slot-2", "Создать ячейку 2 круга", "Create Level 2 Spell Slot", "Потратьте 3 очка чародейства и восстановите ячейку 2-го круга.", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"sorcery_points","amount":3}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"spell_slot_2","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000020", "ACT-font-create-slot-3", "Создать ячейку 3 круга", "Create Level 3 Spell Slot", "Потратьте 5 очков чародейства и восстановите ячейку 3-го круга.", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"sorcery_points","amount":5}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"spell_slot_3","amount":1}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000021", "ACT-font-convert-slot-2", "Преобразовать ячейку 2 круга", "Convert Level 2 Spell Slot", "Потратьте ячейку 2-го круга и восстановите 2 очка чародейства.", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"spell_slot","level":2,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"sorcery_points","amount":2}]}]}`,
	},
	{
		"16700000-0000-4000-8000-000000000022", "ACT-font-convert-slot-3", "Преобразовать ячейку 3 круга", "Convert Level 3 Spell Slot", "Потратьте ячейку 3-го круга и восстановите 3 очка чародейства.", "bonus_action", `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"spell_slot","level":3,"amount":1}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"sorcery_points","amount":3}]}]}`,
	},
}

type levelFiveEffectSeed struct {
	id, card, name, nameEn, description, effectType, mechanics string
}

var levelFiveEffects = []levelFiveEffectSeed{
	{"16700000-0000-4000-8000-000000000101", "EFF-extra-attack", "Дополнительная атака", "Extra Attack", "Действием Атака можно совершить две атаки вместо одной.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"variable","id":"attacks_per_attack_action","op":"set","value":2}]}]}`},
	{"16700000-0000-4000-8000-000000000102", "EFF-barbarian-fast-movement", "Быстрое перемещение", "Fast Movement", "Скорость +10 футов, пока вы не носите Тяжёлый доспех.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":10,"applies_to":{"roll":"speed"},"when":[{"kind":"not","of":{"kind":"wearing_armor","category":"heavy"}}]}]}]}`},
	{"16700000-0000-4000-8000-000000000103", "EFF-bard-font-of-inspiration", "Источник вдохновения", "Font of Inspiration", "Восстанавливайте все использования Бардовского вдохновения после Короткого или Долгого отдыха; ячейку любого круга можно обменять на одно использование.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"triggered_effect","event":"short_rest","effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"bardic_inspiration","amount":"max(1,cha)"}]}],"duration":{"type":"manual"}},{"kind":"grant_action","values":["ACT-bard-font-slot-1","ACT-bard-font-slot-2","ACT-bard-font-slot-3"]}]}]}`},
	{"16700000-0000-4000-8000-000000000104", "EFF-cleric-sear-undead", "Поражение нежити", "Sear Undead", "Изгнание нежити также наносит провалившей цели к8 урона Излучением за каждую единицу модификатора Мудрости (минимум 1к8).", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-cleric-turn-undead-sear"}]}]}`},
	{"16700000-0000-4000-8000-000000000105", "EFF-druid-wild-resurgence", "Дикое возрождение", "Wild Resurgence", "Обменивайте ячейку на Дикий облик, а раз за Долгий отдых — Дикий облик на ячейку 1-го круга.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","values":["ACT-druid-wild-resurgence-shape","ACT-druid-wild-resurgence-shape-2","ACT-druid-wild-resurgence-shape-3","ACT-druid-wild-resurgence-slot"]}]}]}`},
	{"16700000-0000-4000-8000-000000000106", "EFF-fighter-tactical-shift", "Тактический сдвиг", "Tactical Shift", "Открывает перемещение после Второго дыха.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-fighter-tactical-shift"}]}]}`},
	{"16700000-0000-4000-8000-000000000107", "EFF-monk-stunning-strike", "Оглушающий удар", "Stunning Strike", "Открывает послеударное использование Оглушающего удара.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-monk-stunning-strike"}]}]}`},
	{"16700000-0000-4000-8000-000000000108", "EFFECT-monk-stunning-strike-slow", "Оглушающий удар: замедление", "Stunning Strike: Slowed", "После успешного спасброска Скорость уменьшена вдвое до начала следующего хода Монаха.", "negative_effect", `{"kind":"modifier","op":"multiply","value":0.5,"applies_to":{"roll":"speed"},"duration":{"type":"rounds","amount":1},"stack_id":"monk:stunning-strike:slow","stack_type":"overwrite"}`},
	{"16700000-0000-4000-8000-000000000119", "EFFECT-monk-stunning-strike-opening", "Оглушающий удар: открытая цель", "Stunning Strike: Opening", "Следующая атака по цели до начала следующего хода Монаха имеет Преимущество.", "negative_effect", `{"kind":"modifier","op":"advantage","scope":"target","consume":"next","applies_to":{"roll":"attack"},"duration":{"type":"rounds","amount":1},"stack_id":"monk:stunning-strike:opening","stack_type":"overwrite"}`},
	{"16700000-0000-4000-8000-000000000109", "EFF-paladin-faithful-steed", "Верный скакун", "Faithful Steed", "Обретение скакуна всегда подготовлено и один раз за Долгий отдых сотворяется без ячейки.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_spell","value":"SPELL-0240","label":"always_prepared","freeuse":{"count":1,"recharge":"long_rest"}}]}]}`},
	{"16700000-0000-4000-8000-000000000110", "EFF-rogue-cunning-strike", "Хитрый удар", "Cunning Strike", "Откажитесь от 1к6 урона Скрытой атаки для Яда, Подсечки или Отступления.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","values":["ACT-rogue-cunning-strike-poison","ACT-rogue-cunning-strike-trip","ACT-rogue-cunning-strike-withdraw"]}]}]}`},
	{"16700000-0000-4000-8000-000000000111", "EFF-rogue-uncanny-dodge", "Невероятное уклонение", "Uncanny Dodge", "Открывает Реакцию для уменьшения урона от видимой атаки вдвое.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-rogue-uncanny-dodge"}]}]}`},
	{"16700000-0000-4000-8000-000000000112", "EFF-sorcerous-restoration", "Чародейское восстановление", "Sorcerous Restoration", "Восстанавливайте половину уровня Чародея очков после Короткого отдыха.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-sorcerous-restoration"}]}]}`},
	{"16700000-0000-4000-8000-000000000113", "EFF-wizard-memorize-spell", "Запомнить заклинание", "Memorize Spell", "Открывает замену одного подготовленного заклинания после Короткого отдыха.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-wizard-memorize-spell"}]}]}`},
	{"16700000-0000-4000-8000-000000000115", "EFFECT-dragonborn-draconic-flight", "Драконьий полёт: крылья", "Draconic Flight: Wings", "Вы имеете Скорость полёта, равную наземной Скорости, на 10 минут.", "positive_effect", `{"kind":"grant_speed","mode":"fly","value":"speed","duration":{"type":"minutes","amount":10},"stack_id":"dragonborn:draconic-flight","stack_type":"overwrite"}`},
	{"16700000-0000-4000-8000-000000000116", "EFF-goliath-large-form", "Крупная форма", "Large Form", "Открывает Бонусное действие увеличения до Большого размера.", "species_ability", `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-goliath-large-form"}]}]}`},
	{"16700000-0000-4000-8000-000000000117", "EFFECT-goliath-large-form", "Крупная форма: увеличение", "Large Form: Enlarged", "Вы Большого размера, а Скорость увеличена на 10 футов на 10 минут.", "positive_effect", `{"kind":"modifier","op":"add","value":10,"applies_to":{"roll":"speed"},"duration":{"type":"minutes","amount":10},"stack_id":"goliath:large-form","stack_type":"overwrite","companions":[{"kind":"narrative","description":"Размер существа становится Большим, если есть место."}]}`},
	{"16700000-0000-4000-8000-000000000118", "EFF-land-spells-level5", "Заклинания Круга земли: 5-й уровень", "Circle of the Land Spells: Level 5", "Выбор земли даёт Огненный шар, Метель, Молнию или Зловонное облако.", "class_ability", `{"activation":{"mode":"passive"},"effects":[{"kind":"choice","id":"circle_land_level5_terrain","prompt":"Круг земли: выберите тип земли","count":1,"resolution":"on_acquire","options":{"source":"explicit","items":[{"id":"arid","name":"Засушливая","grants":[{"kind":"grant_spell","value":"fireball","label":"always_prepared"}]},{"id":"polar","name":"Полярная","grants":[{"kind":"grant_spell","value":"sleet_storm","label":"always_prepared"}]},{"id":"temperate","name":"Умеренная","grants":[{"kind":"grant_spell","value":"lightning_bolt","label":"always_prepared"}]},{"id":"tropical","name":"Тропическая","grants":[{"kind":"grant_spell","value":"stinking_cloud","label":"always_prepared"}]}]}}]}`},
}

type levelFiveProgressionBinding struct {
	ownerCard string
	level     int
	effects   []string
}

var levelFiveProgressionBindings = []levelFiveProgressionBinding{
	{"CLASS-barbarian", 5, []string{"EFF-extra-attack", "EFF-barbarian-fast-movement"}},
	{"CLASS-bard", 5, []string{"EFF-bard-font-of-inspiration"}},
	{"CLASS-cleric", 5, []string{"EFF-cleric-sear-undead"}},
	{"CLASS-druid", 5, []string{"EFF-druid-wild-resurgence"}},
	{"CLASS-warrior", 5, []string{"EFF-extra-attack", "EFF-fighter-tactical-shift"}},
	{"CLASS-monk", 5, []string{"EFF-extra-attack", "EFF-monk-stunning-strike"}},
	{"CLASS-paladin", 5, []string{"EFF-extra-attack", "EFF-paladin-faithful-steed"}},
	{"CLASS-ranger", 5, []string{"EFF-extra-attack"}},
	{"CLASS-rogue", 5, []string{"EFF-rogue-cunning-strike", "EFF-rogue-uncanny-dodge"}},
	{"CLASS-sorcerer", 5, []string{"EFF-sorcerous-restoration"}},
	{"CLASS-wizard", 5, []string{"EFF-wizard-memorize-spell"}},
	{"RACE-0011", 5, []string{"EFF-goliath-large-form"}},
	{"druid_circle_of_land", 5, []string{"EFF-land-spells-level5"}},
}

type levelFiveSpellGrant struct {
	effectCard string
	spells     []string
}

// Existing subclass spell cards contain the complete printed table but only
// grant the level-three entries. These are the level-five rows from those same
// tables; level_gate prevents them leaking into level-three characters.
var levelFiveSubclassSpellGrants = []levelFiveSpellGrant{
	{"EFFECT-0110", []string{"revivify", "mass_healing_word"}},
	{"EFFECT-0119", []string{"daylight", "fireball"}},
	{"EFFECT-0116", []string{"hypnotic_pattern", "nondetection"}},
	{"EFFECT-0105", []string{"spirit_guardians", "crusaders_mantle"}},
	{"EFFECT-0095", []string{"conjure_animals"}},
	{"EFFECT-0099", []string{"lightning_bolt", "water_breathing"}},
	{"EFFECT-0171", []string{"SPELL-0215", "misty_step"}},
	{"EFFECT-0175", []string{"SPELL-0235", "SPELL-0261"}},
	{"EFFECT-0181", []string{"SPELL-0219", "SPELL-0309"}},
	{"EFFECT-0165", []string{"hold_person", "misty_step"}},
	{"EFFECT-0216", []string{"misty_step"}},
	{"EFFECT-0222", []string{"SPELL-0302"}},
	{"EFFECT-0227", []string{"hunger_of_hadar", "sending"}},
	{"EFFECT-0238", []string{"protection_from_energy", "dispel_magic"}},
	{"EFFECT-0234", []string{"fly", "fear"}},
	{"EFFECT-0124", []string{"blink", "plant_growth"}},
	{"EFFECT-0141", []string{"revivify", "daylight"}},
	{"EFFECT-0137", []string{"stinking_cloud", "fireball"}},
	{"EFFECT-0130", []string{"hunger_of_hadar", "clairvoyance"}},
}

type levelFiveSpeciesSpellGrant struct {
	ownerCard, effectCard, levelThreeSpell, levelFiveSpell string
}

var levelFiveSpeciesSpellGrants = []levelFiveSpeciesSpellGrant{
	{"sub-drow", "RE-sub-drow", "faerie_fire", "darkness"},
	{"sub-high_elf", "RE-sub-high_elf", "detect_magic", "misty_step"},
	{"sub-wood_elf", "RE-sub-wood_elf", "longstrider", "pass_without_trace"},
	{"sub-abyssal", "RE-sub-abyssal", "ray_of_sickness", "hold_person"},
	{"sub-chthonic", "RE-sub-chthonic", "false_life", "ray_of_enfeeblement"},
	{"sub-infernal", "RE-sub-infernal", "hellish_rebuke", "darkness"},
}

var levelFiveElfLineageEffectCards = []string{
	"RE-sub-drow", "RE-sub-high_elf", "RE-sub-wood_elf",
}

type levelFiveActiveSubclassTarget struct {
	effectCard string
	targeting  string
}

func addNatureWrathDuration(value any) {
	switch typed := value.(type) {
	case []any:
		for _, nested := range typed {
			addNatureWrathDuration(nested)
		}
	case map[string]any:
		if typed["kind"] == "grant_effect" && typed["value"] == "COND-restrained" && typed["duration"] == nil {
			typed["duration"] = map[string]any{"type": "rounds", "amount": 10}
		}
		for _, nested := range typed {
			addNatureWrathDuration(nested)
		}
	}
}

func strictenProjectedSubclassConditions(tx *sql.Tx, table, cardNumber string) error {
	if table != "actions" && table != "effects" {
		return fmt.Errorf("unsupported projected subclass table %q", table)
	}
	var raw []byte
	if err := tx.QueryRow(`SELECT mechanics FROM `+table+` WHERE card_number=$1 AND deleted_at IS NULL`, cardNumber).Scan(&raw); err != nil {
		return fmt.Errorf("load %s %s condition references: %w", table, cardNumber, err)
	}
	var mechanics map[string]any
	if err := json.Unmarshal(raw, &mechanics); err != nil {
		return fmt.Errorf("decode %s %s condition references: %w", table, cardNumber, err)
	}
	rewritten, changed, err := rewriteLevelFiveConditionReferences(mechanics)
	if err != nil {
		return fmt.Errorf("stricten %s %s condition references: %w", table, cardNumber, err)
	}
	mechanics = rewritten.(map[string]any)
	if cardNumber == "EFFECT-0170" || cardNumber == "ACT-subclass-EFFECT-0170" {
		addNatureWrathDuration(mechanics)
		changed++
	}
	if changed == 0 {
		return nil
	}
	encoded, err := json.Marshal(mechanics)
	if err != nil {
		return fmt.Errorf("encode %s %s condition references: %w", table, cardNumber, err)
	}
	if _, err = tx.Exec(`UPDATE `+table+` SET mechanics=$2::jsonb,
		support=jsonb_build_object('status','untested','certification_version',$3::text,
		'mechanics_locked',false,'note','Projected condition references resolve through effect-library cards; browser verification pending.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`, cardNumber, string(encoded), levelFiveProgressionMigrationVersion); err != nil {
		return fmt.Errorf("store %s %s condition references: %w", table, cardNumber, err)
	}
	return nil
}

// Only explicit active abilities are projected. Triggered features remain on
// their source effects until the event engine can enforce their exact timing.
var levelFiveActiveSubclassTargets = []levelFiveActiveSubclassTarget{
	{"EFFECT-0244", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0228", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["ally","enemy","neutral"]}`},
	{"EFFECT-0192", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]}`},
	{"EFFECT-0186", `{"domain":"world","actor_targets":false,"shape":"point","range_ft":5}`},
	{"EFFECT-0182", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0176", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0170", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":10,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]}`},
	{"EFFECT-0166", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]}`},
	{"EFFECT-0147", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["self","ally","neutral"]}`},
	{"EFFECT-0142", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["self","ally","neutral"]}`},
	{"EFFECT-0129", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["ally","enemy","neutral"]}`},
	{"EFFECT-0125", `{"domain":"world","actor_targets":false,"shape":"point","range_ft":30}`},
	{"EFFECT-0120", `{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":20,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["enemy","neutral"],"area":{"kind":"sphere","radius_ft":30}}`},
	{"EFFECT-0115", `{"domain":"world","actor_targets":false,"shape":"point","range_ft":30}`},
	{"EFFECT-0114", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["ally"]}`},
	{"EFFECT-0111", `{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":20,"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["self","ally"]}`},
	{"EFFECT-0106", `{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":120,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]}`},
	{"EFFECT-0100", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0090", `{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":20,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self","ally"],"area":{"kind":"sphere","radius_ft":30}}`},
	{"EFFECT-0085", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0048", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0037", `{"domain":"actor","actor_targets":false,"shape":"self","allowed_relations":["self"]}`},
	{"EFFECT-0016", `{"domain":"actor","actor_targets":true,"shape":"area","min_targets":1,"max_targets":6,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["ally"]}`},
}

func materializeLevelFiveProgression(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("disable certified guards: %w", err)
	}

	for _, action := range levelFiveActions {
		if _, err = tx.Exec(`INSERT INTO actions
			(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES ($1::uuid,$2,$3,$4,'','common',$5,'class_feature','class_feature',$6,$7::jsonb,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$8::text,'mechanics_locked',false,'note','Level-3–5 browser verification pending'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,
			support=EXCLUDED.support,updated_at=NOW()`, action.id, action.name, action.nameEn,
			action.description, action.card, action.resource, action.mechanics, levelFiveProgressionMigrationVersion); err != nil {
			return fmt.Errorf("upsert action %s: %w", action.card, err)
		}
	}

	for _, effect := range levelFiveEffects {
		if _, err = tx.Exec(`INSERT INTO effects
			(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
			VALUES ($1::uuid,$2,$3,$4,'','','common',$5,$6,$7::jsonb,false,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$8::text,'mechanics_locked',false,'note','Level-3–5 browser verification pending'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
			support=EXCLUDED.support,updated_at=NOW()`, effect.id, effect.name, effect.nameEn,
			effect.description, effect.card, effect.effectType, effect.mechanics, levelFiveProgressionMigrationVersion); err != nil {
			return fmt.Errorf("upsert effect %s: %w", effect.card, err)
		}
	}

	for _, grant := range levelFiveSpeciesSpellGrants {
		result, execErr := tx.Exec(`UPDATE effects SET support=jsonb_build_object(
			'status','untested','certification_version',$4::text,'mechanics_locked',false,
			'note','Existing level-gated species spells preserved; level-5 browser verification pending'),updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL
			AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(mechanics#>'{effects,0,result}','[]'::jsonb)) item
				WHERE item->>'kind'='grant_spell' AND item->>'value'=$2 AND (item->>'level_gate')::int=3)
			AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(mechanics#>'{effects,0,result}','[]'::jsonb)) item
				WHERE item->>'kind'='grant_spell' AND item->>'value'=$3 AND (item->>'level_gate')::int=5)`,
			grant.effectCard, grant.levelThreeSpell, grant.levelFiveSpell, levelFiveProgressionMigrationVersion)
		if execErr != nil {
			return fmt.Errorf("verify species spell gates %s: %w", grant.effectCard, execErr)
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return fmt.Errorf("verify species spell gates %s: expected existing level-3/5 grants, updated %d", grant.effectCard, rows)
		}
	}

	// Elf lineage spells use the ability selected by the lineage's own choice.
	// A payload-local ability would override that source-scoped choice, so remove
	// the three legacy hard-coded CHA/INT/WIS values while preserving every gate.
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',(
		SELECT jsonb_agg(CASE WHEN item->>'kind'='grant_spell' THEN item-'ability' ELSE item END ORDER BY ordinal)
		FROM jsonb_array_elements(COALESCE(mechanics#>'{effects,0,result}','[]'::jsonb)) WITH ORDINALITY AS entries(item,ordinal)
	),true),support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Elf lineage spellcasting ability now comes from the lineage choice; level-5 browser verification pending'),updated_at=NOW()
	WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL`, levelFiveProgressionMigrationVersion, levelFiveElfLineageEffectCards); err != nil {
		return fmt.Errorf("defer Elf lineage spell ability to source choice: %w", err)
	}

	for _, binding := range levelFiveProgressionBindings {
		for _, effectCard := range binding.effects {
			if binding.ownerCard == "RACE-0011" {
				err = bindRaceProgressionEffect(tx, binding.ownerCard, binding.level, effectCard)
			} else {
				err = bindProgressionEffect(tx, binding.ownerCard, binding.level, effectCard)
			}
			if err != nil {
				return err
			}
		}
	}

	// Dragonborn already has RE-dragonborn-4 in its level-five progression. It
	// was stored as an active effect, which does not surface as an action; retain
	// the real owner and make it grant the executable action instead of adding a
	// duplicate race feature.
	result, execErr := tx.Exec(`UPDATE effects SET
		mechanics='{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-dragonborn-draconic-flight"}]}]}'::jsonb,
		support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Level-5 Draconic Flight action pending browser verification'),updated_at=NOW()
		WHERE card_number='RE-dragonborn-4' AND deleted_at IS NULL`, levelFiveProgressionMigrationVersion)
	if execErr != nil {
		return fmt.Errorf("materialize existing Dragonborn flight feature: %w", execErr)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("materialize existing Dragonborn flight feature: expected one RE-dragonborn-4 row, updated %d", rows)
	}

	// Every class already owns the shared PHB feat choice at level 4. Rebind it
	// defensively by card number so restored databases cannot silently omit ASI.
	for _, classCard := range levelFiveBaseClassCards {
		if err = bindProgressionEffect(tx, classCard, 4, "pf_1"); err != nil {
			return err
		}
	}

	for _, grant := range levelFiveSubclassSpellGrants {
		for _, spell := range grant.spells {
			result, execErr := tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',
				COALESCE(mechanics#>'{effects,0,result}','[]'::jsonb) ||
				CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(mechanics#>'{effects,0,result}','[]'::jsonb)) item
					WHERE item->>'kind'='grant_spell' AND item->>'value'=$2 AND COALESCE((item->>'level_gate')::int,1)=5)
				THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('kind','grant_spell','value',$2,'label','always_prepared','level_gate',5)) END,true),
				support=jsonb_build_object('status','untested','certification_version',$3::text,'mechanics_locked',false,'note','Level-5 subclass spell browser verification pending'),updated_at=NOW()
				WHERE card_number=$1 AND deleted_at IS NULL`, grant.effectCard, spell, levelFiveProgressionMigrationVersion)
			if execErr != nil {
				return fmt.Errorf("add level-five spell %s to %s: %w", spell, grant.effectCard, execErr)
			}
			if rows, _ := result.RowsAffected(); rows != 1 {
				return fmt.Errorf("add level-five spell %s to %s: expected one source effect, updated %d", spell, grant.effectCard, rows)
			}
		}
	}

	// Turn every manually activated subclass feature into a sheet/combat action.
	// The original effect remains the owner and grants the generated action.
	for _, projection := range levelFiveActiveSubclassTargets {
		actionCard := "ACT-subclass-" + projection.effectCard
		result, execErr := tx.Exec(`INSERT INTO actions
			(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			SELECT e.id,e.name,e.name_en,e.description,COALESCE(e.image_url,''),COALESCE(e.rarity,'common'),$2,
			'class_feature','class_feature',COALESCE(e.mechanics#>>'{activation,cost,0,resource}',e.mechanics#>>'{activation,cost,resource}','free_action'),
			jsonb_set(jsonb_set(e.mechanics,'{activation,cost}',CASE jsonb_typeof(e.mechanics#>'{activation,cost}')
				WHEN 'object' THEN jsonb_build_array(e.mechanics#>'{activation,cost}')
				WHEN 'array' THEN e.mechanics#>'{activation,cost}' ELSE '[]'::jsonb END,true),'{targeting}',$3::jsonb,true),
			'System','PHB 2024',jsonb_build_object('status','untested','certification_version',$4::text,'mechanics_locked',false,'note','Projected active subclass feature; browser timing verification pending')
			FROM effects e WHERE e.card_number=$1 AND e.deleted_at IS NULL
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,support=EXCLUDED.support,updated_at=NOW()`,
			projection.effectCard, actionCard, projection.targeting, levelFiveProgressionMigrationVersion)
		if execErr != nil {
			return fmt.Errorf("project active subclass feature %s: %w", projection.effectCard, execErr)
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return fmt.Errorf("project active subclass feature %s: expected one effect, inserted %d", projection.effectCard, rows)
		}
		if err = strictenProjectedSubclassConditions(tx, "actions", actionCard); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE effects SET
			mechanics=jsonb_set(jsonb_set(mechanics,'{activation}',jsonb_build_object('mode','passive'),true),'{effects}',
			COALESCE(mechanics->'effects','[]'::jsonb) ||
			CASE WHEN mechanics::text LIKE '%' || $2 || '%' THEN '[]'::jsonb
			ELSE jsonb_build_array(jsonb_build_object('resolution','auto','result',jsonb_build_array(jsonb_build_object('kind','grant_action','value',$2)))) END,true),
			support=jsonb_build_object('status','untested','certification_version',$3::text,'mechanics_locked',false,'note','Active feature projected to a granted action; browser verification pending'),updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, projection.effectCard, actionCard, levelFiveProgressionMigrationVersion); err != nil {
			return fmt.Errorf("grant projected subclass action %s: %w", actionCard, err)
		}
		if err = strictenProjectedSubclassConditions(tx, "effects", projection.effectCard); err != nil {
			return err
		}
	}

	// Class-owned resource curves needed by the new actions.
	for _, resource := range []struct {
		classCard, key, levels, per string
	}{
		{"CLASS-monk", "focus", `{"2":2,"3":3,"4":4,"5":5}`, "short_rest"},
		{"CLASS-sorcerer", "sorcery_points", `{"2":2,"3":3,"4":4,"5":5}`, "long_rest"},
	} {
		if _, err = tx.Exec(`UPDATE classes SET resources=jsonb_set(COALESCE(resources,'{}'::jsonb),ARRAY[$2]::text[],
			COALESCE(resources->$2,'{}'::jsonb) || jsonb_build_object('by_level',COALESCE(resources#>ARRAY[$2,'by_level']::text[],'{}'::jsonb)||$3::jsonb,'per',$4::text),true),updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, resource.classCard, resource.key, resource.levels, resource.per); err != nil {
			return fmt.Errorf("update %s resource %s: %w", resource.classCard, resource.key, err)
		}
	}

	// Font of Magic was level-two complete only for first-level slots. At level
	// five the same feature must expose second- and third-level conversions.
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result,0,values}',
		jsonb_build_array('ACT-font-create-slot-1','ACT-font-convert-slot-1','ACT-font-create-slot-2','ACT-font-create-slot-3','ACT-font-convert-slot-2','ACT-font-convert-slot-3'),true),
		support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Level-3–5 Font of Magic conversions pending browser verification'),updated_at=NOW()
		WHERE card_number='EFF-font-of-magic' AND deleted_at IS NULL`, levelFiveProgressionMigrationVersion); err != nil {
		return fmt.Errorf("extend Font of Magic through level five: %w", err)
	}

	// Expanding progression invalidates the previous level-two class certificate.
	if _, err = tx.Exec(`UPDATE classes SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Level-3–5 sheet, combat, and clarity verification pending'),updated_at=NOW()
		WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL`, levelFiveProgressionMigrationVersion, levelFiveBaseClassCards); err != nil {
		return fmt.Errorf("mark base progression untested: %w", err)
	}
	if _, err = tx.Exec(`UPDATE classes SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Level-3 subclass sheet, combat, and clarity verification pending'),updated_at=NOW()
		WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL`, levelFiveProgressionMigrationVersion, levelFiveSubclassCards); err != nil {
		return fmt.Errorf("mark subclass progression untested: %w", err)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified guards: %w", err)
	}
	return tx.Commit()
}

func bindProgressionEffect(tx *sql.Tx, ownerCard string, level int, effectCard string) error {
	levelKey := fmt.Sprintf("%d", level)
	result, err := tx.Exec(`UPDATE classes c SET level_progression=jsonb_set(COALESCE(c.level_progression,'{}'::jsonb),ARRAY[$3]::text[],
		COALESCE(c.level_progression->$3,'{}'::jsonb) || jsonb_build_object('effects',
			CASE WHEN COALESCE(c.level_progression#>ARRAY[$3,'effects']::text[],'[]'::jsonb) ? e.id::text
			THEN COALESCE(c.level_progression#>ARRAY[$3,'effects']::text[],'[]'::jsonb)
			ELSE COALESCE(c.level_progression#>ARRAY[$3,'effects']::text[],'[]'::jsonb)||jsonb_build_array(e.id::text) END),true),updated_at=NOW()
		FROM effects e WHERE c.card_number=$1 AND e.card_number=$2 AND c.deleted_at IS NULL AND e.deleted_at IS NULL`, ownerCard, effectCard, levelKey)
	if err != nil {
		return fmt.Errorf("bind %s to %s level %d: %w", effectCard, ownerCard, level, err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("bind %s to %s level %d: expected one owner/effect pair, updated %d", effectCard, ownerCard, level, rows)
	}
	return nil
}

func bindRaceProgressionEffect(tx *sql.Tx, ownerCard string, level int, effectCard string) error {
	levelKey := fmt.Sprintf("%d", level)
	result, err := tx.Exec(`UPDATE races r SET level_progression=jsonb_set(COALESCE(r.level_progression,'{}'::jsonb),ARRAY[$3]::text[],
		COALESCE(r.level_progression->$3,'{}'::jsonb) || jsonb_build_object('effects',
			CASE WHEN COALESCE(r.level_progression#>ARRAY[$3,'effects']::text[],'[]'::jsonb) ? e.id::text
			THEN COALESCE(r.level_progression#>ARRAY[$3,'effects']::text[],'[]'::jsonb)
			ELSE COALESCE(r.level_progression#>ARRAY[$3,'effects']::text[],'[]'::jsonb)||jsonb_build_array(e.id::text) END),true),updated_at=NOW()
		FROM effects e WHERE r.card_number=$1 AND e.card_number=$2 AND r.deleted_at IS NULL AND e.deleted_at IS NULL`, ownerCard, effectCard, levelKey)
	if err != nil {
		return fmt.Errorf("bind %s to race %s level %d: %w", effectCard, ownerCard, level, err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("bind %s to race %s level %d: expected one owner/effect pair, updated %d", effectCard, ownerCard, level, rows)
	}
	return nil
}
