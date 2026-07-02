package migrations

import (
	"database/sql"
	"fmt"
)

// seedMvpEquipmentCards — тестовые предметы для проверки инвентаря (фаза C).
func seedMvpEquipmentCards(db *sql.DB) error {
	queries := []string{
		`INSERT INTO cards (
			name, description, card_number, rarity, author, type, slot, weight,
			bonus_type, bonus_value, damage_type, properties, is_template
		) VALUES (
			'Длинный меч', 'Тестовое оружие для MVP-инвентаря.', 'MVP-LONGSWORD', 'common', 'Admin',
			'weapon', 'one_hand', 1.5,
			'damage', '1d8', 'slashing', ARRAY['versatile']::text[], 'false'
		) ON CONFLICT (card_number) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			type = EXCLUDED.type,
			slot = EXCLUDED.slot,
			weight = EXCLUDED.weight,
			bonus_type = EXCLUDED.bonus_type,
			bonus_value = EXCLUDED.bonus_value,
			damage_type = EXCLUDED.damage_type,
			properties = EXCLUDED.properties,
			is_template = EXCLUDED.is_template,
			updated_at = NOW()`,
		`INSERT INTO cards (
			name, description, card_number, rarity, author, type, slot, weight,
			bonus_type, bonus_value, defense_type, is_template
		) VALUES (
			'Щит', 'Тестовый щит для MVP-инвентаря.', 'MVP-SHIELD', 'common', 'Admin',
			'shield', 'one_hand', 3,
			'defense', '+2', 'shield', 'false'
		) ON CONFLICT (card_number) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			type = EXCLUDED.type,
			slot = EXCLUDED.slot,
			weight = EXCLUDED.weight,
			bonus_type = EXCLUDED.bonus_type,
			bonus_value = EXCLUDED.bonus_value,
			defense_type = EXCLUDED.defense_type,
			is_template = EXCLUDED.is_template,
			updated_at = NOW()`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("seedMvpEquipmentCards: %w", err)
		}
	}
	return nil
}
