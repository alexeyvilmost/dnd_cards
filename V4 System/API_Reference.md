#### Администрирование персонажей

{% cut "GET /api/v4/characters/get?id=\{character\_id\}&type=\{pure\|play\}&inventories=\{cut\|full\}" %}

Ручка получения персонажа по id

- id - идентификатор персонажа
- type - тип ответа
  * pure - базовый лист персонажа - без применённых временных эффектов
  * play - лист персонажа для игры - с применёнными временными эффектами
- inventories - как отображать инвентари
  * cut - отображать id соответствующих инвентарей
  * full - раскрыть инвентари и вернуть их содержимое

ВАЖНО: Примеры ниже не отображают реальные свойства эффектов/предметов и т.д, они приведены для понимания структуры.

Response:

``` showLineNumbers
GET api/v4/characters/get?id=3b352707-d200-4bd7-927c-ef449c725fa8&type=pure&inventories=cut

{
    "id": "3b352707-d200-4bd7-927c-ef449c725fa8", // id персонажа
    "user_id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a", // id пользователя
    "group_id": null, // id группы персонажа
    "name": "Люцис", // имя персонажа
    "race": "half-orc", // раса персонажа
	"race_id": {HALF_ORC_UUID}, // идентификатор расы персонажа
	"backstory": "artist", // предыстория персонажа
	"backstory_id": {ARTIST_UUID} // id предыстории персонажа
	"levels": { // все уровни персонажа
		"level": 1, // общий уровень персонажа
		"xp": 0, // очки опыта персонажа
		"classes": [ // список классов персонажа
			{
				"class_name": "barbarian", // название класса
				"class_id": {BARBARIAN_UUID} // идентификатор класса
				"subclass_name": "fanatic", // название подкласса (необязательно)
				"subclass_id": {BARBARIAN_FANATIC_UUID}, // идентификатор подкласса
				"class_level": 1 // общий уровень данного класса
			}
		]
	},
	"proficiency_bonus": 2, // бонус мастерства
	"armor_class": 11, // класс доспеха
	"resistances": { // устойчивости и уязвимости
		"resist": [], // устойчивости
		"immune": [], // иммунитеты
		"vulnerable": [] // уязвимость
	},
    "abilities": { // базовые характеристики персонажа
		"strength": 17,
		"dexterity": 13,
		"constitution": 15,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"hits": { // информация о здоровье (хитах) персонажа
		"max_hp": 14, // максимальное здоровье
		"current_hp": 14, // текущее здоровье
		"temporary_hp": 0, // временное здоровье
		"hit_dices": { // кости хитов персонажа
			"1d12": 1
		}
	},
	"proficiencies": { // владения
		"saving_throws": [ // спасброски
    		"strength",
    		"constitution"
		],
		"skills": [ // навыки
        	"athletics",
			"intimidation",
			"survival",
			"nature"
		],
		"armor": [ // доспехи
			"light",
			"shields"
		],
		"weapon": [ // оружие
			"simple",
			"battleaxe"
		],
		"languages": [ // языки
			"common",
			"orc"
		],
		"tools": [] // инструменты
	},
	"inventories": { // инвентари персонажа
		"items": "{ITEM_INVENTORY_UUID}", // инвентарь предметов
		"actions": "{ACTION_INVENTORY_UUID}", // инвентарь действий
		"effects": "{EFFECT_INVENTORY_UUID}", // инвентарь эффектов
		"resources": "{RESOURCE_INVENTORY_UUID}", // инвентарь ресурсов
	},
    "created_at": "2025-11-24T23:22:51.055976Z", // дата создания персонажа
    "updated_at": "2025-11-24T23:22:51.055976Z", // дата обновления персонажа
    "user": { // информация о пользователе
        "id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a",
        "username": "testuser",
        "email": "test@example.com",
        "display_name": "Тестовый пользователь",
        "created_at": "2025-09-06T10:02:18.901474Z",
        "updated_at": "2025-09-06T10:02:18.901474Z"
    },
}
```

Response

``` showLineNumbers
GET api/v4/characters/get?id=3b352707-d200-4bd7-927c-ef449c725fa8&type=pure&inventories=full

{
    "id": "3b352707-d200-4bd7-927c-ef449c725fa8", // id персонажа
    "user_id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a", // id пользователя
    "group_id": null, // id группы персонажа
    "name": "Люцис", // имя персонажа
    "race": "half-orc", // раса персонажа
	"race_id": {HALF_ORC_UUID}, // идентификатор расы персонажа
	"backstory": "artist", // предыстория персонажа
	"backstory_id": {ARTIST_UUID} // id предыстории персонажа
	"levels": { // все уровни персонажа
		"level": 1, // общий уровень персонажа
		"xp": 0, // очки опыта персонажа
		"classes": [ // список классов персонажа
			{
				"class_name": "barbarian", // название класса
				"class_id": {BARBARIAN_UUID} // идентификатор класса
				"subclass_name": "fanatic", // название подкласса (необязательно)
				"subclass_id": {BARBARIAN_FANATIC_UUID}, // идентификатор подкласса
				"class_level": 1 // общий уровень данного класса
			}
		]
	},
	"proficiency_bonus": 2, // бонус мастерства
	"armor_class": 11, // класс доспеха
	"resistances": { // устойчивости и уязвимости
		"resist": [], // устойчивости
		"immune": [], // иммунитеты
		"vulnerable": [] // уязвимость
	},
    "abilities": { // базовые характеристики персонажа
		"strength": 17,
		"dexterity": 13,
		"constitution": 15,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"hits": { // информация о здоровье (хитах) персонажа
		"max_hp": 14, // максимальное здоровье
		"current_hp": 14, // текущее здоровье
		"temporary_hp": 0, // временное здоровье
		"hit_dices": { // кости хитов персонажа
			"1d12": 1
		}
	},
	"proficiencies": { // владения
		"saving_throws": [ // спасброски
    		"strength",
    		"constitution"
		],
		"skills": [ // навыки
        	"athletics",
			"intimidation",
			"survival",
			"nature"
		],
		"armor": [ // доспехи
			"light",
			"shields"
		],
		"weapon": [ // оружие
			"simple",
			"battleaxe"
		],
		"languages": [ // языки
			"common",
			"orc"
		],
		"tools": [] // инструменты
	},
	"inventories": { // инвентари персонажа
		"items_inventory": { // инвентарь предметов
            "equipped_items": { // надетые предметы
                "head": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // шлем
                "body": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // доспех
                "arms": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // наручи
                "feet": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "ring": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "necklace": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "cloak": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "first_hands": { // первый набор оружия
                    "right": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // правая рука
                    "left": "3ea27d6c-5a12-48f2-953a-0b955de6e673" // левая рука
                },
                "second_hands": { // второй набор оружия
                    "right": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // правая рука
                    "left": "3ea27d6c-5a12-48f2-953a-0b955de6e673" // левая рука
                },
            },
            "money": { // валюта
                "copper": 100,
                "silver": 100,
                "gold": 100,
                "platinum": 100,
                "electum": 100,
                "dragonite": 100,
                "adamantite": 100,
                "black": 100
            },
            "backpack": [ // рюкзак
                "c830dce3-33d3-4514-8bf5-670fa0e299f2",
                "9515fd6f-7478-4363-affa-14bc0e3a4e36",
                "012ed1f7-3a48-4772-853d-a69cca6d0060",
                "012ed1f7-3a48-4772-853d-a69cca6d0060",
                "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "3ea27d6c-5a12-48f2-953a-0b955de6e673"
            ],
        },
		"actions_inventory": [ // инвентарь действий
            {
                "name": "action_dash", // название действия
                "is_used": false, // использовано ли действие
                "reload": "per_turn", // перезарядка
            },
            {
                "name": "action_throw",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_shove",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_jump",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_unarmed_strike",
                "is_used": false,
                "reload": "per_turn",
            },          
            {
                "name": "action_melee_attack",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_ranged_attack",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_improvise",
                "is_used": false,
                "reload": "per_turn",
            }
            {
                "name": "action_barbarian_rage_2",
                "is_used": true,
                "reload": "per_long_rest",
            }
        ], 
		"effects_inventory": [ // инвентарь эффектов
            "effect_unarmored_defense",
            "effect_darkvision_60",
            "effect_dwarven_resistance",
            "effect_dwarven_tools",
            "effect_dwarven_stonecunning",
            "effect_dwarven_toughness",
            "effect_artist_backstory"
        ], // инвентарь эффектов
		"resources_inventory": { // инвентарь ресурсов
            "main_action" {
                "current": 1,
                "max": 1
            },
            "bonus_action": {
                "current": 1,
                "max": 1
            },
            "reaction": {
                "current": 1,
                "max": 1
            },
            "free_action": {
                "current": 1,
                "max": 1
            },
            "speed_30": {
                "current": 30,
                "max": 30
            },
            "rage_charge_2": {
                "current": 2,
                "max": 2
            }
        },
	},
    "created_at": "2025-11-24T23:22:51.055976Z", // дата создания персонажа
    "updated_at": "2025-11-24T23:22:51.055976Z", // дата обновления персонажа
    "user": { // информация о пользователе
        "id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a",
        "username": "testuser",
        "email": "test@example.com",
        "display_name": "Тестовый пользователь",
        "created_at": "2025-09-06T10:02:18.901474Z",
        "updated_at": "2025-09-06T10:02:18.901474Z"
    },
}
```

Response:

``` showLineNumbers
GET api/v4/characters/get?id=3b352707-d200-4bd7-927c-ef449c725fa8&type=pure&inventories=full

{
    "id": "3b352707-d200-4bd7-927c-ef449c725fa8", // id персонажа
    "user_id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a", // id пользователя
    "group_id": null, // id группы персонажа
    "name": "Люцис", // имя персонажа
    "race": "half-orc", // раса персонажа
	"race_id": {HALF_ORC_UUID}, // идентификатор расы персонажа
	"backstory": "artist", // предыстория персонажа
	"backstory_id": {ARTIST_UUID} // id предыстории персонажа
	"levels": { // все уровни персонажа
		"level": 1, // общий уровень персонажа
		"xp": 0, // очки опыта персонажа
		"classes": [ // список классов персонажа
			{
				"class_name": "barbarian", // название класса
				"class_id": {BARBARIAN_UUID} // идентификатор класса
				"subclass_name": "fanatic", // название подкласса (необязательно)
				"subclass_id": {BARBARIAN_FANATIC_UUID}, // идентификатор подкласса
				"class_level": 1 // общий уровень данного класса
			}
		]
	},
	"proficiency_bonus": 2, // бонус мастерства
	"armor_class": 11, // класс доспеха
	"resistances": { // устойчивости и уязвимости
		"resist": [], // устойчивости
		"immune": [], // иммунитеты
		"vulnerable": [] // уязвимость
	},
    "abilities": { // базовые характеристики персонажа
		"strength": 17,
		"dexterity": 13,
		"constitution": 15,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"hits": { // информация о здоровье (хитах) персонажа
		"max_hp": 14, // максимальное здоровье
		"current_hp": 14, // текущее здоровье
		"temporary_hp": 0, // временное здоровье
		"hit_dices": { // кости хитов персонажа
			"1d12": 1
		}
	},
	"proficiencies": { // владения
		"saving_throws": [ // спасброски
    		"strength",
    		"constitution"
		],
		"skills": [ // навыки
        	"athletics",
			"intimidation",
			"survival",
			"nature"
		],
		"armor": [ // доспехи
			"light",
            "medium", // добавлено от надетого доспеха 3ea27d6c-5a12-48f2-953a-0b955de6e673
			"shields"
		],
		"weapon": [ // оружие
			"simple",
			"battleaxe"
		],
		"languages": [ // языки
			"common",
			"orc"
		],
		"tools": [] // инструменты
	},
	"inventories": { // инвентари персонажа
		"items_inventory": { // инвентарь предметов
            "equipped_items": { // надетые предметы
                "head": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // шлем
                "body": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // доспех
                "arms": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // наручи
                "feet": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "ring": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "necklace": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "cloak": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "first_hands": { // первый набор оружия
                    "right": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // правая рука
                    "left": "3ea27d6c-5a12-48f2-953a-0b955de6e673" // левая рука
                },
                "second_hands": { // второй набор оружия
                    "right": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // правая рука
                    "left": "3ea27d6c-5a12-48f2-953a-0b955de6e673" // левая рука
                },
            },
            "money": { // валюта
                "copper": 100,
                "silver": 100,
                "gold": 100,
                "platinum": 100,
                "electum": 100,
                "dragonite": 100,
                "adamantite": 100,
                "black": 100
            },
            "backpack": [ // рюкзак
                "c830dce3-33d3-4514-8bf5-670fa0e299f2",
                "9515fd6f-7478-4363-affa-14bc0e3a4e36",
                "012ed1f7-3a48-4772-853d-a69cca6d0060",
                "012ed1f7-3a48-4772-853d-a69cca6d0060",
                "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "3ea27d6c-5a12-48f2-953a-0b955de6e673",
                "3ea27d6c-5a12-48f2-953a-0b955de6e673"
            ],
        },
		"actions_inventory": [ // инвентарь действий
            {
                "name": "action_dash", // название действия
                "is_used": false, // использовано ли действие
                "reload": "per_turn", // перезарядка
            },
            {
                "name": "action_throw",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_shove",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_jump",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_unarmed_strike",
                "is_used": false,
                "reload": "per_turn",
            },          
            {
                "name": "action_melee_attack",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_ranged_attack",
                "is_used": false,
                "reload": "per_turn",
            },
            {
                "name": "action_improvise",
                "is_used": false,
                "reload": "per_turn",
            }
            {
                "name": "action_barbarian_rage_2",
                "is_used": true,
                "reload": "per_long_rest",
            }
        ], 
		"effects_inventory": [ // инвентарь эффектов
            "effect_unarmored_defense",
            "effect_darkvision_60",
            "effect_dwarven_resistance",
            "effect_dwarven_tools",
            "effect_dwarven_stonecunning",
            "effect_dwarven_toughness",
            "effect_artist_backstory"
        ], // инвентарь эффектов
		"resources_inventory": { // инвентарь ресурсов
			"id": {resources_inventory_id},
            "main_action" {
                "current": 1,
                "max": 1
            },
            "bonus_action": {
                "current": 1,
                "max": 1
            },
            "reaction": {
                "current": 1,
                "max": 1
            },
            "free_action": {
                "current": 1,
                "max": 1
            },
            "speed_30": {
                "current": 30,
                "max": 30
            },
            "rage_charge_2": {
                "current": 2,
                "max": 2
            }
        },
	},
    "created_at": "2025-11-24T23:22:51.055976Z", // дата создания персонажа
    "updated_at": "2025-11-24T23:22:51.055976Z", // дата обновления персонажа
    "user": { // информация о пользователе
        "id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a",
        "username": "testuser",
        "email": "test@example.com",
        "display_name": "Тестовый пользователь",
        "created_at": "2025-09-06T10:02:18.901474Z",
        "updated_at": "2025-09-06T10:02:18.901474Z"
    },
}
```

{% endcut %}

{% cut "POST /api/v4/charactes/create" %}

Ручка создания нового персонажа

``` showLineNumbers
POST /api/v4/characters/create

{
	"name": "Oleg", // имя
	"race": "{SUBRACE_UUID}", // раса
	"classes": [ // классы
		{
			"class": "{CLASS_UUID}", // идентификатор класса
			"subclass": "{SUBCLASS_UUID}", // идентификатор подкласса (необязательно)
			"level": 1 // уровень класса
		},
	],
	"backstory": "{BACKSTORY_UUID}", // предыстория
	"abilities": { // базовые характеристик
		"strength": 16,
		"dexterity": 14,
		"constitution": 13,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"class": { // выбор в классе (необязательно) 
		"level_1": {
            "chosen_skills": [
                "acrobatics",
                "performance"
		    ],
        }
	}
}
```

Response

``` showLineNumbers
{
	"character_id": {UUID},
	"warning": false
}
```

Если не указать какой-либо из необязательных параметров, который уже нужен (например, выбор в первом уровне, система сохранит персонажа с предупреждением, а пропущенный выбор можно будет сделать в дальнейшем (до первого действия персонажа)):

Response

``` showLineNumbers
{
	"character_id": {UUID},
	"warning": true,
	"warnings": [
		"warning_skill_proficiency_not_chosen"
	]
}
```

{% endcut %}

После создания персонажа его нельзя изменить напрямую (TODO: возможно, добавить админскую ручку для изменения). Для того, чтобы что-то поменять в персонаже, нужно добавить ему соответствующий постоянный эффект.

#### Предметы

{% cut "GET /api/v4/items/get?id=\{item\_id\} (аналогичен GET /api/cards/\{item\_id\})" %}

``` showLineNumbers
{
    "id": "c4a2d6e6-de31-433a-9e40-17aec58634a9",
    "name": "Легкий молот послушника",
    "properties": [
        "light",
        "thrown"
    ],
    "description": "В руках паладина или жреца этот молот имеет зачарование +2.",
    "detailed_description": null,
    "image_url": "https://dnd-cards-images.storage.yandexcloud.net/weapon_templates/1757208567_TQcxdyeT.png",
    "rarity": "uncommon",
    "card_number": "CARD-0443",
    "price": 85,
    "weight": 2,
    "bonus_type": "damage",
    "bonus_value": "1d4",
    "damage_type": "bludgeoning",
    "defense_type": null,
    "type": "weapon",
    "weapon_type": null,
    "description_font_size": null,
    "text_alignment": null,
    "text_font_size": null,
    "show_detailed_description": false,
    "detailed_description_alignment": null,
    "detailed_description_font_size": null,
    "is_extended": false,
    "tags": [
        "Ближнее",
        "Метательное",
        "Простое",
        "Метательное"
    ],
    "is_template": "false",
    "slot": "one_hand",
    "effects": null,
    "created_at": "2025-12-16T21:16:49.794157Z",
    "updated_at": "2025-12-16T21:16:49.904852Z"
}
```

{% endcut %}

{% cut "GET /api/v4/items-inventory/get?id=\{inventory\_id\}" %}

``` showLineNumbers
{
	"items_inventory": { // инвентарь предметов
	"id": {inventory_id},
    "equipped_items": { // надетые предметы
        "head": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // шлем
        "body": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // доспех
        "arms": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // наручи
        "feet": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "ring": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "necklace": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "cloak": "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "first_hands": { // первый набор оружия
            "right": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // правая рука
            "left": "3ea27d6c-5a12-48f2-953a-0b955de6e673" // левая рука
        },
        "second_hands": { // второй набор оружия
            "right": "3ea27d6c-5a12-48f2-953a-0b955de6e673", // правая рука
            "left": "3ea27d6c-5a12-48f2-953a-0b955de6e673" // левая рука
        },
    },
    "money": { // валюта
        "copper": 100,
        "silver": 100,
        "gold": 100,
        "platinum": 100,
        "electum": 100,
        "dragonite": 100,
        "adamantite": 100,
        "black": 100
    },
    "backpack": [ // рюкзак
        "c830dce3-33d3-4514-8bf5-670fa0e299f2",
        "9515fd6f-7478-4363-affa-14bc0e3a4e36",
        "012ed1f7-3a48-4772-853d-a69cca6d0060",
        "012ed1f7-3a48-4772-853d-a69cca6d0060",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673"
    ],
	},
}
```

{% endcut %}

{% cut "POST /api/v4/items-inventory/add" %}

Добавить в рюкзак выбранного инвентаря валюту и/или предмет

``` showLineNumbers
{
	"items_inventory": "{INVENTORY_UUID}", // идентификатор инвентаря
	"items": [
		{
            "item_id": "c4a2d6e6-de31-433a-9e40-17aec58634a9",
            "quantity": 1
        }
	],
    "money": [
        {
            "currency": "copper",
            "amount": 10
        }
    ]
}
```

``` showLineNumbers
{
	"result": "Добавление успешно",
	"items_added": 1,
	"money_added": 10
}
```

{% endcut %}

{% cut "POST /api/v4/items-inventory/remove" %}

Удалить из выбранного инвентаря валюту и/или предмет

``` showLineNumbers
{
	"items_inventory": "{INVENTORY_UUID}", // идентификатор инвентаря
	"items": [
		{
            "item_id": "c4a2d6e6-de31-433a-9e40-17aec58634a9",
            "quantity": 1
        }
	],
    "money": [
        {
            "currency": "copper",
            "amount": 10
        }
    ]
}
```

Если в инвентаре меньше предметов или валюты, которых нужно удалить, количество преметов или валюты снижается до 0. Если таких предметов или валюты нет, запрос ничего не делает.

``` showLineNumbers
{
	"result": "Ничего не удалено"
}
```

``` showLineNumbers
{
	"result": "Удаление успешно",
	"items_removed": 1,
	"money_removed": 10,
}
```

{% endcut %}

{% cut "POST /api/v4/items-inventory/equip?replace=false" %}

Параметр replace отвечает за поведение в случае уже экипированного предмета в этот слот:

- true - снимет надетый предмет и наденет запрошенный
- false - не снимет предмет, вернёт сообщение о том, какой предмет снимается

``` showLineNumbers
{
    "inventory_id": "{INVENTORY_UUID}",
    "item": "{ITEM_UUID}"
}
```

Слот, в который надевается предмет зависит от слота, указанного в предмете. Если слот был свободен, то система возвращает успешное сообщение:

``` showLineNumbers
{
	"result": "Предмет {ITEM_UUID} успешно экипирован"
}
```

Если слот был занят, при replace=false возвращается сообщение:

``` showLineNumbers
{
	"result": "Слот занят предметом 3ea27d6c-5a12-48f2-953a-0b955de6e673, если вы хотите заменить его, повторите запрос с replace=true"
}
```

И в случае replace=true предмет, находящийся в нём снимается при  и надевается предмет из запроса. Система возвращает следующее сообщение

``` showLineNumbers
{
	"result": "Предмет {ITEM_UUID} успешно экипирован. Предмет 3ea27d6c-5a12-48f2-953a-0b955de6e673 снят и перемещён в рюкзак"
}
```

{% endcut %}

{% cut "POST /api/v4/items-inventory/unequip" %}

``` showLineNumbers
{
    "inventory_id": "{INVENTORY_UUID}",
    "item": "{ITEM_UUID}"
}
```

Слот, из которого снимается предмет зависит от слота, указанного в предмете. Если слот был свободен, то система возвращает такое сообщение:

``` showLineNumbers
{
	"result": "В слоте {slot_name} ничего не надето"
}
```

Если слот был занят,  возвращается успешное сообщение:

``` showLineNumbers
{
	"result": "Предмет {ITEM_UUID} снят и перемещён в рюкзак"
}
```

{% endcut %}

Когда предмет надевается/снимается, соответствующие привязанные к нему эффекты начинают/прекращают действовать и добавляются/удаляются из инвентаря эффектов.

#### Время

Во внебоевых ситуациях игроки действуют независимо и могут переключать ходы внутри своих листов персонажей

{% cut "POST /api/v4/next\_turn?id=\{character\_id\}" %}

Если сейчас не идёт бой с участием игрока, ход переключается и игрок восстанавливает все ресурсы и действия с перезарядкой "per\_turn"

Response: 200 OK

Если бой идёт, отправляется ошибка (прямо сейчас систему боя не будем прорабатывать, описываю на будущее)

``` showLineNumbers
400 Bad Request
{
	"error": "Идёт бой, и сейчас не ваш ход"
}
```

{% endcut %}

{% cut "POST /api/v4/short\_rest?id=\{character\_id\}" %}

Если персонаж не состоит в группе, то получает все преимущества короткого отдыха - восстанавливает все ресурсы и действия с перезарядкой "per\_turn" и "per\_short\_rest".

Response: 200 OK

Если он состоит в группе - отправляется уведомление остальным участникам группы о предложении короткого отдыха. Если все согласны, совершается короткий отдых и все персонажи группы получают все преимущества короткого отдыха

{% endcut %}

{% cut "POST /api/v4/long\_rest?id=\{character\_id\}" %}

Работает аналогично с short\_rest, но восстанавливает также ресурсы и способности "per\_long\_rest"

{% endcut %}

#### Действия

{% cut "GET /api/v4/actions-inventory/get?id=\{inventory\_id\}" %}

``` showLineNumbers
{
    "actions_inventory": [
        {
            "name": "action_dash", // название действия
            "is_used": false, // использовано ли действие
            "reload": "per_turn" // перезарядка
        },
        {
            "name": "action_throw",
            "is_used": false,
            "reload": "per_turn"
        },
        {
            "name": "action_shove",
            "is_used": false,
            "reload": "per_turn"
        },
        {
            "name": "action_jump",
            "is_used": false,
            "reload": "per_turn"
        },
        {
            "name": "action_unarmed_strike",
            "is_used": false,
            "reload": "per_turn"
        },          
        {
            "name": "action_melee_attack",
            "is_used": false,
            "reload": "per_turn"
        },
        {
            "name": "action_ranged_attack",
            "is_used": false,
            "reload": "per_turn"
        },
        {
            "name": "action_improvise",
            "is_used": false,
            "reload": "per_turn"
        }
        {
            "name": "action_barbarian_rage_2",
            "is_used": true,
            "reload": "per_long_rest"
        }
    ],
}
```

{% endcut %}

{% cut "POST /api/v4/actions/execute?id=\{character\_id\}" %}

``` showLineNumbers
{
	"action_name": "action_dash", // название действия
	"target": "{ENTITY_ID}", // цель действия (необязательно)
	"targets": [ // цели действия, если их несколько (необязательно)
		"{ENTITY_ID}"
	]
}
```

Ручка валидирует выполнение действия:

- Проверяет, есть ли в инвентаре действий персонажа запрашиваемое действие
- Проверяет, доступно ли запрашиваемое действие (хватает ли ресурсов, не находится ли оно на перезарядке)
- Проверяет, существуют и доступны ли цели действия

Если всё в норме, то выполняет действие и возвращает ответ:

``` showLineNumbers
{
	"result": "Действие action_dash выполнено"
}
```

Если нет, то возвращает расшифровку ответа

``` showLineNumbers
{
	"error": "Не хватает ресурсов main_action"
}
```

{% endcut %}

&nbsp;

