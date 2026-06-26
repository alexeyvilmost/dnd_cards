Следующие атрибуты обязательно присутствуют у любого персонажа, вне зависимости от того, игровой он или НИП:
```
{
	"name": "Имя",
	"hits": {
		"total": int,
		"current": int,
		"temporary": int,
		"hit_dices": [ // non-required
			{
				"dice_type": "1d8",
				"dice_amount": 3
			}
		]
	},
	"attributes": {
		"strength": {
			"base": 15,
			
		}
	}
	
}
```