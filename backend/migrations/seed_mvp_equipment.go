package migrations

import (
	"database/sql"
	"fmt"
)

// seedMvpEquipmentCards — тестовые предметы для проверки инвентаря (фаза C).
func seedMvpEquipmentCards(db *sql.DB) error {
	if err := deduplicateCardsByCardNumber(db); err != nil {
		return fmt.Errorf("seedMvpEquipmentCards: deduplicate card_number: %w", err)
	}

	if _, err := db.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_card_number_unique ON cards (card_number)
	`); err != nil {
		return fmt.Errorf("seedMvpEquipmentCards: ensure card_number unique index: %w", err)
	}

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
			bonus_type, bonus_value, is_template
		) VALUES (
			'Щит', 'Тестовый щит для MVP-инвентаря.', 'MVP-SHIELD', 'common', 'Admin',
			'shield', 'one_hand', 3,
			'defense', '+2', 'false'
		) ON CONFLICT (card_number) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			type = EXCLUDED.type,
			slot = EXCLUDED.slot,
			weight = EXCLUDED.weight,
			bonus_type = EXCLUDED.bonus_type,
			bonus_value = EXCLUDED.bonus_value,
			defense_type = NULL,
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

// deduplicateCardsByCardNumber удаляет дубликаты card_number, оставляя одну строку:
// активную (deleted_at IS NULL) с самым свежим updated_at, иначе самую новую по id.
func deduplicateCardsByCardNumber(db *sql.DB) error {
	_, err := db.Exec(`
		WITH ranked AS (
			SELECT
				id,
				ROW_NUMBER() OVER (
					PARTITION BY card_number
					ORDER BY
						(deleted_at IS NULL) DESC,
						updated_at DESC,
						created_at DESC,
						id::text ASC
				) AS rn
			FROM cards
		)
		DELETE FROM cards
		WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
	`)
	return err
}
