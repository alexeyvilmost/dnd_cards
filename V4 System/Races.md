### Раса

Получим список доступных рас:

``` showLineNumbers
GET /api/v4/races

[
	{
		"name": "Dwarf",
		"russian_name": "Дварф",
		"description": "...",
		"subraces": [
			{
				"name": "Dwarf_Hill",
				"russian_name": "Холмовой дварф",
				"description": "...",
				"race_id": "{DWARF_HILL_UUID}"
			},
			{
				"name": "Dwarf_Mountain",
				"russian_name": "Горный дварф",
				"description": "...",
				"race_id": "{DWARF_MOUNTAIN_UUID}"
			}
		],
		"race_id": "{DWARF_UUID}"
	},
	{
		"name": "Human",
		"russian_name": "Человек",
		"description": "...",
		"race_id": "{HUMAN_UUID}"
	},
	{
		"name": "Elf",
		"russian_name": "Эльф",
		"description": "...",
		"subraces": [
			{
				"name": "Elf_Wood",
				"russian_name": "Лесной эльф",
				"description": "...",
				"race_id": "{ELF_WOOD_UUID}"
			},
			{
				"name": "Elf_Drow",
				"russian_name": "Тёмный эльф (Дроу)",
				"description": "...",
				"race_id": "{ELF_DROW_UUID}"
			}
		],
		"race_id": "{ELF_UUID}"
	}
]
```

Можно получить отдельную расу

``` showLineNumbers
GET /api/v4/races/race_id={RACE_UUID}

{
	"name": "dwarf",
	"russian_name": "Дварф",
	"description": "...",
	"race_id": "{DWARF_UUID}",
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
		"effect_dwarven_stonecunning"
	],
	"subraces": [
		{
			"name": "hill_dwarf",
			"russian_name": "Холмовой дварф",
			"description": "...",
			"race_id": "{DWARF_HILL_UUID}",
			"effects": [
				"effect_dwarven_toughness"
			]
			"abilities_increase": [
				"constitution": 2,
				"wisdom": 1,
			]
		},
		{
			"name": "mountain_dwarf",
			"russian_name": "Горный дварф",
			"description": "...",
			"race_id": "{DWARF_MOUNTAIN_UUID}",
			"effects": [
				"effect_dwarven_training"
			]
			"abilities_increase": [
				"constitution": 2,
				"strength": 2,
			]
		}
	]
}
```

Или сразу подрасу:

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
	"abilities_increase": [
		"constitution": 2,
		"wisdom": 1,
	],
}
```