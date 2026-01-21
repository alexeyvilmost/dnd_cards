В инвентаре эффектов содержатся пассивные и активные эффекты, влияющие на персонажа временно или постоянно.

Эффекты глобально подразделяются на две категории:

- Постоянные (pure) эффекты - эти эффекты неотделимы от персонажа и их влияние (если возможно) уже внесено в само тело персонажа
- Временные (temp) эффекты - эти эффекты даруются аурами, предметами, и прочими источниками, которые могут исчезнуть. Такие эффекты не вносятся в тело персонажа, но рассчитываются по запросу.

Пример постоянного эффекта effect\_dwarven\_training - Дварфийская подготовка, которая даёт владение лёгкими и средними доспехами.

``` showLineNumbers
GET /api/v4/effects?name="effect_dwarven_training"

{
	"name": "effect_dwarven_training",
	"russian_name": "Владение доспехами дварфов",
	"description": "Вы владеете лёгкими и средними доспехами.",
	"effect_duration": "pure",
	"effect_activeness": "passive",
    "effect_source": "race",
    "effect_source_id": "{MOUNTAIN_DWARF_UUID}",
	"effect_target": "self",
	"effect_type": "proficiency",
	"proficiencies": {
		"armor": [
			"light_armor",
			"medium_armor"
		]
	}
}
```

Такой эффект при добавлении в персонажа сразу же записывается в его владения и больше никогда не снимается ни в каком случае.

Пример аналогичного эффекта, даруемого пока владелец носит соответствующий доспех:

``` showLineNumbers
GET /api/v4/effects?name="effect_dwarven_training_armor"

{
	"name": "effect_dwarven_training_armor",
	"russian_name": "Владение доспехами дварфов",
	"description": "Вы владеете лёгкими и средними доспехами.",
	"effect_duration": "temporary",
	"effect_source": "item",
	"effect_source_id": "{ITEM_UUID}",
	"conditions": [
		{
			"type": "equipement_condition",
			"value": "while_equipped"
		}
	]
	"effect_activeness": "passive",
	"effect_target": "self",
	"effect_type": "proficiency",
	"proficiencies": {
		"armor": [
			"light_armor",
			"medium_armor"
		]
	}
}
```

Кроме пассивных эффектов есть активные - они применяются в соответсвующих условиях. Вот лишь некоторые из них:

- При получении урона
- При промахе оружием
- Перед броском атаки
- После броска атаки
- и т.д.

Этот сегмент эффектов пока прорабатывается, но нужно иметь ввиду наличие таких в будущем.

Ярким представителем такого эффекта будет effect\_reckless\_attack - безрассудная атака Варвара, позволяющая получить преимущество на броски атаки, перед первым ударом в бою:

``` showLineNumbers
GET /api/v4/effects?name="effect_reckless_attack"

{
	"name": "effect_reckless_attack",
	"russian_name": "Безрассудный удар",
	"description": "Перед атакой вы можете решить сделать её с преимуществом. В этом случае удары по вам до начала вашего хода также будут с преимуществом",
	"effect_duration": "pure",
	"effect_source": "class",
	"effect_source_id": "{BARBARIAN_UUID}",
	"trigger": "before_attack",
	"trigger_description": "Перед атакой вы можете решить сделать её с преимуществом. В этом случае удары по вам до начала вашего хода также будут с преимуществом",
	"trigger_conditions": [
		{
			"condition_type": "attack_range",
			"operator": "==",
			"value": "melee"
		},
		{
			"condition_type": "user_choice",
			"operator": "==",
			"value": "true"
		}
	],
	"trigger_effects": [
		{
			"effect_type": "grant_effect",
			"effect_name": "effect_reckless_attack_advantage",
		},
		{
			"effect_type": "grant_effect",
			"effect_name": "effect_reckless_attack_disadvantage",
		}
	]
	"effect_activeness": "active",
	"effect_target": "self",
	"effect_type": "proficiency",
	"proficiencies": {
		"armor": [
			"light_armor",
			"medium_armor"
		]
	}
}

{
	"name": "effect_reckless_attack_advantage",
	"russian_name": "Преимущество безрассудного удара",
	"effect_duration": "temporary",
	"effect_source": "effect",
	"effect_source_id": "effect_reckless_attack",
	"duration": "until_start_of_turn",
	conditions: [
		{
			"condition_type": "attack_range",
			"operator": "==",
			"value": "melee"
		}
	]
	"effects": [
		{
			"effect_type": "attack_modifier",
			"value": "advantage",
			"target": "self",
		}
	]
}

{
	"name": "effect_reckless_attack_disadvantage",
	"russian_name": "Недостаток безрассудного удара",
	"effect_duration": "temporary",
	"effect_source": "effect",
	"effect_source_id": "effect_reckless_attack",
	"duration": "until_start_of_turn",
	"effects": [
		{
			"effect_type": "attack_against_target_modifier",
			"value": "advantage",
		}
	]
}
```

(Дополняется, структура приведена примерная)