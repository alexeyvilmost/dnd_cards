&nbsp;

Эффекты на примере боевых стилей

### Боевые стили

{% cut "**Дуэлянт**" %}

Пока вы держите рукопашное оружие в одной руке и не используете другого оружия, вы получаете бонус \+2 к броскам урона этим оружием.

``` showLineNumbers
GET /api/v4/effects?name="fighting_style_duelist"

{
	"name": "fighting_style_duelist",
	"russian_name": "Боевой стиль: Дуэлянт",
	"description": "Пока вы держите рукопашное оружие в одной руке и не используете другого оружия, вы получаете бонус +2 к броскам урона этим оружием",
	"effect_duration": "temp", // pure | temp ... В данном случае - временный эффект, исчезающий через время
	"duration_type": "until_dispelled",
	"effect_activeness": "passive",
    "effect_source": "class", // race | class | item | backstory | environment  ... В данном случае - от расы
    "effect_source_id": "{FIGHTER_UUID}",
	"effect_target": "self",
	"effect_type": "damage_roll_modifier",
	"conditions": [
        {
            "name": "and",
            "conditions_and": [
                {
                    "name": "attack_type",
                    "value": "melee",
                    "operator": "==",
                },
                {
                    "name": "or",
                    "conditions_or": [
                        {
                            "name": "left_hand_item_type",
                            "value": "none",
                        },
                        {
                            "name": "left_hand_item_type",
                            "value": "shield",
                        }
                    ]
                }
            ]
        }
	],
	"modifier_type": "add",
    "modifier": "+2"
}
```

{% endcut %}

{% cut "**Оборона**" %}

Пока вы носите доспехи, вы получаете бонус \+1 к КД.

``` showLineNumbers
GET /api/v4/effects?name="fighting_style_defensive"

{
	"name": "fighting_style_defensive",
	"russian_name": "Боевой стиль: Оборона",
	"description": "Пока вы носите доспехи, вы получаете бонус +1 к КД.",
	"effect_duration": "temp", // pure | temp ... В данном случае - временный эффект, исчезающий через время
	"duration_type": "until_dispelled",
	"effect_activeness": "passive",
    "effect_source": "class", // race | class | item | backstory | environment  ... В данном случае - от расы
    "effect_source_id": "{FIGHTER_UUID}",
	"effect_target": "self",
	"effect_type": "armor_class_modifier",
	"conditions": [
        {
            "name": "armor_type",
            "value": "none",
            "operator": "!=",
        }
	],
	"modifier_type": "add",
    "modifier": "+1"
}
```

{% endcut %}

{% cut "Сражение большим оружием" %}

Если у вас выпало «1» или «2» на кости урона при атаке, которую вы совершали рукопашным оружием, удерживая его двумя руками, то вы можете перебросить эту кость, и должны использовать новый результат, даже если снова выпало «1» или «2». Чтобы воспользоваться этим преимуществом, ваше оружие должно иметь свойство «**двуручное**» или «**универсальное**».

``` showLineNumbers
GET /api/v4/effects?name="fighting_style_great_weapon_fighting"

{
	"name": "fighting_style_great_weapon_fighting",
	"russian_name": "Боевой стиль: Сражение большим оружием",
	"description": "Если у вас выпало «1» или «2» на кости урона при атаке, которую вы совершали рукопашным оружием, удерживая его двумя руками, то вы можете перебросить эту кость, и должны использовать новый результат, даже если снова выпало «1» или «2». Чтобы воспользоваться этим преимуществом, ваше оружие должно иметь свойство «двуручное» или «универсальное».",
	"effect_duration": "temp", // pure | temp ... В данном случае - временный эффект, исчезающий через время
	"duration_type": "until_dispelled",
	"effect_activeness": "passive",
    "effect_source": "class", // race | class | item | backstory | environment  ... В данном случае - от расы
    "effect_source_id": "{FIGHTER_UUID}",
	"effect_target": "self",
	"effect_type": "damage_roll_modifier",
	"conditions": [
        {
            "name": "or",
            "conditions_or": [
                {
                    "name": "right_hand_item_properties",
                    "operator": "contains",
                    "value": "two-handed"
                },
                {
                    "name": "and",
                    "conditions_and": [
                        {
                            "name": "right_hand_item_properties",
                            "operator": "contains",
                            "value": "versatile"
                        },
                        {
                            "name": "left_hand_item_properties",
                            "operator": "contains",
                            "value": "versatile"
                        }
                    ]
                }
			]
        }
	],
	"modifier_type": "reroll",
    "reroll": {
        "reroll_count": 1,
        "reroll_results": [1, 2]
    }
}
```

{% endcut %}

{% cut "Сражение двумя оружиями" %}

Если вы сражаетесь двумя оружиями, вы можете добавить модификатор характеристики к урону от второй атаки.

``` showLineNumbers
GET /api/v4/effects?name="fighting_style_dual_wielding"

{
	"name": "fighting_style_dual_wielding",
	"russian_name": "Боевой стиль: Сражение двумя оружиями",
	"description": "Если вы сражаетесь двумя оружиями, вы можете добавить модификатор характеристики к урону от второй атаки.",
	"effect_duration": "temp", // pure | temp ... В данном случае - временный эффект, исчезающий через время
	"duration_type": "until_dispelled",
	"effect_activeness": "passive",
    "effect_source": "class", // race | class | item | backstory | environment  ... В данном случае - от расы
    "effect_source_id": "{FIGHTER_UUID}",
	"effect_target": "self",
	"effect_type": "damage_roll_modifier",
	"conditions": [
        {
            "name": "and",
            "conditions_and": [
                {
                    "name": "or",
                    "conditions_or": [
                        {
                            "name": "and",
                            "conditions_and": [
                                {
                                    "name": "comparison",
                                    "value_1": "left_hand_item_id",
                                    "operator": "!=",
                                    "value_2": "right_hand_item_id"
                                },
                                {
                                    "name": "left_hand_item_type",
                                    "operator": "!=",
                                    "value": "shield"
                                }
                            ],
                        },
                        {
                            "name": "and",
                            "conditions_and": [
                                {
                                    "name": "comparison",
                                    "value_1": "right_hand_item_id",
                                    "operator": "==",
                                    "value_2": "left_hand_item_id"
                                },
                                {
                                    "value": "left_hand_item_properties",
                                    "operator": "not_contains",
                                    "value": "two-handed,versatile"
                                },
                                {
                                    "value": "right_hand_item_properties",
                                    "operator": "not_contains",
                                    "value": "two-handed,versatile"
                                },
                            ]
                        }
                    ]
                },
                {
                    "name": "action_name",
                    "value": "action_offhand_attack",
                    "operator": "=="
                }
            ]
        }
	],
	"modifier_type": "add",
    "modifier": "{ATTACK_ATTRIBUTE_MODIFIER}",
}
```

{% endcut %}

{% cut "Стрельба" %}

Вы получаете бонус \+2 к броску атаки, когда атакуете дальнобойным оружием.

```json showLineNumbers
GET /api/v4/effects?name="fighting_style_archery"

{
	"name": "fighting_style_archery",
	"russian_name": "Боевой стиль: Стрельба",
	"description": "Вы получаете бонус +2 к броску атаки, когда атакуете дальнобойным оружием.",
	"effect_duration": "temp", // pure | temp ... В данном случае - временный эффект, исчезающий через время
	"duration_type": "until_dispelled",
	"effect_activeness": "passive",
    "effect_source": "class", // race | class | item | backstory | environment  ... В данном случае - от расы
    "effect_source_id": "{FIGHTER_UUID}",
	"effect_target": "self",
	"effect_type": "attack_roll_modifier",
	"conditions": [
        {
            "name": "attack_range",
            "operator": "==",
            "value": "ranged"
        }
	],
	"modifier_type": "add",
    "modifier": "+2",
}
```

{% endcut %}