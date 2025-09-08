package migrations

import (
	"database/sql"
	"fmt"
)

// GetAllMigrations возвращает все миграции в порядке выполнения
func GetAllMigrations() []Migration {
	return []Migration{
		{
			Version:     "001_create_image_library",
			Description: "Create image_library table",
			Up:          createImageLibraryTable,
			Down:        dropImageLibraryTable,
		},
		{
			Version:     "002_add_extended_fields",
			Description: "Add extended fields to cards and weapon_templates",
			Up:          addExtendedFields,
			Down:        removeExtendedFields,
		},
		{
			Version:     "003_add_armor_support",
			Description: "Add armor support to weapon_templates table",
			Up:          addArmorSupport,
			Down:        removeArmorSupport,
		},
		{
			Version:     "004_add_is_template_field",
			Description: "Add is_template field to cards table",
			Up:          addIsTemplateField,
			Down:        removeIsTemplateField,
		},
		{
			Version:     "005_remove_weapon_templates_table",
			Description: "Remove weapon_templates table as templates are now handled by cards table",
			Up:          removeWeaponTemplatesTable,
			Down:        restoreWeaponTemplatesTable,
		},
		{
			Version:     "006_add_detailed_description",
			Description: "Add detailed_description field to cards table",
			Up:          addDetailedDescriptionField,
			Down:        removeDetailedDescriptionField,
		},
		// Здесь можно добавлять новые миграции
	}
}

// createImageLibraryTable создает таблицу библиотеки изображений
func createImageLibraryTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS image_library (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			cloudinary_id VARCHAR(255) NOT NULL UNIQUE,
			cloudinary_url TEXT NOT NULL,
			original_name VARCHAR(255),
			file_size INTEGER,
			card_name VARCHAR(255),
			card_rarity VARCHAR(50),
			generation_prompt TEXT,
			generation_model VARCHAR(100),
			generation_time_ms INTEGER,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)
	`

	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create image_library table: %w", err)
	}

	// Создаем индексы
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_image_library_card_name ON image_library USING gin(to_tsvector('russian', card_name))",
		"CREATE INDEX IF NOT EXISTS idx_image_library_card_rarity ON image_library(card_rarity)",
		"CREATE INDEX IF NOT EXISTS idx_image_library_created_at ON image_library(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_image_library_deleted_at ON image_library(deleted_at) WHERE deleted_at IS NOT NULL",
		"CREATE INDEX IF NOT EXISTS idx_image_library_cloudinary_id ON image_library(cloudinary_id)",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index: %w", err)
		}
	}

	// Создаем триггер для обновления updated_at
	triggerQuery := `
		CREATE OR REPLACE FUNCTION update_updated_at_column()
		RETURNS TRIGGER AS $$
		BEGIN
			NEW.updated_at = CURRENT_TIMESTAMP;
			RETURN NEW;
		END;
		$$ language 'plpgsql';

		DROP TRIGGER IF EXISTS update_image_library_updated_at ON image_library;
		CREATE TRIGGER update_image_library_updated_at 
			BEFORE UPDATE ON image_library 
			FOR EACH ROW 
			EXECUTE FUNCTION update_updated_at_column();
	`

	if _, err := db.Exec(triggerQuery); err != nil {
		return fmt.Errorf("failed to create trigger: %w", err)
	}

	return nil
}

// dropImageLibraryTable удаляет таблицу библиотеки изображений
func dropImageLibraryTable(db *sql.DB) error {
	query := "DROP TABLE IF EXISTS image_library CASCADE"
	_, err := db.Exec(query)
	return err
}

// addExtendedFields добавляет расширенные поля к картам и шаблонам
func addExtendedFields(db *sql.DB) error {
	// Добавляем поля к таблице cards
	cardsQueries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS author VARCHAR(255) DEFAULT 'Admin'",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS source VARCHAR(255)",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS type VARCHAR(50)",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS related_cards TEXT",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS related_actions TEXT",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS related_effects TEXT",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS attunement TEXT",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS tags TEXT",
	}

	for _, query := range cardsQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to add field to cards table: %w", err)
		}
	}

	// Добавляем поля к таблице weapon_templates
	weaponQueries := []string{
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS author VARCHAR(255) DEFAULT 'Admin'",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS source VARCHAR(255)",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS type VARCHAR(50)",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS related_cards TEXT",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS related_actions TEXT",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS related_effects TEXT",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS attunement TEXT",
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS tags TEXT",
	}

	for _, query := range weaponQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to add field to weapon_templates table: %w", err)
		}
	}

	// Создаем индексы
	indexQueries := []string{
		"CREATE INDEX IF NOT EXISTS idx_cards_author ON cards(author)",
		"CREATE INDEX IF NOT EXISTS idx_cards_source ON cards(source)",
		"CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_author ON weapon_templates(author)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_source ON weapon_templates(source)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_type ON weapon_templates(type)",
	}

	for _, query := range indexQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to create index: %w", err)
		}
	}

	return nil
}

// removeExtendedFields удаляет расширенные поля
func removeExtendedFields(db *sql.DB) error {
	// Удаляем индексы
	dropIndexQueries := []string{
		"DROP INDEX IF EXISTS idx_cards_author",
		"DROP INDEX IF EXISTS idx_cards_source",
		"DROP INDEX IF EXISTS idx_cards_type",
		"DROP INDEX IF EXISTS idx_weapon_templates_author",
		"DROP INDEX IF EXISTS idx_weapon_templates_source",
		"DROP INDEX IF EXISTS idx_weapon_templates_type",
	}

	for _, query := range dropIndexQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to drop index: %w", err)
		}
	}

	// Удаляем поля из таблицы cards
	cardsQueries := []string{
		"ALTER TABLE cards DROP COLUMN IF EXISTS author",
		"ALTER TABLE cards DROP COLUMN IF EXISTS source",
		"ALTER TABLE cards DROP COLUMN IF EXISTS type",
		"ALTER TABLE cards DROP COLUMN IF EXISTS related_cards",
		"ALTER TABLE cards DROP COLUMN IF EXISTS related_actions",
		"ALTER TABLE cards DROP COLUMN IF EXISTS related_effects",
		"ALTER TABLE cards DROP COLUMN IF EXISTS attunement",
		"ALTER TABLE cards DROP COLUMN IF EXISTS tags",
	}

	for _, query := range cardsQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to remove field from cards table: %w", err)
		}
	}

	// Удаляем поля из таблицы weapon_templates
	weaponQueries := []string{
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS author",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS source",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS type",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS related_cards",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS related_actions",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS related_effects",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS attunement",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS tags",
	}

	for _, query := range weaponQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to remove field from weapon_templates table: %w", err)
		}
	}

	return nil
}

// addArmorSupport добавляет поддержку доспехов в weapon_templates
func addArmorSupport(db *sql.DB) error {
	// Обновляем ограничения для категорий, добавляя доспехи
	queries := []string{
		// Удаляем старое ограничение категорий
		"ALTER TABLE weapon_templates DROP CONSTRAINT IF EXISTS weapon_templates_category_check",
		// Добавляем новое ограничение с поддержкой доспехов
		"ALTER TABLE weapon_templates ADD CONSTRAINT weapon_templates_category_check CHECK (category IN ('simple_melee', 'martial_melee', 'simple_ranged', 'martial_ranged', 'light_armor', 'medium_armor', 'heavy_armor', 'shield'))",

		// Удаляем старое ограничение damage_type
		"ALTER TABLE weapon_templates DROP CONSTRAINT IF EXISTS weapon_templates_damage_type_check",
		// Добавляем новое ограничение с поддержкой defense
		"ALTER TABLE weapon_templates ADD CONSTRAINT weapon_templates_damage_type_check CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning', 'defense'))",

		// Добавляем колонку defense_type для доспехов
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS defense_type VARCHAR(20) CHECK (defense_type IN ('cloth', 'light', 'medium', 'heavy') OR defense_type IS NULL)",

		// Добавляем колонку armor_class для класса доспеха
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS armor_class VARCHAR(20)",

		// Добавляем колонку strength_requirement для требований к силе
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS strength_requirement INTEGER",

		// Добавляем колонку stealth_disadvantage для помехи скрытности
		"ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS stealth_disadvantage BOOLEAN DEFAULT FALSE",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute armor support query: %w", err)
		}
	}

	// Создаем индексы для новых полей
	indexQueries := []string{
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_defense_type ON weapon_templates(defense_type)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_armor_class ON weapon_templates(armor_class)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_strength_requirement ON weapon_templates(strength_requirement)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_stealth_disadvantage ON weapon_templates(stealth_disadvantage)",
	}

	for _, query := range indexQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to create armor support index: %w", err)
		}
	}

	return nil
}

// removeArmorSupport удаляет поддержку доспехов из weapon_templates
func removeArmorSupport(db *sql.DB) error {
	// Удаляем индексы
	dropIndexQueries := []string{
		"DROP INDEX IF EXISTS idx_weapon_templates_defense_type",
		"DROP INDEX IF EXISTS idx_weapon_templates_armor_class",
		"DROP INDEX IF EXISTS idx_weapon_templates_strength_requirement",
		"DROP INDEX IF EXISTS idx_weapon_templates_stealth_disadvantage",
	}

	for _, query := range dropIndexQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to drop armor support index: %w", err)
		}
	}

	// Удаляем колонки
	queries := []string{
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS defense_type",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS armor_class",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS strength_requirement",
		"ALTER TABLE weapon_templates DROP COLUMN IF EXISTS stealth_disadvantage",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to remove armor support column: %w", err)
		}
	}

	// Восстанавливаем старые ограничения
	restoreQueries := []string{
		"ALTER TABLE weapon_templates DROP CONSTRAINT IF EXISTS weapon_templates_category_check",
		"ALTER TABLE weapon_templates ADD CONSTRAINT weapon_templates_category_check CHECK (category IN ('simple_melee', 'martial_melee', 'simple_ranged', 'martial_ranged'))",
		"ALTER TABLE weapon_templates DROP CONSTRAINT IF EXISTS weapon_templates_damage_type_check",
		"ALTER TABLE weapon_templates ADD CONSTRAINT weapon_templates_damage_type_check CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning'))",
	}

	for _, query := range restoreQueries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to restore original constraints: %w", err)
		}
	}

	return nil
}

// addIsTemplateField добавляет поле is_template в таблицу cards
func addIsTemplateField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_template VARCHAR(20) DEFAULT 'false'",
		"ALTER TABLE cards ADD CONSTRAINT cards_is_template_check CHECK (is_template IN ('false', 'template', 'only_template'))",
		"CREATE INDEX IF NOT EXISTS idx_cards_is_template ON cards(is_template)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeIsTemplateField удаляет поле is_template из таблицы cards
func removeIsTemplateField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_cards_is_template",
		"ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_is_template_check",
		"ALTER TABLE cards DROP COLUMN IF EXISTS is_template",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeWeaponTemplatesTable удаляет таблицу weapon_templates
func removeWeaponTemplatesTable(db *sql.DB) error {
	queries := []string{
		"DROP TABLE IF EXISTS weapon_templates CASCADE",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// restoreWeaponTemplatesTable восстанавливает таблицу weapon_templates
func restoreWeaponTemplatesTable(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS weapon_templates (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			name_en VARCHAR(255) NOT NULL,
			category VARCHAR(50) NOT NULL CHECK (category IN ('simple_melee', 'martial_melee', 'simple_ranged', 'martial_ranged', 'light_armor', 'medium_armor', 'heavy_armor', 'shield')),
			damage_type VARCHAR(20) NOT NULL CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning', 'defense')),
			damage VARCHAR(20) NOT NULL,
			weight DECIMAL(5,2) NOT NULL,
			price INTEGER NOT NULL,
			properties TEXT[] DEFAULT '{}',
			image_path TEXT,
			image_cloudinary_id VARCHAR(255),
			image_cloudinary_url TEXT,
			image_generated BOOLEAN DEFAULT FALSE,
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			type VARCHAR(50),
			related_cards TEXT[] DEFAULT '{}',
			related_actions TEXT[] DEFAULT '{}',
			related_effects TEXT[] DEFAULT '{}',
			attunement TEXT,
			tags TEXT[] DEFAULT '{}',
			defense_type VARCHAR(20),
			armor_class VARCHAR(20),
			strength_requirement INTEGER,
			stealth_disadvantage BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_category ON weapon_templates(category)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_damage_type ON weapon_templates(damage_type)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_defense_type ON weapon_templates(defense_type)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_armor_class ON weapon_templates(armor_class)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_strength_requirement ON weapon_templates(strength_requirement)",
		"CREATE INDEX IF NOT EXISTS idx_weapon_templates_stealth_disadvantage ON weapon_templates(stealth_disadvantage)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// addDetailedDescriptionField добавляет поле detailed_description в таблицу cards
func addDetailedDescriptionField(db *sql.DB) error {
	query := `ALTER TABLE cards ADD COLUMN detailed_description TEXT`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to add detailed_description column: %w", err)
	}
	return nil
}

// removeDetailedDescriptionField удаляет поле detailed_description из таблицы cards
func removeDetailedDescriptionField(db *sql.DB) error {
	query := `ALTER TABLE cards DROP COLUMN IF EXISTS detailed_description`
	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to remove detailed_description column: %w", err)
	}
	return nil
}
