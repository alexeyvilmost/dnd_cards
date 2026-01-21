Рассмотрим работу систему, начиная с создания персонажа.

Рассмотрим на основе Дварфа Варвара Олег с предысторией Артист и внимательно рассмотрим его путь.

``` showLineNumbers
POST /api/v4/characters/create

{
	"name": "Oleg",
	"race": "{DWARF_HILL_UUID}",
	"classes": [
		{
			"class": "{BARBARIAN_UUID}",
			"level": 1
		},
	],
	"backstory": "{ARTIST_UUID}",
	"attributes": {
		"strength": 15,
		"dexterity": 14,
		"constitution": 13,
		"intelligence": 8,
		"wisdom": 12,
		"charisma": 10
	},
	"class": {
		"chosen_skills": [
			"athletics",
			"survival"
		],
	}
}
```

Разберем отдельные компоненты - Класс "Варвар":

``` showLineNumbers
GET /api/v4/classes/class_id={BARBARIAN_UUID}&level=1&type="only"

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

Раса Холмовой Дварф:

``` showLineNumbers
GET /api/v4/races/subrace_id={SUBRACE_UUID}

{
	"race_name": "dwarf",
	"subrace_name": "hill_dwarf",
	"russian_name": "Холмовой дварф",
	"description": "...",
	"race_id": "{DWARF_UUID}",
	"subrace_id": "{DWARF_HILL_UUID}",
	"proficiencies": [
		"languages": [
			"common",
			"dwarvish"
		]
	],
	"speed": 25,
	"age": {
		"adult": 50,
		"elder": 150,
		"max": 360
	},
	"size": "medium",
	"effects": [
		"effect_darkvision_60",
		"effect_dwarven_resistance",
		"effect_dwarven_tools",
		"effect_dwarven_stonecunning",
		"effect_dwarven_toughness"
	],
	"attributes_increase": [
		"constitution": 2,
		"wisdom": 1,
	],
}
```

Предыстория Артист:

``` showLineNumbers
GET /api/v4/backstories/backstory_id={BACKSTORY_UUID}

{
	"name": "Artist",
	"russian_name": "Артист",
	"description": "...",
	"backstory_id": "{ARTIST_UUID}",
	"proficiencies": {
		"skills": [
			"acrobatics",
			"performance"
		],
		"tools": [
			"disguise_kit",
			"musical_instrument"
		],
		"equipment": [
			"22542ad6-4f5b-4ef0-a386-b5c9bade4484",
			"6c0a019b-a864-4371-acac-cbbcc391af1e",
			"19a77e19-b830-498e-9d69-f3678c0fb9a4"
		]
	},
	"effects": [
		"effect_artist_backstory"
	],
	"gold": 15
}
```

Теперь разберемся, как из этого создаётся персонаж:

1. Записываем в соответствующие поля Класс, Расу и Предысторию, а также уровень, указанный при создании:

   ``` showLineNumbers
   "race": "hill_dwarf",
   "race_id": "{DWARF_HILL_UUID}"
   "backstory": "artist",
   "backstory_id": "{ARTIST_UUID}"
   "levels": {
   	"level": 1,
   	"xp": 0,
   	"classes": [
   		{
   			"class": "barbarian",
   			"class_id": "{BARBARIAN_ID}",
   			"levels": 1
   		}
   	]
   }
   ```

2. Записываем все владения, которые получил персонаж (перед этим валидируя, что пользователь выбрал доступные навыки из класса):

   ``` showLineNumbers
   "proficiencies": {
   	"armor": [
   		"light_armor", // class: barbarian
   		"medium_armor", // class: barbarian
   		"shields", // class: barbarian
   	],
   	"weapons": [
   		"simple", // class: barbarian
   		"martial", // class: barbarian
   	],
   	"saving_throws": [
   		"strength", // class: barbarian
   		"constitution", // class: barbarian
   	],
   	"skills": [
   		"athletics", // class: barbarian
   		"survival", // class: barbarian
   		"acrobatics", // backstory: artist
   		"performance", // backstory: artist
   	],
   	"languages": [
   		"common", // race: hill_dwarf
   		"dwarvish", // race: hill_dwarf
   	],
   	"tools": [
   		"disguise_kit", // backstory: artist
   		"musical_instrument", // backstory: artist
   	]
   }
   ```

3. Складываем характеристики от расы и выбранные пользователем (перед этим валидируя, что пользователь не выбрал больше положенного)

   ``` showLineNumbers
   "attributes": {
   	"strength": 15,
   	"dexterity": 14,
   	"constitution": 15,
   	"intelligence": 8,
   	"wisdom": 13,
   	"charisma": 10
   }
   ```

4. Теперь складываем все эффекты и доступные действия, предметы, золото и ресурсы, создаём для новосозданного персонажа инвентари. Обязательные:
   \- items - для предметов и валюты
   \- actions - для действий
   \- effects - для эффектов
   \- resources - для ресурсов (подробнее в "Инвентари")

   ``` showLineNumbers
   "effects": [
   	"effect_unarmored_defense",
   	"effect_darkvision_60",
   	"effect_dwarven_resistance",
   	"effect_dwarven_tools",
   	"effect_dwarven_stonecunning",
   	"effect_dwarven_toughness",
   	"effect_artist_backstory"
   ],
   "actions": [
   	"action_barbarian_rage_2"
   ],
   "items": {
   	"gold": 15,
   	"equipment": [
   		"22542ad6-4f5b-4ef0-a386-b5c9bade4484",
   		"6c0a019b-a864-4371-acac-cbbcc391af1e",
   		"19a77e19-b830-498e-9d69-f3678c0fb9a4",
   		"c830dce3-33d3-4514-8bf5-670fa0e299f2",
           "9515fd6f-7478-4363-affa-14bc0e3a4e36",
           "012ed1f7-3a48-4772-853d-a69cca6d0060",
           "012ed1f7-3a48-4772-853d-a69cca6d0060",
           "3ea27d6c-5a12-48f2-953a-0b955de6e673",
           "3ea27d6c-5a12-48f2-953a-0b955de6e673",
           "3ea27d6c-5a12-48f2-953a-0b955de6e673",
           "3ea27d6c-5a12-48f2-953a-0b955de6e673"
   	]
   },
   "resources": {
   	"rage_charges": 2,
   }
   ```

5. Высчитываем и сохраняем для персонажа остальные параметры: его КД, скорость, размер, грузоподъемность, бонус мастерства (подробнее о расчётах в "Прочие атрибуты персонажа")

Мы создали базовый скелет персонажа. Теперь его нужно обновить. Эффекты разделяются на два вида: pure и temporary, соответственно вечные и временные:
Вечные эффекты сразу же врастают в характеристики персонажа - так как они неотменяемые, их можно сразу вписать.

&nbsp;

&nbsp;

