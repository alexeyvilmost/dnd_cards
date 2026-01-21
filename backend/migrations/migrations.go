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
		{
			Version:     "007_add_slot_field",
			Description: "Add slot field to cards table for equipment slots",
			Up:          addSlotField,
			Down:        removeSlotField,
		},
		{
			Version:     "008_add_is_equipped_field",
			Description: "Add is_equipped field to inventory_items table",
			Up:          addIsEquippedField,
			Down:        removeIsEquippedField,
		},
		{
			Version:     "009_create_characters_v2_table",
			Description: "Create characters_v2 table for new simplified character system",
			Up:          createCharactersV2Table,
			Down:        dropCharactersV2Table,
		},
		{
			Version:     "010_add_text_formatting_fields",
			Description: "Add text_alignment and text_font_size fields to cards table",
			Up:          addTextFormattingFields,
			Down:        removeTextFormattingFields,
		},
		{
			Version:     "011_add_detailed_description_toggle",
			Description: "Add show_detailed_description, detailed_description_alignment and detailed_description_font_size fields to cards table",
			Up:          addDetailedDescriptionToggleFields,
			Down:        removeDetailedDescriptionToggleFields,
		},
		{
			Version:     "012_fix_character_v2_foreign_key",
			Description: "Fix foreign key constraint for character_id in inventories table to reference characters_v2",
			Up:          fixCharacterV2ForeignKey,
			Down:        restoreCharacterForeignKey,
		},
		{
			Version:     "013_add_performance_indexes",
			Description: "Add performance indexes for inventory operations",
			Up:          addPerformanceIndexes,
			Down:        removePerformanceIndexes,
		},
		{
			Version:     "014_add_equipped_slot",
			Description: "Add equipped_slot field to inventory_items table",
			Up:          addEquippedSlotField,
			Down:        removeEquippedSlotField,
		},
		{
			Version:     "015_add_effects",
			Description: "Add effects field to cards table",
			Up:          addEffectsField,
			Down:        removeEffectsField,
		},
		{
			Version:     "016_create_shops",
			Description: "Create shops table to persist generated shop assortments",
			Up:          createShopsTable,
			Down:        dropShopsTable,
		},
		{
			Version:     "017_create_actions",
			Description: "Create actions table for D&D actions",
			Up:          createActionsTable,
			Down:        dropActionsTable,
		},
		{
			Version:     "018_create_effects",
			Description: "Create effects table for D&D passive effects",
			Up:          createEffectsTable,
			Down:        dropEffectsTable,
		},
		{
			Version:     "019_add_weapon_type",
			Description: "Add weapon_type field to cards table",
			Up:          addWeaponTypeField,
			Down:        removeWeaponTypeField,
		},
		{
			Version:     "020_add_character_v3_proficiencies",
			Description: "Add weapon_proficiencies, damage_resistances, language_proficiencies, armor_proficiencies fields to characters table",
			Up:          addCharacterV3ProficienciesFields,
			Down:        removeCharacterV3ProficienciesFields,
		},
		{
			Version:     "021_add_image_library_item_fields",
			Description: "Add item_type, weapon_type, armor_type, slot fields to image_library table",
			Up:          addImageLibraryItemFields,
			Down:        removeImageLibraryItemFields,
		},
		{
			Version:     "022_remove_actions_resource_check",
			Description: "Remove CHECK constraint from actions.resource column to support multiple resources",
			Up:          removeActionsResourceCheck,
			Down:        restoreActionsResourceCheck,
		},
		{
			Version:     "023_add_action_distance",
			Description: "Add distance field to actions table",
			Up:          addActionDistanceField,
			Down:        removeActionDistanceField,
		},
		{
			Version:     "024_add_effects_resources_to_characters_v2",
			Description: "Add active_effects, resources, max_resources fields to characters_v2 table",
			Up:          addEffectsResourcesToCharactersV2,
			Down:        removeEffectsResourcesFromCharactersV2,
		},
		{
			Version:     "025_update_rage_action",
			Description: "Update action_barbarian_rage_2 with script and resources",
			Up:          updateRageAction,
			Down:        rollbackRageAction,
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

// addSlotField добавляет поле slot в таблицу cards
func addSlotField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS slot VARCHAR(20)",
		"ALTER TABLE cards ADD CONSTRAINT cards_slot_check CHECK (slot IN ('head', 'body', 'arms', 'feet', 'cloak', 'one_hand', 'versatile', 'two_hands', 'necklace', 'ring') OR slot IS NULL)",
		"CREATE INDEX IF NOT EXISTS idx_cards_slot ON cards(slot)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeSlotField удаляет поле slot из таблицы cards
func removeSlotField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_cards_slot",
		"ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_slot_check",
		"ALTER TABLE cards DROP COLUMN IF EXISTS slot",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// addIsEquippedField добавляет поле is_equipped в таблицу inventory_items
func addIsEquippedField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_equipped BOOLEAN NOT NULL DEFAULT false",
		"CREATE INDEX IF NOT EXISTS idx_inventory_items_is_equipped ON inventory_items(is_equipped)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeIsEquippedField удаляет поле is_equipped из таблицы inventory_items
func removeIsEquippedField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_inventory_items_is_equipped",
		"ALTER TABLE inventory_items DROP COLUMN IF EXISTS is_equipped",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// createCharactersV2Table создает таблицу персонажей V2
func createCharactersV2Table(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS characters_v2 (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL,
			group_id UUID,
			name VARCHAR(255) NOT NULL,
			race VARCHAR(100) NOT NULL,
			class VARCHAR(100) NOT NULL,
			level INTEGER NOT NULL DEFAULT 1,
			speed INTEGER NOT NULL DEFAULT 30,
			strength INTEGER NOT NULL DEFAULT 10,
			dexterity INTEGER NOT NULL DEFAULT 10,
			constitution INTEGER NOT NULL DEFAULT 10,
			intelligence INTEGER NOT NULL DEFAULT 10,
			wisdom INTEGER NOT NULL DEFAULT 10,
			charisma INTEGER NOT NULL DEFAULT 10,
			max_hp INTEGER NOT NULL DEFAULT 1,
			current_hp INTEGER NOT NULL DEFAULT 1,
			saving_throw_proficiencies TEXT,
			skill_proficiencies TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL,
			CHECK (level >= 1 AND level <= 20),
			CHECK (speed >= 1),
			CHECK (strength >= 1 AND strength <= 30),
			CHECK (dexterity >= 1 AND dexterity <= 30),
			CHECK (constitution >= 1 AND constitution <= 30),
			CHECK (intelligence >= 1 AND intelligence <= 30),
			CHECK (wisdom >= 1 AND wisdom <= 30),
			CHECK (charisma >= 1 AND charisma <= 30),
			CHECK (max_hp >= 1),
			CHECK (current_hp >= 0)
		)
	`

	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create characters_v2 table: %w", err)
	}

	// Создаем индексы
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_user_id ON characters_v2(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_group_id ON characters_v2(group_id)",
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_name ON characters_v2(name)",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index: %w", err)
		}
	}

	return nil
}

// dropCharactersV2Table удаляет таблицу персонажей V2
func dropCharactersV2Table(db *sql.DB) error {
	query := "DROP TABLE IF EXISTS characters_v2"
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to drop characters_v2 table: %w", err)
	}
	return nil
}

// addTextFormattingFields добавляет поля text_alignment и text_font_size в таблицу cards
func addTextFormattingFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS text_alignment VARCHAR(20) CHECK (text_alignment IN ('left', 'center', 'right'))",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS text_font_size INTEGER CHECK (text_font_size >= 8 AND text_font_size <= 24)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeTextFormattingFields удаляет поля text_alignment и text_font_size из таблицы cards
func removeTextFormattingFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards DROP COLUMN IF EXISTS text_alignment",
		"ALTER TABLE cards DROP COLUMN IF EXISTS text_font_size",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// addDetailedDescriptionToggleFields добавляет поля show_detailed_description, detailed_description_alignment и detailed_description_font_size в таблицу cards
func addDetailedDescriptionToggleFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS show_detailed_description BOOLEAN DEFAULT FALSE",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS detailed_description_alignment VARCHAR(20) CHECK (detailed_description_alignment IN ('left', 'center', 'right'))",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS detailed_description_font_size INTEGER CHECK (detailed_description_font_size >= 8 AND detailed_description_font_size <= 24)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeDetailedDescriptionToggleFields удаляет поля show_detailed_description, detailed_description_alignment и detailed_description_font_size из таблицы cards
func removeDetailedDescriptionToggleFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards DROP COLUMN IF EXISTS show_detailed_description",
		"ALTER TABLE cards DROP COLUMN IF EXISTS detailed_description_alignment",
		"ALTER TABLE cards DROP COLUMN IF EXISTS detailed_description_font_size",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// fixCharacterV2ForeignKey временно удаляет ограничение внешнего ключа для character_id в inventories
func fixCharacterV2ForeignKey(db *sql.DB) error {
	// Удаляем все внешние ключи для character_id в таблице inventories
	// Это позволит системе работать без ограничений, пока мы не определимся с системой персонажей
	dropQueries := []string{
		"ALTER TABLE inventories DROP CONSTRAINT IF EXISTS fk_inventories_character_id",
		"ALTER TABLE inventories DROP CONSTRAINT IF EXISTS fk_inventories_character_v2_id",
		"ALTER TABLE inventories DROP CONSTRAINT IF EXISTS inventories_character_id_fkey",
	}

	for _, query := range dropQueries {
		if _, err := db.Exec(query); err != nil {
			// Игнорируем ошибки, если ограничение не существует
			// Это нормально, так как мы используем IF EXISTS
		}
	}

	return nil
}

// restoreCharacterForeignKey восстанавливает внешний ключ для characters (для отката)
func restoreCharacterForeignKey(db *sql.DB) error {
	// Восстанавливаем внешний ключ для characters
	createQuery := `
		ALTER TABLE inventories ADD CONSTRAINT fk_inventories_character_id 
		FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
	`
	if _, err := db.Exec(createQuery); err != nil {
		return fmt.Errorf("failed to restore characters foreign key: %w", err)
	}

	return nil
}

// addPerformanceIndexes добавляет индексы для ускорения операций с инвентарем
func addPerformanceIndexes(db *sql.DB) error {
	indexes := []string{
		// Индексы для таблицы inventories
		"CREATE INDEX IF NOT EXISTS idx_inventories_character_id ON inventories(character_id)",
		"CREATE INDEX IF NOT EXISTS idx_inventories_type ON inventories(type)",
		"CREATE INDEX IF NOT EXISTS idx_inventories_character_type ON inventories(character_id, type)",

		// Индексы для таблицы inventory_items
		"CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory_id ON inventory_items(inventory_id)",
		"CREATE INDEX IF NOT EXISTS idx_inventory_items_card_id ON inventory_items(card_id)",
		"CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory_card ON inventory_items(inventory_id, card_id)",

		// Индексы для таблицы cards
		"CREATE INDEX IF NOT EXISTS idx_cards_id_deleted ON cards(id) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_cards_template_deleted ON cards(is_template, deleted_at)",

		// Индексы для таблицы characters_v2
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_user_id ON characters_v2(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_id_user ON characters_v2(id, user_id)",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index '%s': %w", indexQuery, err)
		}
	}

	return nil
}

// removePerformanceIndexes удаляет индексы производительности
func removePerformanceIndexes(db *sql.DB) error {
	indexes := []string{
		"DROP INDEX IF EXISTS idx_inventories_character_id",
		"DROP INDEX IF EXISTS idx_inventories_type",
		"DROP INDEX IF EXISTS idx_inventories_character_type",
		"DROP INDEX IF EXISTS idx_inventory_items_inventory_id",
		"DROP INDEX IF EXISTS idx_inventory_items_card_id",
		"DROP INDEX IF EXISTS idx_inventory_items_inventory_card",
		"DROP INDEX IF EXISTS idx_cards_id_deleted",
		"DROP INDEX IF EXISTS idx_cards_template_deleted",
		"DROP INDEX IF EXISTS idx_characters_v2_user_id",
		"DROP INDEX IF EXISTS idx_characters_v2_id_user",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to drop index '%s': %w", indexQuery, err)
		}
	}

	return nil
}

// addEquippedSlotField добавляет поле equipped_slot в таблицу inventory_items
func addEquippedSlotField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS equipped_slot VARCHAR(50)",
		"CREATE INDEX IF NOT EXISTS idx_inventory_items_equipped_slot ON inventory_items(equipped_slot)",
		"COMMENT ON COLUMN inventory_items.equipped_slot IS 'Слот экипировки предмета (head, body, arms, feet, ring, necklace, cloak, one_hand, versatile)'",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// removeEquippedSlotField удаляет поле equipped_slot из таблицы inventory_items
func removeEquippedSlotField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_inventory_items_equipped_slot",
		"ALTER TABLE inventory_items DROP COLUMN IF EXISTS equipped_slot",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}

	return nil
}

// addEffectsField добавляет поле effects в таблицу cards
func addEffectsField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS effects JSONB",
		"COMMENT ON COLUMN cards.effects IS 'Эффекты предмета в формате JSON: массив объектов с полями target_type, target_specific, modifier, value'",
		"CREATE INDEX IF NOT EXISTS idx_cards_effects ON cards USING GIN (effects)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeEffectsField удаляет поле effects из таблицы cards
func removeEffectsField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_cards_effects",
		"ALTER TABLE cards DROP COLUMN IF EXISTS effects",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// createShopsTable создает таблицу магазинов для хранения ассортиментов
func createShopsTable(db *sql.DB) error {
	query := `
        CREATE TABLE IF NOT EXISTS shops (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug VARCHAR(64) UNIQUE NOT NULL,
            data JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create shops table: %w", err)
	}

	// Индексы
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_shops_created_at ON shops(created_at DESC)",
	}
	for _, q := range indexes {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("failed to create index for shops: %w", err)
		}
	}
	return nil
}

// dropShopsTable удаляет таблицу магазинов
func dropShopsTable(db *sql.DB) error {
	_, err := db.Exec("DROP TABLE IF EXISTS shops CASCADE")
	return err
}

// createActionsTable создает таблицу действий
func createActionsTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS actions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			description TEXT NOT NULL,
			detailed_description TEXT,
			image_url TEXT,
			image_cloudinary_id VARCHAR(255),
			image_cloudinary_url TEXT,
			image_generated BOOLEAN DEFAULT false,
			image_generation_prompt TEXT,
			rarity VARCHAR(50) NOT NULL DEFAULT 'common',
			card_number VARCHAR(50) UNIQUE NOT NULL,
			resource TEXT,
			recharge VARCHAR(50) CHECK (recharge IN ('custom', 'per_turn', 'per_battle', 'short_rest', 'long_rest')),
			recharge_custom TEXT,
			script JSONB,
			action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('base_action', 'class_feature', 'item_property')),
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags TEXT[],
			price INTEGER,
			weight DECIMAL(5,2),
			properties TEXT[],
			related_cards TEXT[],
			related_actions TEXT[],
			is_extended BOOLEAN DEFAULT false,
			description_font_size INTEGER,
			text_alignment VARCHAR(20),
			text_font_size INTEGER,
			show_detailed_description BOOLEAN DEFAULT false,
			detailed_description_alignment VARCHAR(20),
			detailed_description_font_size INTEGER,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)
	`

	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create actions table: %w", err)
	}

	// Создаем индексы
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_actions_rarity ON actions(rarity)",
		"CREATE INDEX IF NOT EXISTS idx_actions_name ON actions USING gin(to_tsvector('russian', name))",
		"CREATE INDEX IF NOT EXISTS idx_actions_resource ON actions(resource)",
		"CREATE INDEX IF NOT EXISTS idx_actions_action_type ON actions(action_type)",
		"CREATE INDEX IF NOT EXISTS idx_actions_card_number ON actions(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_actions_deleted_at ON actions(deleted_at) WHERE deleted_at IS NOT NULL",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index for actions: %w", err)
		}
	}

	// Создаем триггер для автоматического обновления updated_at
	triggerQuery := `
		DROP TRIGGER IF EXISTS update_actions_updated_at ON actions;
		CREATE TRIGGER update_actions_updated_at 
			BEFORE UPDATE ON actions 
			FOR EACH ROW 
			EXECUTE FUNCTION update_updated_at_column();
	`

	if _, err := db.Exec(triggerQuery); err != nil {
		return fmt.Errorf("failed to create trigger for actions: %w", err)
	}

	return nil
}

// dropActionsTable удаляет таблицу действий
func dropActionsTable(db *sql.DB) error {
	_, err := db.Exec("DROP TABLE IF EXISTS actions CASCADE")
	return err
}

// createEffectsTable создает таблицу пассивных эффектов
func createEffectsTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS effects (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			description TEXT NOT NULL,
			detailed_description TEXT,
			image_url TEXT,
			image_cloudinary_id VARCHAR(255),
			image_cloudinary_url TEXT,
			image_generated BOOLEAN DEFAULT false,
			image_generation_prompt TEXT,
			rarity VARCHAR(50) NOT NULL DEFAULT 'common',
			card_number VARCHAR(50) UNIQUE NOT NULL,
			effect_type VARCHAR(50) NOT NULL CHECK (effect_type IN ('passive', 'conditional', 'triggered')),
			condition_description TEXT,
			script JSONB,
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags TEXT[],
			price INTEGER,
			weight DECIMAL(5,2),
			properties TEXT[],
			related_cards TEXT[],
			related_actions TEXT[],
			related_effects TEXT[],
			is_extended BOOLEAN DEFAULT false,
			description_font_size INTEGER,
			text_alignment VARCHAR(20),
			text_font_size INTEGER,
			show_detailed_description BOOLEAN DEFAULT false,
			detailed_description_alignment VARCHAR(20),
			detailed_description_font_size INTEGER,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)
	`

	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create effects table: %w", err)
	}

	// Создаем индексы
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_effects_rarity ON effects(rarity)",
		"CREATE INDEX IF NOT EXISTS idx_effects_name ON effects USING gin(to_tsvector('russian', name))",
		"CREATE INDEX IF NOT EXISTS idx_effects_effect_type ON effects(effect_type)",
		"CREATE INDEX IF NOT EXISTS idx_effects_card_number ON effects(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_effects_created_at ON effects(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_effects_deleted_at ON effects(deleted_at) WHERE deleted_at IS NOT NULL",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index for effects: %w", err)
		}
	}

	// Создаем триггер для автоматического обновления updated_at
	triggerQuery := `
		DROP TRIGGER IF EXISTS update_effects_updated_at ON effects;
		CREATE TRIGGER update_effects_updated_at 
			BEFORE UPDATE ON effects 
			FOR EACH ROW 
			EXECUTE FUNCTION update_updated_at_column();
	`

	if _, err := db.Exec(triggerQuery); err != nil {
		return fmt.Errorf("failed to create trigger for effects: %w", err)
	}

	return nil
}

// dropEffectsTable удаляет таблицу пассивных эффектов
func dropEffectsTable(db *sql.DB) error {
	_, err := db.Exec("DROP TABLE IF EXISTS effects CASCADE")
	return err
}

// addWeaponTypeField добавляет поле weapon_type в таблицу cards
func addWeaponTypeField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS weapon_type VARCHAR(50)",
		"CREATE INDEX IF NOT EXISTS idx_cards_weapon_type ON cards(weapon_type)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeWeaponTypeField удаляет поле weapon_type из таблицы cards
func removeWeaponTypeField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_cards_weapon_type",
		"ALTER TABLE cards DROP COLUMN IF EXISTS weapon_type",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// addCharacterV3ProficienciesFields добавляет поля для владений персонажа V3 в таблицу characters
func addCharacterV3ProficienciesFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE characters ADD COLUMN IF NOT EXISTS weapon_proficiencies JSONB",
		"ALTER TABLE characters ADD COLUMN IF NOT EXISTS damage_resistances JSONB",
		"ALTER TABLE characters ADD COLUMN IF NOT EXISTS language_proficiencies JSONB",
		"ALTER TABLE characters ADD COLUMN IF NOT EXISTS armor_proficiencies JSONB",
		"CREATE INDEX IF NOT EXISTS idx_characters_weapon_proficiencies ON characters USING GIN (weapon_proficiencies)",
		"CREATE INDEX IF NOT EXISTS idx_characters_damage_resistances ON characters USING GIN (damage_resistances)",
		"CREATE INDEX IF NOT EXISTS idx_characters_language_proficiencies ON characters USING GIN (language_proficiencies)",
		"CREATE INDEX IF NOT EXISTS idx_characters_armor_proficiencies ON characters USING GIN (armor_proficiencies)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeCharacterV3ProficienciesFields удаляет поля владений персонажа V3 из таблицы characters
func removeCharacterV3ProficienciesFields(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_characters_armor_proficiencies",
		"DROP INDEX IF EXISTS idx_characters_language_proficiencies",
		"DROP INDEX IF EXISTS idx_characters_damage_resistances",
		"DROP INDEX IF EXISTS idx_characters_weapon_proficiencies",
		"ALTER TABLE characters DROP COLUMN IF EXISTS armor_proficiencies",
		"ALTER TABLE characters DROP COLUMN IF EXISTS language_proficiencies",
		"ALTER TABLE characters DROP COLUMN IF EXISTS damage_resistances",
		"ALTER TABLE characters DROP COLUMN IF EXISTS weapon_proficiencies",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// addImageLibraryItemFields добавляет поля item_type, weapon_type, armor_type, slot в таблицу image_library
func addImageLibraryItemFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE image_library ADD COLUMN IF NOT EXISTS item_type VARCHAR(50)",
		"ALTER TABLE image_library ADD COLUMN IF NOT EXISTS weapon_type VARCHAR(50)",
		"ALTER TABLE image_library ADD COLUMN IF NOT EXISTS armor_type VARCHAR(50)",
		"ALTER TABLE image_library ADD COLUMN IF NOT EXISTS slot VARCHAR(20)",
		"CREATE INDEX IF NOT EXISTS idx_image_library_item_type ON image_library(item_type)",
		"CREATE INDEX IF NOT EXISTS idx_image_library_weapon_type ON image_library(weapon_type)",
		"CREATE INDEX IF NOT EXISTS idx_image_library_armor_type ON image_library(armor_type)",
		"CREATE INDEX IF NOT EXISTS idx_image_library_slot ON image_library(slot)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeImageLibraryItemFields удаляет поля item_type, weapon_type, armor_type, slot из таблицы image_library
func removeImageLibraryItemFields(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_image_library_slot",
		"DROP INDEX IF EXISTS idx_image_library_armor_type",
		"DROP INDEX IF EXISTS idx_image_library_weapon_type",
		"DROP INDEX IF EXISTS idx_image_library_item_type",
		"ALTER TABLE image_library DROP COLUMN IF EXISTS slot",
		"ALTER TABLE image_library DROP COLUMN IF EXISTS armor_type",
		"ALTER TABLE image_library DROP COLUMN IF EXISTS weapon_type",
		"ALTER TABLE image_library DROP COLUMN IF EXISTS item_type",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeActionsResourceCheck удаляет CHECK constraint из колонки resource в таблице actions
func removeActionsResourceCheck(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_resource_check",
		"ALTER TABLE actions ALTER COLUMN resource TYPE TEXT",
		"ALTER TABLE actions ALTER COLUMN resource DROP NOT NULL",
		"COMMENT ON COLUMN actions.resource IS 'Ресурсы действия через запятую (action, bonus_action, reaction, free_action)'",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// restoreActionsResourceCheck восстанавливает CHECK constraint для колонки resource в таблице actions
func restoreActionsResourceCheck(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE actions ALTER COLUMN resource TYPE VARCHAR(50)",
		"ALTER TABLE actions ALTER COLUMN resource SET NOT NULL",
		"ALTER TABLE actions ADD CONSTRAINT actions_resource_check CHECK (resource IN ('action', 'bonus_action', 'reaction', 'free_action'))",
		"COMMENT ON COLUMN actions.resource IS 'Ресурс действия (action, bonus_action, reaction, free_action)'",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// addActionDistanceField добавляет поле distance в таблицу actions
func addActionDistanceField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE actions ADD COLUMN IF NOT EXISTS distance VARCHAR(100)",
		"COMMENT ON COLUMN actions.distance IS 'Дальность действия (например, \"5 футов\", \"30 футов\", \"На себя\")'",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeActionDistanceField удаляет поле distance из таблицы actions
func removeActionDistanceField(db *sql.DB) error {
	query := "ALTER TABLE actions DROP COLUMN IF EXISTS distance"
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to execute query '%s': %w", query, err)
	}
	return nil
}

// addEffectsResourcesToCharactersV2 добавляет поля для эффектов и ресурсов в characters_v2
func addEffectsResourcesToCharactersV2(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE characters_v2 ADD COLUMN IF NOT EXISTS active_effects JSONB DEFAULT '[]'::jsonb",
		"ALTER TABLE characters_v2 ADD COLUMN IF NOT EXISTS resources JSONB DEFAULT '{}'::jsonb",
		"ALTER TABLE characters_v2 ADD COLUMN IF NOT EXISTS max_resources JSONB DEFAULT '{}'::jsonb",
		"COMMENT ON COLUMN characters_v2.active_effects IS 'Массив активных эффектов с метаданными (duration, script и т.д.)'",
		"COMMENT ON COLUMN characters_v2.resources IS 'Текущие значения ресурсов (заряды ярости, ячейки заклинаний и т.д.)'",
		"COMMENT ON COLUMN characters_v2.max_resources IS 'Максимальные значения ресурсов для восстановления'",
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_active_effects ON characters_v2 USING GIN (active_effects)",
		"CREATE INDEX IF NOT EXISTS idx_characters_v2_resources ON characters_v2 USING GIN (resources)",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeEffectsResourcesFromCharactersV2 удаляет поля эффектов и ресурсов из characters_v2
func removeEffectsResourcesFromCharactersV2(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_characters_v2_resources",
		"DROP INDEX IF EXISTS idx_characters_v2_active_effects",
		"ALTER TABLE characters_v2 DROP COLUMN IF EXISTS max_resources",
		"ALTER TABLE characters_v2 DROP COLUMN IF EXISTS resources",
		"ALTER TABLE characters_v2 DROP COLUMN IF EXISTS active_effects",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// updateRageAction обновляет действие Ярость с скриптом и ресурсами
func updateRageAction(db *sql.DB) error {
	// Обновляем ресурсы действия
	updateResourceQuery := "UPDATE actions SET resource = 'bonus_action,rage_charge' WHERE card_number = 'action_barbarian_rage_2'"
	if _, err := db.Exec(updateResourceQuery); err != nil {
		return fmt.Errorf("failed to update action resources: %w", err)
	}

	// Обновляем скрипт действия (используем правильное экранирование для PostgreSQL)
	scriptJSON := `{"resource_cost":["bonus_action","rage_charge"],"duration":"10 rounds","effects":[{"name":"rage_damage_modifier","type":"attack_modifier","attack_range":"melee","attack_type":"weapon","modifies":"damage_roll","modifier_type":"add","modifier":"+2","conditions":{"attack_attribute":"strength"}},{"type":"resistance","resistances":[{"damage_type":"bludgeoning","resistance_type":"resistance"},{"damage_type":"piercing","resistance_type":"resistance"},{"damage_type":"slashing","resistance_type":"resistance"}]},{"type":"ability_check_modifier","ability_checks":["athletics"],"modifier":"advantage"},{"type":"saving_throw_modifier","saving_throws":["strength"],"modifier":"advantage"},{"type":"spell_restriction","restriction":"cannot_cast_or_concentrate"}],"end_action":{"name":"Выйти из Ярости","resource_cost":["bonus_action"],"ends_effect":true}}`

	updateScriptQuery := fmt.Sprintf("UPDATE actions SET script = '%s'::jsonb WHERE card_number = 'action_barbarian_rage_2'", scriptJSON)
	if _, err := db.Exec(updateScriptQuery); err != nil {
		return fmt.Errorf("failed to update action script: %w", err)
	}

	return nil
}

// rollbackRageAction откатывает изменения действия Ярость
func rollbackRageAction(db *sql.DB) error {
	// Очищаем скрипт и ресурсы (можно оставить пустыми или вернуть к предыдущему состоянию)
	queries := []string{
		"UPDATE actions SET script = NULL WHERE card_number = 'action_barbarian_rage_2'",
		"UPDATE actions SET resource = '' WHERE card_number = 'action_barbarian_rage_2'",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}
