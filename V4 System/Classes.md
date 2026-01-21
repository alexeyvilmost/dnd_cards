### Классы

Получим список доступных классов:

``` showLineNumbers
GET /api/v4/classes

[
	{
		"name": "Barbarian",
		"russian_name": "Варвар",
		"description": "...",
		"class_id": "{BARBARIAN_UUID}"
	},
	{
		"name": "Fighter",
		"russian_name": "Боец",
		"description": "...",
		"class_id": "{FIGHTER_UUID}"
	},
	{
		"name": "Paladin",
		"russian_name": "Паладин",
		"description": "...",
		"class_id": "{PALADIN_UUID}"
	}
]
```

Можем получить информацию по отдельному классу:

``` showLineNumbers
GET /api/v4/classes/class_id={CLASS_UUID}&level=1&type="only" // type = "only" | "additive"

{
	"name": "Barbarian",
	"russian_name": "Варвар",
	"description": "...",
	"class_id": "{BARBARIAN_UUID}",
	"proficiencies": [
		"armor": [
			"light_armor",
			"medium_armor",
			"shields"
		],
		"weapons": [
			"simple",
			"martial"
		],
		"saving_throws": [
			"strength",
			"constitution"
		],
		"skills_choice": {
			"count": 2,
			"variants": [
				"athletics",
				"intimidation",
				"survival",
				"nature",
				"animal_handling",
				"perception"
			]
		}
	],
	"equipment": [
        "c830dce3-33d3-4514-8bf5-670fa0e299f2",
        "9515fd6f-7478-4363-affa-14bc0e3a4e36",
        "012ed1f7-3a48-4772-853d-a69cca6d0060",
        "012ed1f7-3a48-4772-853d-a69cca6d0060",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673"
    ],
	"effects": [
		"effect_unarmored_defense"
	],
	"actions": [
		"action_barbarian_rage_2"
	],
	"recommended_attributes": {
		"strength": 15,
		"constitution": 14,
		"dexterity": 13,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"resources": {
		"rage_charges": 2
	},
	"max_resources": {
		"rage_charges": 2
	}
}
```

Можем также получить информацию по следующему уровню класса:

``` showLineNumbers
GET /api/v4/classes/class_id={CLASS_UUID}&level=2&type="only" // type = "only" | "additive"

{
	"name": "Barbarian",
	"russian_name": "Варвар",
	"description": "...",
	"class_id": "{BARBARIAN_UUID}",
	"actions": [
		"action_reckless_attack"
	],
	"effects": [
		"effect_danger_sense"
	]
}
```

Либо, можно получить все преимущества, если использовать type="additive":

``` showLineNumbers
GET /api/v4/classes/class_id={CLASS_UUID}&level=2&type="additive" // type = "only" | "additive"

{
	"name": "Barbarian",
	"russian_name": "Варвар",
	"description": "...",
	"class_id": "{BARBARIAN_UUID}",
	"proficiencies": [
		"armor": [
			"light_armor",
			"medium_armor",
			"shields"
		],
		"weapons": [
			"simple",
			"martial"
		],
		"saving_throws": [
			"strength",
			"constitution"
		],
		"skills_choice": {
			"count": 2,
			"variants": [
				"athletics",
				"intimidation",
				"survival",
				"nature",
				"animal_handling",
				"perception"
			]
		}
	],
	"equipment": [
        "c830dce3-33d3-4514-8bf5-670fa0e299f2",
        "9515fd6f-7478-4363-affa-14bc0e3a4e36",
        "012ed1f7-3a48-4772-853d-a69cca6d0060",
        "012ed1f7-3a48-4772-853d-a69cca6d0060",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673",
        "3ea27d6c-5a12-48f2-953a-0b955de6e673"
    ],
	"effects": [
		"effect_unarmored_defense",
		"effect_danger_sense"
	],
	"actions": [
		"action_barbarian_rage_2",
		"action_reckless_attack"
	],
	"recommended_attributes": {
		"strength": 15,
		"constitution": 14,
		"dexterity": 13,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"resources": {
		"rage_charges": 2
	},
	"max_resources": {
		"rage_charges": 2
	}
}
```