package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const baseEquipment2024MigrationVersion = "146_materialize_base_equipment_2024"

type baseWeapon2024 struct {
	CardNumber, WeaponType, Category, Ability, Dice, DamageType, DefaultMode string
	MasteryID, AmmoCardNumber, AmmoName, Range, VersatileDice                string
	Modes                                                                    []map[string]any
	Properties                                                               []string
	Heavy                                                                    bool
}

var baseWeapons2024 = []baseWeapon2024{
	{"CARD-0568", "club", "simple", "str", "1d4", "bludgeoning", "melee", "c7d07a67-374c-49f6-b34b-40e85c26674e", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"light"}, false},
	{"CARD-0297", "dagger", "simple", "finesse", "1d4", "piercing", "melee", "c00b501c-2e9a-4f32-89e7-1c5ed898d7b2", "", "", "20/60", "", []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 20, "long_ft": 60}}, []string{"finesse", "light", "thrown"}, false},
	{"CARD-0300", "greatclub", "simple", "str", "1d8", "bludgeoning", "melee", "82ec5a23-18f9-4c68-9119-470c1ef120d9", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"two_handed"}, false},
	{"CARD-0295", "handaxe", "simple", "str", "1d6", "slashing", "melee", "2877d5fd-f912-4186-867d-53d353570ded", "", "", "20/60", "", []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 20, "long_ft": 60}}, []string{"light", "thrown"}, false},
	{"CARD-0301", "javelin", "simple", "str", "1d6", "piercing", "melee", "c7d07a67-374c-49f6-b34b-40e85c26674e", "", "", "30/120", "", []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 30, "long_ft": 120}}, []string{"thrown"}, false},
	{"CARD-0296", "light_hammer", "simple", "str", "1d4", "bludgeoning", "melee", "c00b501c-2e9a-4f32-89e7-1c5ed898d7b2", "", "", "20/60", "", []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 20, "long_ft": 60}}, []string{"light", "thrown"}, false},
	{"CARD-0298", "mace", "simple", "str", "1d6", "bludgeoning", "melee", "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{}, false},
	{"CARD-0305", "quarterstaff", "simple", "str", "1d6", "bludgeoning", "melee", "1464fb09-59c1-4bc5-8143-92abae8657b1", "", "", "", "1d8", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"versatile"}, false},
	{"CARD-0299", "sickle", "simple", "str", "1d4", "slashing", "melee", "c00b501c-2e9a-4f32-89e7-1c5ed898d7b2", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"light"}, false},
	{"CARD-0304", "spear", "simple", "str", "1d6", "piercing", "melee", "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3", "", "", "20/60", "1d8", []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 20, "long_ft": 60}}, []string{"thrown", "versatile"}, false},
	{"CARD-0307", "light_crossbow", "simple", "dex", "1d8", "piercing", "ranged", "c7d07a67-374c-49f6-b34b-40e85c26674e", "CARD-0749", "Арбалетный болт", "80/320", "", []map[string]any{{"kind": "ranged", "normal_ft": 80, "long_ft": 320}}, []string{"ammunition", "two_handed"}, false},
	{"CARD-0308", "dart", "simple", "finesse", "1d4", "piercing", "ranged", "2877d5fd-f912-4186-867d-53d353570ded", "", "", "20/60", "", []map[string]any{{"kind": "ranged", "normal_ft": 20, "long_ft": 60}}, []string{"finesse", "thrown"}, false},
	{"CARD-0306", "shortbow", "simple", "dex", "1d6", "piercing", "ranged", "2877d5fd-f912-4186-867d-53d353570ded", "CARD-0728", "Стрела", "80/320", "", []map[string]any{{"kind": "ranged", "normal_ft": 80, "long_ft": 320}}, []string{"ammunition", "two_handed"}, false},
	{"CARD-0293", "sling", "simple", "dex", "1d4", "bludgeoning", "ranged", "c7d07a67-374c-49f6-b34b-40e85c26674e", "CARD-0786", "Снаряд для пращи", "30/120", "", []map[string]any{{"kind": "ranged", "normal_ft": 30, "long_ft": 120}}, []string{"ammunition"}, false},
	{"CARD-0322", "battleaxe", "martial", "str", "1d8", "slashing", "melee", "1464fb09-59c1-4bc5-8143-92abae8657b1", "", "", "", "1d10", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"versatile"}, false},
	{"CARD-0309", "flail", "martial", "str", "1d8", "bludgeoning", "melee", "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{}, false},
	{"CARD-0321", "glaive", "martial", "str", "1d10", "slashing", "melee", "651f4b6a-74c1-4ecf-a787-d98580bc9495", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 10}}, []string{"heavy", "reach", "two_handed"}, true},
	{"CARD-0312", "greataxe", "martial", "str", "1d12", "slashing", "melee", "3ad18858-a1a9-44fc-a412-4748d8daaeaa", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"heavy", "two_handed"}, true},
	{"CARD-0317", "greatsword", "martial", "str", "2d6", "slashing", "melee", "651f4b6a-74c1-4ecf-a787-d98580bc9495", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"heavy", "two_handed"}, true},
	{"CARD-0325", "halberd", "martial", "str", "1d10", "slashing", "melee", "3ad18858-a1a9-44fc-a412-4748d8daaeaa", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 10}}, []string{"heavy", "reach", "two_handed"}, true},
	{"CARD-0320", "lance", "martial", "str", "1d10", "piercing", "melee", "1464fb09-59c1-4bc5-8143-92abae8657b1", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 10}}, []string{"heavy", "reach", "two_handed"}, true},
	{"CARD-0319", "longsword", "martial", "str", "1d8", "slashing", "melee", "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3", "", "", "", "1d10", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"versatile"}, false},
	{"CARD-0315", "maul", "martial", "str", "2d6", "bludgeoning", "melee", "1464fb09-59c1-4bc5-8143-92abae8657b1", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"heavy", "two_handed"}, true},
	{"CARD-B24-MORNINGSTAR", "morningstar", "martial", "str", "1d8", "piercing", "melee", "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{}, false},
	{"CARD-0314", "pike", "martial", "str", "1d10", "piercing", "melee", "82ec5a23-18f9-4c68-9119-470c1ef120d9", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 10}}, []string{"heavy", "reach", "two_handed"}, true},
	{"CARD-0313", "rapier", "martial", "finesse", "1d8", "piercing", "melee", "2877d5fd-f912-4186-867d-53d353570ded", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"finesse"}, false},
	{"CARD-0311", "scimitar", "martial", "finesse", "1d6", "slashing", "melee", "c00b501c-2e9a-4f32-89e7-1c5ed898d7b2", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"finesse", "light"}, false},
	{"CARD-0316", "shortsword", "martial", "finesse", "1d6", "piercing", "melee", "2877d5fd-f912-4186-867d-53d353570ded", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"finesse", "light"}, false},
	{"CARD-0310", "trident", "martial", "str", "1d8", "piercing", "melee", "1464fb09-59c1-4bc5-8143-92abae8657b1", "", "", "20/60", "1d10", []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 20, "long_ft": 60}}, []string{"thrown", "versatile"}, false},
	{"CARD-0324", "war_pick", "martial", "str", "1d8", "piercing", "melee", "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3", "", "", "", "1d10", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"versatile"}, false},
	{"CARD-0323", "warhammer", "martial", "str", "1d8", "bludgeoning", "melee", "82ec5a23-18f9-4c68-9119-470c1ef120d9", "", "", "", "1d10", []map[string]any{{"kind": "melee", "reach_ft": 5}}, []string{"versatile"}, false},
	{"CARD-0318", "whip", "martial", "finesse", "1d4", "slashing", "melee", "c7d07a67-374c-49f6-b34b-40e85c26674e", "", "", "", "", []map[string]any{{"kind": "melee", "reach_ft": 10}}, []string{"finesse", "reach"}, false},
	{"CARD-0326", "blowgun", "martial", "dex", "1", "piercing", "ranged", "2877d5fd-f912-4186-867d-53d353570ded", "CARD-0787", "Игла для трубки", "25/100", "", []map[string]any{{"kind": "ranged", "normal_ft": 25, "long_ft": 100}}, []string{"ammunition"}, false},
	{"CARD-0329", "hand_crossbow", "martial", "dex", "1d6", "piercing", "ranged", "2877d5fd-f912-4186-867d-53d353570ded", "CARD-0749", "Арбалетный болт", "30/120", "", []map[string]any{{"kind": "ranged", "normal_ft": 30, "long_ft": 120}}, []string{"ammunition", "light"}, false},
	{"CARD-0328", "heavy_crossbow", "martial", "dex", "1d10", "piercing", "ranged", "82ec5a23-18f9-4c68-9119-470c1ef120d9", "CARD-0749", "Арбалетный болт", "100/400", "", []map[string]any{{"kind": "ranged", "normal_ft": 100, "long_ft": 400}}, []string{"ammunition", "heavy", "two_handed"}, true},
	{"CARD-0327", "longbow", "martial", "dex", "1d8", "piercing", "ranged", "c7d07a67-374c-49f6-b34b-40e85c26674e", "CARD-0728", "Стрела", "150/600", "", []map[string]any{{"kind": "ranged", "normal_ft": 150, "long_ft": 600}}, []string{"ammunition", "heavy", "two_handed"}, true},
	{"CARD-0837", "musket", "martial", "dex", "1d12", "piercing", "ranged", "c7d07a67-374c-49f6-b34b-40e85c26674e", "CARD-0785", "Пуля", "40/120", "", []map[string]any{{"kind": "ranged", "normal_ft": 40, "long_ft": 120}}, []string{"ammunition", "two_handed"}, false},
	{"CARD-0838", "pistol", "martial", "dex", "1d10", "piercing", "ranged", "2877d5fd-f912-4186-867d-53d353570ded", "CARD-0785", "Пуля", "30/90", "", []map[string]any{{"kind": "ranged", "normal_ft": 30, "long_ft": 90}}, []string{"ammunition"}, false},
}

type baseArmor2024 struct {
	CardNumber, Category, Formula string
	StrengthRequirement           int
	StealthDisadvantage           bool
}

var baseArmors2024 = []baseArmor2024{
	{"CARD-0247", "light", "11 + dex", 0, true},
	{"CARD-0275", "light", "11 + dex", 0, false},
	{"CARD-0276", "light", "12 + dex", 0, false},
	{"CARD-0254", "medium", "12 + min(dex, 2)", 0, false},
	{"CARD-0278", "medium", "13 + min(dex, 2)", 0, false},
	{"CARD-0269", "medium", "14 + min(dex, 2)", 0, true},
	{"CARD-0271", "medium", "14 + min(dex, 2)", 0, false},
	{"CARD-0286", "medium", "15 + min(dex, 2)", 0, true},
	{"CARD-0287", "heavy", "14", 0, true},
	{"CARD-0283", "heavy", "16", 13, true},
	{"CARD-0290", "heavy", "17", 15, true},
	{"CARD-0291", "heavy", "18", 15, true},
	{"CARD-0200", "shield", "+2", 0, false},
}

type utilityItem2024 struct {
	CardNumber string
	Mechanics  map[string]any
}

func itemTargeting(shape string, feet int, relations ...string) map[string]any {
	return map[string]any{
		"domain": "actor", "actor_targets": true, "shape": shape,
		"min_targets": 1, "max_targets": 1, "range_ft": feet,
		"requires_line_of_sight": true, "allowed_relations": relations,
	}
}

func activeItem2024(cost string, consumed bool, payloads ...map[string]any) map[string]any {
	costs := []map[string]any{{"resource": cost}}
	if consumed {
		costs = append(costs, map[string]any{"resource": "self_item", "amount": 1})
	}
	return map[string]any{
		"activation": map[string]any{"mode": "active", "while": "carried", "cost": costs},
		"effects":    []map[string]any{{"resolution": "auto", "result": payloads}},
	}
}

func saveItem2024(cost string, consumed bool, feet int, relations []string, dc string, onFail ...map[string]any) map[string]any {
	mechanics := activeItem2024(cost, consumed)
	mechanics["targeting"] = itemTargeting("single", feet, relations...)
	mechanics["effects"] = []map[string]any{{
		"resolution": "save", "ability": "dex", "dc": dc,
		"on_fail": onFail, "on_success": []any{},
	}}
	return mechanics
}

func passiveItem2024(description string) map[string]any {
	return map[string]any{
		"activation": map[string]any{"mode": "passive", "while": "carried"},
		"effects":    []map[string]any{{"resolution": "auto", "result": []map[string]any{{"kind": "narrative", "description": description}}}},
	}
}

func utilityItems2024() []utilityItem2024 {
	narrative := func(text string) map[string]any { return map[string]any{"kind": "narrative", "description": text} }
	zone := func(kind, text, shape string, size int) map[string]any {
		return map[string]any{"kind": "world_zone", "zone_type": kind, "geometry": map[string]any{"shape": shape, "size_ft": size}, "description": text, "duration": map[string]any{"type": "permanent"}}
	}
	nextCheck := func(op, value string, filter map[string]any, source string) map[string]any {
		payload := map[string]any{
			"kind": "modifier", "applies_to": map[string]any{"roll": "ability_check", "filter": filter},
			"op": op, "consume": "next", "duration": map[string]any{"type": "manual"}, "source": source,
		}
		if value != "" {
			payload["value"] = value
		}
		return map[string]any{
			"activation": map[string]any{"mode": "active", "while": "carried", "cost": []map[string]any{}},
			"effects":    []map[string]any{{"resolution": "auto", "result": []map[string]any{payload}}},
		}
	}
	rows := []utilityItem2024{
		{"CARD-0791", saveItem2024("action", true, 20, []string{"enemy", "neutral"}, "8 + dex + prof_bonus", map[string]any{"kind": "damage", "dice": "2d6", "type": "acid"})},
		{"CARD-0714", saveItem2024("action", true, 20, []string{"enemy", "neutral"}, "8 + dex + prof_bonus",
			map[string]any{"kind": "damage", "dice": "1d4", "type": "fire"},
			map[string]any{"kind": "triggered_effect", "event": "turn_start", "effects": []map[string]any{{"resolution": "auto", "result": []map[string]any{{"kind": "damage", "dice": "1d4", "type": "fire"}}}}, "duration": map[string]any{"type": "manual"}, "description": "Горение: 1к4 огня в начале хода; снимите эффект после тушения действием."})},
		{"CARD-0811", activeItem2024("bonus_action", true, map[string]any{"kind": "modifier", "applies_to": map[string]any{"roll": "saving_throw"}, "op": "advantage", "when": []map[string]any{{"kind": "save_avoids_condition", "value": "poisoned"}}, "duration": map[string]any{"type": "hours", "amount": 1}, "source": "Противоядие"})},
		{"CARD-0491", func() map[string]any {
			m := activeItem2024("action", false, map[string]any{"kind": "stabilize", "who": "target"}, narrative("Использован один из 10 зарядов комплекта."))
			m["effects"].([]map[string]any)[0]["who"] = "target"
			m["uses"] = map[string]any{"count": 10, "per": "never"}
			m["activation"].(map[string]any)["cost"] = append(m["activation"].(map[string]any)["cost"].([]map[string]any), map[string]any{"resource": "self_uses", "amount": 1})
			m["targeting"] = itemTargeting("single", 5, "ally")
			return m
		}()},
		{"CARD-0815", func() map[string]any {
			m := saveItem2024("action", true, 20, []string{"enemy", "neutral"}, "8 + dex + prof_bonus", map[string]any{"kind": "damage", "dice": "2d8", "type": "radiant"})
			m["effects"].([]map[string]any)[0]["automatic_success"] = map[string]any{"if_target_creature_type_not_in": []string{"fiend", "undead"}}
			return m
		}()},
		{"CARD-0723", activeItem2024("action", true, zone("oil", "Лужа масла 5×5 фт; после поджига горит 2 раунда и наносит 5 урона огнём.", "cube", 5))},
		{"CARD-0832", activeItem2024("bonus_action", true,
			map[string]any{"kind": "damage_rider", "trigger": "hit_by_attack_roll", "dice": "1d4", "type": "poison", "filter": map[string]any{"attackKind": "weapon"}, "consume": "next", "duration": map[string]any{"type": "rounds", "amount": 10}, "description": "Следующее попадание отравленным оружием добавляет 1к4 урона ядом."})},
		// CARD-0839 already owns exact executable 2d4+2 healing and self-item consumption.
		{"CARD-0728", passiveItem2024("Стрела расходуется профилем лука при каждой дальнобойной атаке.")},
		{"CARD-0749", passiveItem2024("Арбалетный болт расходуется профилем арбалета при каждой дальнобойной атаке.")},
		{"CARD-0785", passiveItem2024("Пуля расходуется профилем мушкета или пистоля при каждой дальнобойной атаке.")},
		{"CARD-0786", passiveItem2024("Снаряд расходуется профилем пращи при каждой дальнобойной атаке.")},
		{"CARD-0787", passiveItem2024("Игла расходуется профилем духовой трубки при каждой дальнобойной атаке.")},
		{"CARD-0799", activeItem2024("action", false, zone("ball_bearings", "Зона 10×10 фт; спасбросок Ловкости Сл 10 или состояние Опрокинутый.", "cube", 10))},
		{"CARD-0790", activeItem2024("action", false, zone("caltrops", "Зона 5×5 фт; спасбросок Ловкости Сл 15 или 1 колющего урона и Скорость 0 до начала следующего хода.", "cube", 5))},
		{"CARD-0829", activeItem2024("action", false, narrative("Связывает схваченную, недееспособную или опутанную цель; вырваться можно проверкой Силы (Атлетика) Сл 18."))},
		{"CARD-0793", activeItem2024("action", false, narrative("Закрепляет персонажа: он не может упасть более чем на 25 фт от точки крепления."))},
		{"CARD-0407", nextCheck("advantage", "", map[string]any{"ability": "str"}, "Ломик")},
		{"CARD-0795", activeItem2024("action", false, narrative("Бросок в точку до 50 фт: проверка Ловкости (Акробатика) Сл 13 закрепляет крюк."))},
		{"CARD-0411", activeItem2024("action", false, zone("hunting_trap", "Существо делает спасбросок Ловкости Сл 13; при провале 1к4 колющего урона и Скорость 0 до освобождения.", "cube", 5))},
		{"CARD-0748", activeItem2024("action", false, narrative("Сковывает подходящую цель: помеха атакам и ограничение движений; побег требует проверку Ловкости Сл 20 или Силы Сл 25."))},
		{"CARD-0330", saveItem2024("action", false, 15, []string{"enemy", "neutral"}, "8 + dex + prof_bonus", map[string]any{"kind": "condition", "value": "restrained", "duration": map[string]any{"type": "permanent"}}, narrative("Сеть можно разорвать проверкой Силы Сл 10."))},
		{"CARD-0819", nextCheck("add", "+4", map[string]any{"ability": "str"}, "Портативный таран")},
		{"CARD-0706", activeItem2024("action", false, narrative("Связывает подходящую цель или объект; побег и разрыв разрешаются проверками по правилу верёвки."))},
		{"CARD-0823", activeItem2024("action", false, zone("torch_light", "Яркий свет 20 фт и тусклый ещё 20 фт на 1 час; импровизированное оружие добавляет 1 урона огнём.", "sphere", 20))},
	}

	passive := map[string]string{
		"CARD-0703": "Во время сна автоматически защищает от спасбросков против экстремального холода.",
		"CARD-0808": "Даёт преимущество на спасброски против экстремального холода.",
		"CARD-0715": "Позволяет поднять груз до четырёхкратного обычного предела.",
		"CARD-0847": "+5 к подходящей проверке Магии, Истории, Природы или Религии по теме книги.",
		"CARD-0789": "Закрывается ключом; без ключа открывается проверкой Ловкости с воровскими инструментами Сл 15.",
		"CARD-0801": "Заменяет материальные компоненты заклинаний без указанной стоимости и расходования.",
		"CARD-0826": "Магическая фокусировка для Чародея, Колдуна или Волшебника.",
		"CARD-0827": "Друидическая фокусировка для Друида.",
		"CARD-0816": "Священная фокусировка для Жреца или Паладина.",
		"CARD-0813": "Контейнер: до 30 фнт или 1 куб. фт.", "CARD-0800": "Контейнер: до 6 фнт или 1/5 куб. фт.",
		"CARD-0729": "Контейнер: до 20 стрел.", "CARD-0828": "Контейнер: до 20 арбалетных болтов.",
		"CARD-0821": "Контейнер: до 10 листов бумаги или 5 листов пергамента.",
		"CARD-0802": "Набор распаковывается в точный состав.", "CARD-0803": "Набор распаковывается в точный состав.",
		"CARD-0804": "Набор распаковывается в точный состав.", "CARD-0805": "Набор распаковывается в точный состав.",
		"CARD-0806": "Набор распаковывается в точный состав.", "CARD-0409": "Набор распаковывается в точный состав.",
		"CARD-0807": "Набор распаковывается в точный состав.",
	}
	for cardNumber, text := range passive {
		rows = append(rows, utilityItem2024{cardNumber, passiveItem2024(text)})
	}
	rows = append(rows,
		utilityItem2024{"CARD-0822", nextCheck("advantage", "", map[string]any{"skill": "investigation"}, "Увеличительное стекло")},
		utilityItem2024{"CARD-0389", nextCheck("add", "+5", map[string]any{"skill": "survival"}, "Карта")},
		utilityItem2024{"CARD-0696", nextCheck("advantage", "", map[string]any{"skill": "persuasion"}, "Духи")},
		utilityItem2024{"CARD-0831", nextCheck("advantage", "", map[string]any{"skill": "athletics"}, "Шест")},
	)

	for cardNumber, text := range map[string]string{
		"CARD-0792":         "Колокольчик слышен на расстоянии до 60 фт.",
		"CARD-0814":         "Свеча горит 1 час: яркий свет 5 фт и тусклый ещё 5 фт.",
		"CARD-0713":         "Лампа на масле: яркий свет 15 фт и тусклый ещё 30 фт.",
		"CARD-B24-BULLSEYE": "Направленный фонарь на масле: яркий конус 60 фт и тусклый ещё 60 фт.",
		"CARD-0722":         "Закрытый фонарь на масле: яркий свет 30 фт и тусклый ещё 30 фт; колпак управляется бонусным действием.",
		"CARD-0820":         "Зажигает факел, лампу или другой открытый огонь; без готового топлива требуется 1 минута.",
	} {
		rows = append(rows, utilityItem2024{cardNumber, activeItem2024("action", false, narrative(text))})
	}
	return rows
}

func weaponProfile2024(tx *sql.Tx, row baseWeapon2024) (map[string]any, error) {
	var ammo any
	if row.AmmoCardNumber != "" {
		var ammoID string
		if err := tx.QueryRow(`SELECT id::text FROM cards WHERE card_number=$1 AND deleted_at IS NULL`, row.AmmoCardNumber).Scan(&ammoID); err != nil {
			return nil, fmt.Errorf("resolve %s ammo %s: %w", row.CardNumber, row.AmmoCardNumber, err)
		}
		ammo = map[string]any{"card_id": ammoID, "name": row.AmmoName}
	}
	profile := map[string]any{
		"weapon_type": row.WeaponType, "proficiency_category": row.Category,
		"attack_ability": row.Ability, "damage_lines": []map[string]any{{"dice": row.Dice, "type": row.DamageType}},
		"default_attack_mode": row.DefaultMode, "attack_modes": row.Modes, "properties": row.Properties,
		"mastery_effect_id": row.MasteryID, "ammo": ammo,
		"enchantment": map[string]any{"attack_bonus": 0, "damage_bonus": 0, "extra_damage_lines": []any{}},
		"attunement":  map[string]any{"required": false},
	}
	if row.VersatileDice != "" {
		profile["versatile_grip"] = map[string]any{"dice": row.VersatileDice, "type": row.DamageType}
	}
	if row.Heavy {
		profile["heavy"] = map[string]any{
			"minimum_ability_score": 13,
			"ability_by_mode":       map[string]any{"melee": "str", "ranged": "dex"},
			"consequence":           "attack_disadvantage",
		}
	}
	return profile, nil
}

func materializeBaseEquipment2024(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		INSERT INTO cards (id,name,name_en,description,image_url,rarity,card_number,price,price_currency,weight,
			bonus_type,bonus_value,damage_type,type,weapon_type,mastery,source,slot,is_template,created_at,updated_at)
		VALUES ('946b2b0d-8c45-4f8c-b718-c7135e41977a'::uuid,'Моргенштерн','Morningstar',
			'Воинское рукопашное оружие. 1к8 колющего урона. Мастерство: Ослабляющее.','',
			'common','CARD-B24-MORNINGSTAR',15,'gold',4,'damage','1d8','piercing','weapon','morningstar',
			'4cfe0660-ba1c-415b-b1ed-15e3c708a8e3','PHB 2024','one_hand','false',NOW(),NOW())
		ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL, updated_at=NOW()
	`); err != nil {
		return fmt.Errorf("upsert Morningstar: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO cards (id,name,name_en,description,image_url,rarity,card_number,price,price_currency,weight,
			type,source,is_template,created_at,updated_at)
		VALUES ('5eedaf1c-0607-4b84-995a-0963c89c7da8'::uuid,'Фонарь, направленный','Bullseye Lantern',
			'На масле даёт яркий свет конусом 60 футов и тусклый свет ещё на 60 футов.','',
			'common','CARD-B24-BULLSEYE',10,'gold',2,'tool','PHB 2024','false',NOW(),NOW())
		ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL, updated_at=NOW()
	`); err != nil {
		return fmt.Errorf("upsert Bullseye Lantern: %w", err)
	}

	for _, row := range baseWeapons2024 {
		profile, err := weaponProfile2024(tx, row)
		if err != nil {
			return err
		}
		encoded, _ := json.Marshal(profile)
		result, err := tx.Exec(`
			UPDATE cards SET mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{weapon_profile}',$2::jsonb,true),
				weapon_type=$3, mastery=$4, range=NULLIF($5,''), bonus_value=$6, damage_type=$7,
				support=NULL, updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL
		`, row.CardNumber, encoded, row.WeaponType, row.MasteryID, row.Range, row.Dice, row.DamageType)
		if err != nil {
			return fmt.Errorf("materialize %s: %w", row.CardNumber, err)
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return fmt.Errorf("materialize %s affected %d rows", row.CardNumber, n)
		}
	}

	for _, row := range baseArmors2024 {
		profile := map[string]any{
			"category": row.Category, "ac_formula": row.Formula,
			"strength_requirement": row.StrengthRequirement,
			"stealth_disadvantage": row.StealthDisadvantage,
			"training_required":    true,
		}
		mechanics := map[string]any{"activation": map[string]any{"mode": "passive", "while": "equipped"}, "armor_profile": profile}
		if row.StealthDisadvantage {
			mechanics["effects"] = []map[string]any{{"resolution": "auto", "result": []map[string]any{{
				"kind": "modifier", "applies_to": map[string]any{"roll": "ability_check", "filter": map[string]any{"skill": "stealth"}},
				"op": "disadvantage", "source": "Доспех", "reason": "Помеха Скрытности",
			}}}}
		} else {
			mechanics["effects"] = []any{}
		}
		encoded, _ := json.Marshal(mechanics)
		result, err := tx.Exec(`UPDATE cards SET mechanics=$2::jsonb, bonus_value=$3, support=NULL, updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, row.CardNumber, encoded, row.Formula)
		if err != nil {
			return fmt.Errorf("materialize armor %s: %w", row.CardNumber, err)
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return fmt.Errorf("materialize armor %s affected %d rows", row.CardNumber, n)
		}
	}

	for _, row := range utilityItems2024() {
		encoded, err := json.Marshal(row.Mechanics)
		if err != nil {
			return fmt.Errorf("encode utility item %s: %w", row.CardNumber, err)
		}
		result, err := tx.Exec(`UPDATE cards SET mechanics=$2::jsonb, support=NULL, updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, row.CardNumber, encoded)
		if err != nil {
			return fmt.Errorf("materialize utility item %s: %w", row.CardNumber, err)
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return fmt.Errorf("materialize utility item %s affected %d rows", row.CardNumber, n)
		}
	}
	return tx.Commit()
}
