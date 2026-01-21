Система персонажей V4:

Отличие от предыдущих систем - всё, связанное с персонажем происходит на бекенде и валидируется на бекенде.

Разберемся с созданием персонажа. Персонаж состоит из 4 главных категорий: Класс, Раса, Предыстория и остальное.

Первые три разобраны в отдельных статьях, как по итогу выглядит создание персонажа:

``` showLineNumbers
POST /api/v4/characters/create

{
	"name": "Oleg",
	"race": "{SUBRACE_UUID}",
	"classes": [
		{
			"class": "{CLASS_UUID}",
			"subclass": "{SUBCLASS_UUID}",
			"level": 1
		},
	],
	"backstory": "{BACKSTORY_UUID}",
	"abilities": {
		"strength": 16,
		"dexterity": 14,
		"constitution": 13,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"class": {
		"chosen_skills": [
			"acrobatics",
			"performance"
		],
	}
}
```

Получение персонажа из бекенда:

```
GET /api/characters-v4/{character_id}
{
    "id": "3b352707-d200-4bd7-927c-ef449c725fa8",
    "user_id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a",
    "group_id": null,
    "name": "Люцис",
    "race": "Полуорк",
	"background": "Артист",
	"levels": {
		"level": 1,
		"xp": 0,
		"classes": [
			{
				"class_name": "Варвар",
				"class_level": 1
			}
		]
	},
    "abilities": {
		"strength": 17,
		"dexterity": 13,
		"constitution": 15,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
    "speed": 30,
    "max_hp": 14,
    "current_hp": 14,
	"hit_dices": {
		"1d12": 1
	},
	"proficiencies": {
		"saving_throws": [
    		"strength",
    		"constitution"
		],
		"skills": [
        	"athletics",
			"intimidation",
			"survival",
			"nature"
		],
		"armor": [
			"light",
			"shields"
		],
		"weapon": [
			"simple",
			"battleaxe"
		],
		"languages": [
			"common",
			"orc"
		],
		"tools": []
	},
	"inventories": {
		"items": "{ITEM_INVENTORY_UUID}",
		"actions": "{ACTION_INVENTORY_UUID}",	
		"spells": "{SPELL_INVENTORY_UUID}",
		"effects": "{EFFECT_INVENTORY_UUID}",
		"resources": "{RESOURCE_INVENTORY_UUID}",
		"abilities": "{ABILITY_INVENTORY_UUID}"
	},
    "created_at": "2025-11-24T23:22:51.055976Z",
    "updated_at": "2025-11-24T23:22:51.055976Z",
    "user": {
        "id": "a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a",
        "username": "testuser",
        "email": "test@example.com",
        "display_name": "Тестовый пользователь",
        "created_at": "2025-09-06T10:02:18.901474Z",
        "updated_at": "2025-09-06T10:02:18.901474Z"
    },
    "group": null
}
```