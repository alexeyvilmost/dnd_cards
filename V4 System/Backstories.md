### Предыстория

Получим список доступных предысторий:

``` showLineNumbers
GET /api/v4/backstories

[
	{
		"name": "Artist",
		"russian_name": "Артист",
		"description": "...",
		"backstory_id": "{ARTIST_UUID}"
	},
	{
		"name": "Solider",
		"russian_name": "Солдат",
		"description": "...",
		"backstory_id": "{SOLIDER_UUID}"
	}
]
```

Можно получить отдельную предысторию

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

&nbsp;

