package migrations

import (
	"database/sql"
	"encoding/json"
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
		{
			Version:     "026_add_attunement_range_fields",
			Description: "Add requires_attunement and range fields to cards table",
			Up:          addAttunementRangeFields,
			Down:        removeAttunementRangeFields,
		},
		{
			Version:     "027_add_elemental_damage_fields",
			Description: "Add elemental_damage_value and elemental_damage_type fields to cards table",
			Up:          addElementalDamageFields,
			Down:        removeElementalDamageFields,
		},
		{
			Version:     "028_add_battle_profile_field",
			Description: "Add battle_profile jsonb field to cards table",
			Up:          addBattleProfileField,
			Down:        removeBattleProfileField,
		},
		{
			Version:     "029_add_custom_rarity_color",
			Description: "Add custom_rarity_color field to cards table for custom rarity",
			Up:          addCustomRarityColorField,
			Down:        removeCustomRarityColorField,
		},
		{
			Version:     "030_create_spells",
			Description: "Create spells table for D&D spells",
			Up:          createSpellsTable,
			Down:        dropSpellsTable,
		},
		{
			Version:     "031_spells_arrays_to_jsonb",
			Description: "Convert spells array columns (classes/subclasses/save_types/tags) from text[] to jsonb",
			Up:          convertSpellArraysToJsonb,
			Down:        revertSpellArraysToTextArray,
		},
		{
			Version:     "032_spells_widen_text_columns",
			Description: "Widen spells casting_time/range/duration/area to TEXT (long reaction triggers)",
			Up:          widenSpellTextColumns,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "033_create_feats",
			Description: "Create feats table for D&D feats",
			Up:          createFeatsTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS feats CASCADE"); return err },
		},
		{
			Version:     "034_create_backgrounds",
			Description: "Create backgrounds table for D&D backgrounds",
			Up:          createBackgroundsTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS backgrounds CASCADE"); return err },
		},
		{
			Version:     "035_containers_and_bg_equipment",
			Description: "Add container fields to cards and equipment_options to backgrounds",
			Up:          addContainersAndBgEquipment,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "036_card_price_currency",
			Description: "Make cards.price numeric, add price_currency and price_abbreviated",
			Up:          addCardPriceCurrency,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "037_create_races",
			Description: "Create races table for D&D species",
			Up:          createRacesTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS races CASCADE"); return err },
		},
		{
			Version:     "038_mechanics_and_race_abilities",
			Description: "Add mechanics jsonb to effects/actions and related abilities to races",
			Up:          addMechanicsAndRaceAbilities,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "039_create_classes",
			Description: "Create classes table and add race level progression",
			Up:          createClassesAndRaceProgression,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS classes CASCADE"); return err },
		},
		{
			Version:     "040_create_characters_v3",
			Description: "Create characters_v3 table (entity-referencing character storage)",
			Up:          createCharactersV3Table,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS characters_v3 CASCADE"); return err },
		},
		{
			Version:     "041_feat_related_abilities",
			Description: "Add related_effects/related_actions jsonb to feats",
			Up:          addFeatRelatedAbilities,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "042_forge_mvp_content",
			Description: "Seed forge MVP class abilities, feat effects, normalize background skills",
			Up:          seedForgeMVPContent,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "043_character_rule_state",
			Description: "Add rule state and derived rule fields to characters_v3",
			Up:          addCharacterRuleStateFields,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "044_wizard_spell_choices",
			Description: "Make wizard spellcasting grant spell choices",
			Up:          updateWizardSpellChoices,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "045_create_resources",
			Description: "Create resource definitions for actions and mechanics",
			Up:          createResourcesTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS resources CASCADE"); return err },
		},
		{
			Version:     "046_expand_effect_types",
			Description: "Allow semantic effect type categories",
			Up:          expandEffectTypes,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "047_spell_resources",
			Description: "Add resources jsonb to spells (multi-resource cost)",
			Up:          addSpellResources,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "048_character_events",
			Description: "Create character_events table for engine event log",
			Up:          createCharacterEventsTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS character_events CASCADE"); return err },
		},
		{
			Version:     "049_character_runtime",
			Description: "Add runtime jsonb fields to characters_v3 (equipment, inventory, resources)",
			Up:          addCharacterRuntimeFields,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "050_mvp_equipment",
			Description: "Seed MVP equipment cards for inventory testing",
			Up:          seedMvpEquipmentCards,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "051_race_subrace",
			Description: "Add is_subrace and parent_race_id to races",
			Up:          addRaceSubrace,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "052_race_subrace_level",
			Description: "Add subrace_level to races",
			Up:          addSubraceLevel,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "053_migrate_legacy_subraces",
			Description: "Convert legacy subfeature lineage choices into subrace race entities",
			Up:          migrateLegacySubraces,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "054_elf_subrace_content",
			Description: "Fill Drow and Wood Elf subrace descriptions and traits (PHB 2024)",
			Up:          seedElfSubraceContent,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "055_dragonborn_subraces",
			Description: "Create 10 Dragonborn ancestry subraces (PHB 2024)",
			Up:          seedDragonbornSubraces,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "056_spell_mechanics",
			Description: "Add mechanics jsonb to spells (unified mechanics, G8-G9)",
			Up:          addSpellMechanics,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "057_class_recommended_abilities",
			Description: "Add recommended_abilities jsonb to classes (point-buy defaults)",
			Up:          addClassRecommendedAbilities,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "058_card_mechanics",
			Description: "Add mechanics jsonb to cards (unified item mechanics)",
			Up:          addCardMechanics,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "059_class_subclasses",
			Description: "Add subclass fields to classes (is_subclass, parent_class_id, subclass_level, related_effects/actions)",
			Up:          addClassSubclasses,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "060_resource_spent_image",
			Description: "Add image_url_spent to resources (spent-charge look)",
			Up:          addResourceSpentImage,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "061_class_equipment_options",
			Description: "Add equipment_options jsonb to classes (starting gear variants A/B/C)",
			Up:          addClassEquipmentOptions,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "062_basic_actions",
			Description: "Seed core PHB actions (unarmed/weapon/offhand/dodge) as editable Action entities (type='basic')",
			Up:          seedBasicActions,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "063_create_variables",
			Description: "Create variables table (name, type number|dice, default_value) + seed core variable definitions",
			Up:          createVariablesTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS variables CASCADE"); return err },
		},
		{
			Version:     "064_create_conditions",
			Description: "Create conditions table (self/projected modifiers + note as data) + seed 13 PHB 2024 conditions",
			Up:          createConditionsTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS conditions CASCADE"); return err },
		},
		{
			Version:     "065_conditions_as_effects",
			Description: "Unify conditions into effects (effect_type='condition' + scoped-modifier mechanics); drop conditions table",
			Up:          conditionsAsEffects,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "066_drop_spell_legacy_fields",
			Description: "Drop legacy spell columns attack_roll/saving_throw/save_types (превью выводится из mechanics)",
			Up:          dropSpellLegacyFields,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "067_card_enchant_bonus",
			Description: "Add cards.enchant_bonus (магический бонус оружия +N к атаке/урону); backfill из имени '+N'",
			Up:          addCardEnchantBonus,
			Down:        func(db *sql.DB) error { _, err := db.Exec("ALTER TABLE cards DROP COLUMN IF EXISTS enchant_bonus"); return err },
		},
		{
			Version:     "068_dash_disengage_actions",
			Description: "Seed базовых действий Рывок (Dash) и Отход (Disengage) как редактируемые Action(type='basic')",
			Up:          seedDashDisengageActions,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "069_fix_dash_disengage",
			Description: "Убрать дубли Рывок/Отход; Рывок даёт +Скорость до начала след. хода (модификатор), оба type='basic', без ограничения использований",
			Up:          fixDashDisengageActions,
			Down:        func(db *sql.DB) error { return nil },
		},
		{
			Version:     "070_create_concepts",
			Description: "Create concepts dictionary (глоссарий понятий: пояснения, не выражаемые сущностью)",
			Up:          createConceptsTable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("DROP TABLE IF EXISTS concepts CASCADE"); return err },
		},
		{
			Version:     "071_widen_cards_damage_type_check",
			Description: "Расширить cards_damage_type_check: разрешить стихийные типы (acid/fire/…) как основной damage_type",
			Up:          widenCardsDamageTypeCheck,
			Down:        restoreCardsDamageTypeCheck,
		},
		{
			Version:     "072_widen_actions_action_type_check",
			Description: "Расширить actions_action_type_check: добавить species_ability (тип действия «Умение вида»)",
			Up:          widenActionsActionTypeCheck,
			Down:        restoreActionsActionTypeCheck,
		},
		{
			Version:     "073_add_effects_repeatable",
			Description: "Флаг repeatable у эффектов (повторяемый: складывается, можно выбрать несколько раз в конструкторе)",
			Up:          addEffectsRepeatable,
			Down:        func(db *sql.DB) error { _, err := db.Exec("ALTER TABLE effects DROP COLUMN IF EXISTS repeatable"); return err },
		},
		{
			Version:     "074_create_encounters",
			Description: "Серверная сущность боя (encounters) + журнал изменений (encounter_events) для онлайн-синхронизации через SSE/LISTEN-NOTIFY",
			Up:          createEncounterTables,
			Down:        dropEncounterTables,
		},
		{
			Version:     "075_character_current_encounter",
			Description: "Связь персонаж→бой (current_encounter_id) для отображения «в бою» и правила «один бой на персонажа»",
			Up:          addCharacterCurrentEncounter,
			Down:        func(db *sql.DB) error { _, err := db.Exec("ALTER TABLE characters_v3 DROP COLUMN IF EXISTS current_encounter_id"); return err },
		},
		{
			Version:     "076_add_card_mastery",
			Description: "Свойство искусности оружия (Weapon Mastery, PHB 2024): структурная ссылка card.mastery → id эффекта-мастерства (раньше связь жила только текстом в description)",
			Up:          addCardMastery,
			Down:        removeCardMastery,
		},
		// Здесь можно добавлять новые миграции
	}
}

// addCharacterCurrentEncounter — nullable-колонка связи персонажа с текущим боем.
func addCharacterCurrentEncounter(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS current_encounter_id UUID"); err != nil {
		return fmt.Errorf("addCharacterCurrentEncounter: %w", err)
	}
	return nil
}

// createEncounterTables — таблицы боя и его append-only журнала (см. models_encounter.go).
func createEncounterTables(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS encounters (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL DEFAULT 'Бой',
			owner_user_id UUID NOT NULL,
			member_user_ids JSONB,
			state JSONB,
			seq BIGINT NOT NULL DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS encounter_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			encounter_id UUID NOT NULL,
			seq BIGINT NOT NULL,
			payload JSONB,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)`,
		"CREATE INDEX IF NOT EXISTS idx_encounter_events_enc_seq ON encounter_events(encounter_id, seq)",
		"CREATE INDEX IF NOT EXISTS idx_encounters_owner ON encounters(owner_user_id)",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createEncounterTables: %w", err)
		}
	}
	return nil
}

func dropEncounterTables(db *sql.DB) error {
	for _, q := range []string{"DROP TABLE IF EXISTS encounter_events", "DROP TABLE IF EXISTS encounters"} {
		if _, err := db.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

// addEffectsRepeatable добавляет колонку repeatable к effects (по образцу feats.repeatable).
func addEffectsRepeatable(db *sql.DB) error {
	_, err := db.Exec("ALTER TABLE effects ADD COLUMN IF NOT EXISTS repeatable BOOLEAN DEFAULT false")
	return err
}

// widenActionsActionTypeCheck расширяет CHECK actions_action_type_check, добавляя
// species_ability (тип действия «Умение вида»). Раньше энум был 3-значным, и сохранение
// действия с новым типом падало 500. Значения синхронны с фронтом ACTION_TYPE_OPTIONS.
func widenActionsActionTypeCheck(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_action_type_check",
		"ALTER TABLE actions ADD CONSTRAINT actions_action_type_check CHECK (action_type IN ('base_action', 'class_feature', 'item_property', 'species_ability'))",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// restoreActionsActionTypeCheck возвращает исходный 3-значный CHECK. Откат сработает лишь
// если ни у одного действия нет action_type='species_ability' на этот момент.
func restoreActionsActionTypeCheck(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_action_type_check",
		"ALTER TABLE actions ADD CONSTRAINT actions_action_type_check CHECK (action_type IN ('base_action', 'class_feature', 'item_property'))",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// cardDamageTypeCheckValues — все 13 типов урона (физические + стихийные). Единый
// источник — frontend/src/utils/damageTypes.ts и Go-функция IsValidDamageType.
const cardDamageTypeCheckValues = "'bludgeoning', 'piercing', 'slashing', 'acid', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder'"

// widenCardsDamageTypeCheck расширяет устаревший CHECK cards_damage_type_check,
// который разрешал только физические типы (slashing/piercing/bludgeoning). Из-за него
// сохранение предмета со стихийным основным уроном (флакон кислоты, алхимический огонь)
// падало с 500. Теперь damage_type принимает все 13 типов урона либо NULL.
func widenCardsDamageTypeCheck(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_damage_type_check",
		fmt.Sprintf("ALTER TABLE cards ADD CONSTRAINT cards_damage_type_check CHECK (damage_type IN (%s) OR damage_type IS NULL)", cardDamageTypeCheckValues),
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// restoreCardsDamageTypeCheck возвращает исходный узкий CHECK (только физические типы).
// Откат сработает лишь если в damage_type нет стихийных значений на этот момент.
func restoreCardsDamageTypeCheck(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_damage_type_check",
		"ALTER TABLE cards ADD CONSTRAINT cards_damage_type_check CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning') OR damage_type IS NULL)",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// createConceptsTable заводит справочник «понятий» (глоссарий): пояснения, которые не
// выражаются отдельной сущностью (напр. «Спасбросок»). Понятие = slug + name + описание
// + иконка; на него ссылаются из текстов ([[label|concept:slug]]). Аналог переменных.
func createConceptsTable(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS concepts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			concept_id VARCHAR(100) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			image_url TEXT,
			sort_order INT DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`,
		"CREATE INDEX IF NOT EXISTS idx_concepts_concept_id ON concepts(concept_id)",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createConceptsTable: %w", err)
		}
	}
	return nil
}

// fixDashDisengageActions чистит дубли Рывок/Отход (ручные action_dash/disengage +
// нарративные action_basic_* из миграции 068) и заводит канонические базовые действия:
// Рывок — реальный модификатор +Скорость до начала следующего хода (движок применяет
// speed-модификаторы активных эффектов); Отход — нарративный. Оба type='basic', без uses.
func fixDashDisengageActions(db *sql.DB) error {
	del := `DELETE FROM actions WHERE card_number IN ('action_dash','action_disengage','action_basic_dash','action_basic_disengage')`
	if _, err := db.Exec(del); err != nil {
		return fmt.Errorf("fixDashDisengageActions: cleanup: %w", err)
	}

	type basicAction struct {
		cardNumber  string
		name        string
		imageURL    string
		description string
		mechanics   string
	}
	rows := []basicAction{
		{
			cardNumber:  "action_basic_dash",
			name:        "Рывок",
			imageURL:    "/icons/actions/dash.png",
			description: "Дополнительное перемещение, равное вашей Скорости, до начала вашего следующего хода.",
			mechanics:   `{"name":"Рывок","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"speed"},"op":"add","value":"character_speed","duration":{"type":"until_start_of_next_turn"}}]}],"targeting":{"shape":"self"}}`,
		},
		{
			cardNumber:  "action_basic_disengage",
			name:        "Отход",
			imageURL:    "/icons/actions/disengage.png",
			description: "До начала вашего следующего хода ваше перемещение не провоцирует атаки.",
			mechanics:   `{"name":"Отход","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Ваше перемещение не провоцирует атаки до начала следующего хода."}]}],"targeting":{"shape":"self"}}`,
		},
	}

	const q = `
		INSERT INTO actions (name, description, image_url, rarity, card_number, action_type, type, resource, mechanics, author, source)
		VALUES ($1, $2, $3, 'common', $4, 'base_action', 'basic', '', $5::jsonb, 'System', 'PHB 2024')
		ON CONFLICT (card_number) DO NOTHING`
	for _, r := range rows {
		if _, err := db.Exec(q, r.name, r.description, r.imageURL, r.cardNumber, r.mechanics); err != nil {
			return fmt.Errorf("fixDashDisengageActions: seed %s: %w", r.cardNumber, err)
		}
	}
	return nil
}

// addCardEnchantBonus заводит числовой магический бонус оружия (+N к броскам атаки и
// урона). Раньше «+1» жил только в имени карты («Молот мороза +1»); движок читает поле
// первым, а разбор имени оставлен запасным путём. Бэкфилл — разовый разбор имени.
func addCardEnchantBonus(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE cards ADD COLUMN IF NOT EXISTS enchant_bonus INT"); err != nil {
		return fmt.Errorf("addCardEnchantBonus: add column: %w", err)
	}
	// Бэкфилл: у оружия с «+N» в имени выставить enchant_bonus = N (первое вхождение).
	const q = `
		UPDATE cards
		SET enchant_bonus = CAST((regexp_match(name, '\+([0-9]+)'))[1] AS INT)
		WHERE type = 'weapon' AND enchant_bonus IS NULL AND name ~ '\+[0-9]+'`
	if _, err := db.Exec(q); err != nil {
		return fmt.Errorf("addCardEnchantBonus: backfill: %w", err)
	}
	return nil
}

// seedDashDisengageActions добавляет базовые действия Рывок и Отход. У движка пока нет
// модели перемещения/провокаций, поэтому эффекты — декларативный текст (как у Уклонения
// он auto). Идемпотентно: ON CONFLICT (card_number) ничего не делает.
func seedDashDisengageActions(db *sql.DB) error {
	type basicAction struct {
		cardNumber  string
		name        string
		imageURL    string
		description string
		mechanics   string
	}
	rows := []basicAction{
		{
			cardNumber:  "action_basic_dash",
			name:        "Рывок",
			imageURL:    "/icons/actions/dash.png",
			description: "Дополнительное перемещение, равное вашей Скорости, до конца этого хода.",
			mechanics:   `{"name":"Рывок","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Дополнительное перемещение, равное вашей Скорости, до конца хода."}]}],"targeting":{"shape":"self"}}`,
		},
		{
			cardNumber:  "action_basic_disengage",
			name:        "Отход",
			imageURL:    "/icons/actions/disengage.png",
			description: "До конца этого хода ваше перемещение не провоцирует атаки.",
			mechanics:   `{"name":"Отход","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Ваше перемещение не провоцирует атаки до конца хода."}]}],"targeting":{"shape":"self"}}`,
		},
	}

	const q = `
		INSERT INTO actions (name, description, image_url, rarity, card_number, action_type, type, resource, mechanics, author, source)
		VALUES ($1, $2, $3, 'common', $4, 'base_action', 'basic', '', $5::jsonb, 'System', 'PHB 2024')
		ON CONFLICT (card_number) DO NOTHING`

	for _, r := range rows {
		if _, err := db.Exec(q, r.name, r.description, r.imageURL, r.cardNumber, r.mechanics); err != nil {
			return fmt.Errorf("failed to seed basic action %s: %w", r.cardNumber, err)
		}
	}
	return nil
}

// dropSpellLegacyFields — снять с заклинаний легаси-поля детекции атаки/спасброска.
// Источник истины теперь — mechanics (parseMechanicsStats на фронте).
func dropSpellLegacyFields(db *sql.DB) error {
	for _, c := range []string{"attack_roll", "saving_throw", "save_types"} {
		if _, err := db.Exec("ALTER TABLE spells DROP COLUMN IF EXISTS " + c); err != nil {
			return fmt.Errorf("dropSpellLegacyFields: %w", err)
		}
	}
	return nil
}

// createVariablesTable заводит справочник переменных. Переменная сама по себе —
// name + type + default_value; конкретные значения задают ЭФФЕКТЫ (см.
// docs/variables.md). Сидим определения; значения по уровню ставят эффекты классов.
func createVariablesTable(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS variables (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			variable_id VARCHAR(100) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			var_type VARCHAR(20) DEFAULT 'number',
			default_value VARCHAR(100),
			image_url TEXT,
			sort_order INT DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`,
		"CREATE INDEX IF NOT EXISTS idx_variables_variable_id ON variables(variable_id)",
		`INSERT INTO variables (variable_id, name, description, var_type, default_value, sort_order)
		 VALUES
			('martial_arts_die', 'Кость боевых искусств', 'Кость безоружных ударов и приёмов монаха. Значение задаёт монах (1 ур. d6, далее растёт).', 'dice', '1d6', 10),
			('rage_damage_modifier', 'Бонус урона Ярости', 'Доп. урон рукопашных атак Силой в Ярости. Значение задаёт варвар (1 ур. 2, далее растёт).', 'number', '2', 20),
			('bardic_inspiration_die', 'Кость Вдохновения барда', 'Кость Вдохновения барда. Значение задаёт бард (1 ур. d6, далее растёт).', 'dice', '1d6', 30),
			('superiority_die', 'Кость превосходства', 'Кость приёмов Мастера боя. Значение задаёт подкласс (3 ур. d8, далее растёт).', 'dice', '1d8', 40),
			('superiority_dice_count', 'Число костей превосходства', 'Сколько костей превосходства доступно Мастеру боя. Значение задаёт подкласс.', 'number', '4', 41)
		 ON CONFLICT (variable_id) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description, var_type = EXCLUDED.var_type,
			default_value = EXCLUDED.default_value, sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createVariablesTable: %w", err)
		}
	}
	return nil
}

// createConditionsTable заводит справочник состояний (фаза D). Правило состояния —
// данные (data: self/projected-модификаторы + note), а не хардкод в движке. Сидим 13
// состояний PHB 2024 — те же self-модификаторы, что были в conditions.ts.
func createConditionsTable(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS conditions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			condition_id VARCHAR(100) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			data JSONB,
			image_url TEXT,
			sort_order INT DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`,
		"CREATE INDEX IF NOT EXISTS idx_conditions_condition_id ON conditions(condition_id)",
		`INSERT INTO conditions (condition_id, name, data, sort_order) VALUES
			('blinded','Ослеплён','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"disadvantage"}],"note":"Атаки по вам — с преимуществом; вы проваливаете проверки, требующие зрения."}'::jsonb,10),
			('charmed','Очарован','{"modifiers":[],"note":"Нельзя атаковать очаровавшего; у него преимущество на социальные проверки против вас."}'::jsonb,20),
			('deafened','Оглохший','{"modifiers":[],"note":"Вы проваливаете проверки, требующие слуха."}'::jsonb,30),
			('frightened','Испуган','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"disadvantage"},{"applies_to":{"roll":"ability_check"},"op":"disadvantage"}],"note":"Помеха, пока источник страха в поле зрения; нельзя приближаться к нему."}'::jsonb,40),
			('grappled','Схвачен','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"disadvantage"}],"note":"Скорость 0; помеха на атаки по всем, кроме схватившего."}'::jsonb,50),
			('incapacitated','Недееспособен','{"modifiers":[],"note":"Нет действий/бонусных действий/реакций; концентрация прервана; помеха на инициативу."}'::jsonb,60),
			('invisible','Невидим','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"advantage"}],"note":"Преимущество на инициативу; атаки по вам — с помехой."}'::jsonb,70),
			('paralyzed','Парализован','{"modifiers":[],"note":"Недееспособен; провал спасбросков СИЛ/ЛВК; атаки по вам с преимуществом, вблизи — крит."}'::jsonb,80),
			('poisoned','Отравлен','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"disadvantage"},{"applies_to":{"roll":"ability_check"},"op":"disadvantage"}]}'::jsonb,90),
			('prone','Распластан','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"disadvantage"}],"note":"Атаки по вам вблизи — с преимуществом, издалека — с помехой. Встать — половина скорости."}'::jsonb,100),
			('restrained','Опутан','{"modifiers":[{"applies_to":{"roll":"attack"},"op":"disadvantage"},{"applies_to":{"roll":"saving_throw","filter":{"ability":"dex"}},"op":"disadvantage"}],"note":"Скорость 0; атаки по вам — с преимуществом."}'::jsonb,110),
			('stunned','Ошеломлён','{"modifiers":[],"note":"Недееспособен; провал спасбросков СИЛ/ЛВК; атаки по вам — с преимуществом."}'::jsonb,120),
			('unconscious','Без сознания','{"modifiers":[],"note":"Недееспособен, распластан; провал СИЛ/ЛВК; атаки по вам с преимуществом, вблизи — крит."}'::jsonb,130)
		 ON CONFLICT (condition_id) DO UPDATE SET
			name = EXCLUDED.name, data = EXCLUDED.data, sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createConditionsTable: %w", err)
		}
	}
	return nil
}

// conditionsAsEffects — унификация: состояние теперь ЭФФЕКТ (effect_type='condition') со
// scoped-модификаторами в mechanics (scope:'self' — на носителя, scope:'target' — проекция
// на атакующего, «преимущество атак по носителю» как ДАННЫЕ). Таблица conditions снимается.
func conditionsAsEffects(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE effects DROP CONSTRAINT IF EXISTS effects_effect_type_check",
		fmt.Sprintf("ALTER TABLE effects ADD CONSTRAINT effects_effect_type_check CHECK (effect_type IN (%s))", effectTypeCheckValues),
		`INSERT INTO effects (name, description, card_number, effect_type, rarity, mechanics) VALUES
			('Ослеплён','Вы проваливаете проверки, требующие зрения.','COND-blinded','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"attack"},"op":"advantage","scope":"target"}]}]}'::jsonb),
			('Очарован','Нельзя атаковать очаровавшего; у него преимущество на социальные проверки против вас.','COND-charmed','condition','common','{"effects":[{"resolution":"auto","result":[]}]}'::jsonb),
			('Оглохший','Вы проваливаете проверки, требующие слуха.','COND-deafened','condition','common','{"effects":[{"resolution":"auto","result":[]}]}'::jsonb),
			('Испуган','Помеха, пока источник страха в поле зрения; нельзя приближаться к нему.','COND-frightened','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"ability_check"},"op":"disadvantage"}]}]}'::jsonb),
			('Схвачен','Скорость 0; помеха на атаки по всем, кроме схватившего.','COND-grappled','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"speed"},"op":"set","value":"0"}]}]}'::jsonb),
			('Недееспособен','Нет действий/бонусных действий/реакций; концентрация прервана; помеха на инициативу.','COND-incapacitated','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"initiative"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"action"},"op":"deny"},{"kind":"modifier","applies_to":{"roll":"bonus_action"},"op":"deny"},{"kind":"modifier","applies_to":{"roll":"reaction"},"op":"deny"},{"kind":"modifier","applies_to":{"roll":"concentration"},"op":"deny"}]}]}'::jsonb),
			('Невидим','Преимущество на инициативу.','COND-invisible','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"advantage"},{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage","scope":"target"},{"kind":"modifier","applies_to":{"roll":"initiative"},"op":"advantage"}]}]}'::jsonb),
			('Парализован','Недееспособен; провал спасбросков СИЛ/ЛВК; атаки по вам вблизи — крит.','COND-paralyzed','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"advantage","scope":"target"},{"kind":"modifier","applies_to":{"roll":"speed"},"op":"set","value":"0"},{"kind":"modifier","applies_to":{"roll":"saving_throw","filter":{"ability":"str"}},"op":"auto_fail"},{"kind":"modifier","applies_to":{"roll":"saving_throw","filter":{"ability":"dex"}},"op":"auto_fail"},{"kind":"modifier","applies_to":{"roll":"attack"},"op":"auto_crit","scope":"target","range":"melee"}]}],"includes":["incapacitated"]}'::jsonb),
			('Отравлен','','COND-poisoned','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"ability_check"},"op":"disadvantage"}]}]}'::jsonb),
			('Распластан','Атаки по вам вблизи — с преимуществом, издалека — с помехой (зависит от дальности). Встать — половина скорости.','COND-prone','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"attack"},"op":"advantage","scope":"target","range":"melee"},{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage","scope":"target","range":"ranged"}]}]}'::jsonb),
			('Опутан','Скорость 0.','COND-restrained','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"saving_throw","filter":{"ability":"dex"}},"op":"disadvantage"},{"kind":"modifier","applies_to":{"roll":"attack"},"op":"advantage","scope":"target"},{"kind":"modifier","applies_to":{"roll":"speed"},"op":"set","value":"0"}]}]}'::jsonb),
			('Ошеломлён','Недееспособен; провал спасбросков СИЛ/ЛВК.','COND-stunned','condition','common','{"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack"},"op":"advantage","scope":"target"},{"kind":"modifier","applies_to":{"roll":"saving_throw","filter":{"ability":"str"}},"op":"auto_fail"},{"kind":"modifier","applies_to":{"roll":"saving_throw","filter":{"ability":"dex"}},"op":"auto_fail"}]}],"includes":["incapacitated"]}'::jsonb),
			('Без сознания','Недееспособен, распластан; провал СИЛ/ЛВК; атаки по вам вблизи — крит.','COND-unconscious','condition','common','{"effects":[{"resolution":"auto","result":[]}],"includes":["prone","paralyzed"],"leaves":["prone"]}'::jsonb)
		 ON CONFLICT (card_number) DO UPDATE SET
			name=EXCLUDED.name, description=EXCLUDED.description, effect_type=EXCLUDED.effect_type, mechanics=EXCLUDED.mechanics`,
		"DROP TABLE IF EXISTS conditions CASCADE",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("conditionsAsEffects: %w", err)
		}
	}
	return nil
}

// seedBasicActions заводит базовые боевые действия PHB как обычные редактируемые
// сущности Action (type='basic'), чтобы владелец мог менять их текст/иконку/механику
// без перевыкатки. Идемпотентно: ON CONFLICT (card_number) ничего не делает.
func seedBasicActions(db *sql.DB) error {
	type basicAction struct {
		cardNumber  string
		name        string
		imageURL    string
		description string
		mechanics   string
	}
	rows := []basicAction{
		{
			cardNumber:  "action_basic_unarmed",
			name:        "Безоружный удар",
			imageURL:    "/icons/actions/unarmed_strike.png",
			description: "Атака кулаком, ногой, головой и т.п. Урон: 1 + модификатор Силы (дробящий); альтернативно можно Схватить или Толкнуть цель.",
			mechanics:   `{"name":"Безоружный удар","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"ability":"str","attack_kind":"unarmed","resolution":"attack_roll","vs":"ac","on_hit":[{"amount":"1 + str","kind":"damage","type":"bludgeoning"}]}],"targeting":{"filter":"enemy","range":"5 feet","shape":"single"}}`,
		},
		{
			cardNumber:  "action_basic_weapon",
			name:        "Атака оружием",
			imageURL:    "/icons/actions/weapon_attack.png",
			description: "Атака надетым оружием ближнего или дальнего боя. Бонус атаки и урон — по характеристике оружия и бонусу мастерства.",
			mechanics:   `{"name":"Атака оружием","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"ability":"auto","attack_kind":"weapon_melee","resolution":"attack_roll","vs":"ac","on_hit":[{"ability":"auto","dice":"weapon","kind":"damage","type":"weapon"}]}],"targeting":{"filter":"enemy","range":"weapon","shape":"single"}}`,
		},
		{
			cardNumber:  "action_basic_offhand",
			name:        "Атака второй рукой",
			imageURL:    "/icons/actions/offhand_attack.png",
			description: "Бой двумя оружиями: бонусным действием атаковать вторым лёгким оружием в другой руке. Без модификатора характеристики к урону (если нет соответствующей черты).",
			mechanics:   `{"name":"Атака второй рукой","activation":{"cost":[{"resource":"bonus_action"}],"mode":"active"},"effects":[{"ability":"auto","attack_kind":"weapon_melee","resolution":"attack_roll","vs":"ac","tags":["off_hand","two_weapon"],"on_hit":[{"ability":"none","dice":"weapon","kind":"damage","type":"weapon"}]}],"targeting":{"filter":"enemy","range":"weapon","shape":"single"}}`,
		},
		{
			cardNumber:  "action_basic_dodge",
			name:        "Уклонение",
			imageURL:    "/icons/actions/dodge.png",
			description: "До начала следующего хода атаки по вам совершаются с помехой, а спасброски Ловкости — с преимуществом (если вы видите атакующего и не обездвижены).",
			mechanics:   `{"name":"Уклонение","activation":{"cost":[{"resource":"action"}],"mode":"active"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","applies_to":{"roll":"attack","filter":{"against":"self"}},"op":"disadvantage","duration":{"type":"until_start_of_next_turn"}},{"kind":"modifier","applies_to":{"roll":"saving_throw","filter":{"ability":"dex"}},"op":"advantage","duration":{"type":"until_start_of_next_turn"}}]}],"targeting":{"shape":"self"}}`,
		},
	}

	const q = `
		INSERT INTO actions (name, description, image_url, rarity, card_number, action_type, type, resource, mechanics, author, source)
		VALUES ($1, $2, $3, 'common', $4, 'base_action', 'basic', '', $5::jsonb, 'System', 'PHB 2024')
		ON CONFLICT (card_number) DO NOTHING`

	for _, r := range rows {
		if _, err := db.Exec(q, r.name, r.description, r.imageURL, r.cardNumber, r.mechanics); err != nil {
			return fmt.Errorf("failed to seed basic action %s: %w", r.cardNumber, err)
		}
	}
	return nil
}

// addClassEquipmentOptions добавляет классам варианты стартового снаряжения
// {option_a,option_b,option_c} по образцу equipment_options предысторий.
func addClassEquipmentOptions(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE classes ADD COLUMN IF NOT EXISTS equipment_options JSONB"); err != nil {
		return fmt.Errorf("addClassEquipmentOptions: %w", err)
	}
	return nil
}

// addClassSubclasses добавляет классам поля подкласса по паттерну подвидов рас.
func addClassSubclasses(db *sql.DB) error {
	stmts := []string{
		"ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_subclass BOOLEAN DEFAULT false",
		"ALTER TABLE classes ADD COLUMN IF NOT EXISTS parent_class_id UUID",
		"CREATE INDEX IF NOT EXISTS idx_classes_parent ON classes(parent_class_id)",
		"ALTER TABLE classes ADD COLUMN IF NOT EXISTS subclass_level INT DEFAULT 3",
		"ALTER TABLE classes ADD COLUMN IF NOT EXISTS related_effects JSONB",
		"ALTER TABLE classes ADD COLUMN IF NOT EXISTS related_actions JSONB",
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("addClassSubclasses: %w", err)
		}
	}
	return nil
}

// addResourceSpentImage добавляет ресурсам изображение потраченного заряда.
func addResourceSpentImage(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE resources ADD COLUMN IF NOT EXISTS image_url_spent TEXT"); err != nil {
		return fmt.Errorf("addResourceSpentImage: %w", err)
	}
	return nil
}

// addCardMechanics добавляет предметам унифицированную механику.
func addCardMechanics(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE cards ADD COLUMN IF NOT EXISTS mechanics JSONB"); err != nil {
		return fmt.Errorf("addCardMechanics: %w", err)
	}
	return nil
}

// addSpellMechanics добавляет заклинаниям унифицированную механику (как у effects/actions).
func addSpellMechanics(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE spells ADD COLUMN IF NOT EXISTS mechanics JSONB"); err != nil {
		return fmt.Errorf("addSpellMechanics: %w", err)
	}
	return nil
}

// addClassRecommendedAbilities добавляет классам оптимальный point-buy расклад характеристик.
func addClassRecommendedAbilities(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE classes ADD COLUMN IF NOT EXISTS recommended_abilities JSONB"); err != nil {
		return fmt.Errorf("addClassRecommendedAbilities: %w", err)
	}
	return nil
}

// addSubraceLevel добавляет виду уровень, на котором выбирается подвид (по умолчанию 1).
func addSubraceLevel(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE races ADD COLUMN IF NOT EXISTS subrace_level INT DEFAULT 1"); err != nil {
		return fmt.Errorf("addSubraceLevel: %w", err)
	}
	return nil
}

// migrateLegacySubraces превращает legacy-подвиды (choice source:subfeature внутри
// эффекта вида) в самостоятельные виды-подвиды (is_subrace + parent_race_id) с
// эффектом, несущим те же гранты (level_gate сохраняется). Идемпотентна:
// эффект родителя правится последним, вставки — ON CONFLICT.
func migrateLegacySubraces(db *sql.DB) error {
	targets := []struct {
		parentCard string
		effectCard string
		choiceID   string
		level      int
	}{
		{"RACE-0004", "RE-elf-4", "elf_lineage", 1},
		{"RACE-0005", "RE-gnome-3", "gnome_lineage", 1},
		{"RACE-0009", "RE-tiefling-3", "fiendish_legacy", 1},
		{"RACE-0010", "RE-aasimar-5", "celestial_revelation", 3},
		{"RACE-0011", "RE-goliath-1", "giant_ancestry", 1},
	}
	for _, t := range targets {
		if err := migrateOneLineage(db, t.parentCard, t.effectCard, t.choiceID, t.level); err != nil {
			return fmt.Errorf("migrateLegacySubraces %s: %w", t.parentCard, err)
		}
	}
	return nil
}

func choiceItems(node map[string]interface{}) []interface{} {
	opts, _ := node["options"].(map[string]interface{})
	if opts == nil {
		return nil
	}
	items, _ := opts["items"].([]interface{})
	return items
}

func migrateOneLineage(db *sql.DB, parentCard, effectCard, choiceID string, level int) error {
	var parentID string
	err := db.QueryRow("SELECT id FROM races WHERE card_number=$1 AND deleted_at IS NULL", parentCard).Scan(&parentID)
	if err == sql.ErrNoRows {
		return nil // нет данных (свежая/локальная БД) — пропускаем
	}
	if err != nil {
		return err
	}
	if _, err := db.Exec("UPDATE races SET subrace_level=$1 WHERE id=$2", level, parentID); err != nil {
		return err
	}

	var effectID string
	var mechRaw []byte
	err = db.QueryRow("SELECT id, mechanics FROM effects WHERE card_number=$1 AND deleted_at IS NULL", effectCard).Scan(&effectID, &mechRaw)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	var mech map[string]interface{}
	if err := json.Unmarshal(mechRaw, &mech); err != nil {
		return nil // не разобрать — пропускаем
	}

	effList, _ := mech["effects"].([]interface{})
	newEff := make([]interface{}, 0, len(effList))
	var items []interface{}
	found := false
	for _, raw := range effList {
		node, _ := raw.(map[string]interface{})
		if node == nil {
			newEff = append(newEff, raw)
			continue
		}
		if node["kind"] == "choice" && node["id"] == choiceID {
			items = choiceItems(node)
			found = true
			continue // вырезаем choice
		}
		if node["resolution"] == "auto" {
			res, _ := node["result"].([]interface{})
			newRes := make([]interface{}, 0, len(res))
			for _, pr := range res {
				p, _ := pr.(map[string]interface{})
				if p != nil && p["kind"] == "choice" && p["id"] == choiceID {
					items = choiceItems(p)
					found = true
					continue
				}
				newRes = append(newRes, pr)
			}
			node["result"] = newRes
		}
		newEff = append(newEff, node)
	}
	if !found {
		return nil // уже мигрировано
	}

	// Создаём подвиды ДО правки родительского эффекта (идемпотентность/устойчивость).
	for _, it := range items {
		item, _ := it.(map[string]interface{})
		if item == nil {
			continue
		}
		subID, _ := item["id"].(string)
		subName, _ := item["name"].(string)
		grants, _ := item["grants"].([]interface{})
		if subID == "" {
			continue
		}
		if grants == nil {
			grants = []interface{}{}
		}
		subMech := map[string]interface{}{
			"activation": map[string]interface{}{"mode": "passive"},
			"effects": []interface{}{
				map[string]interface{}{"resolution": "auto", "result": grants},
			},
		}
		subMechJSON, _ := json.Marshal(subMech)

		var subEffectID string
		err := db.QueryRow(`INSERT INTO effects (name, description, card_number, effect_type, rarity, mechanics)
			VALUES ($1,$2,$3,'species_ability','common',$4)
			ON CONFLICT (card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics
			RETURNING id`, subName, subName, "RE-sub-"+subID, subMechJSON).Scan(&subEffectID)
		if err != nil {
			return err
		}
		relJSON, _ := json.Marshal([]string{subEffectID})
		if _, err := db.Exec(`INSERT INTO races (name, description, card_number, rarity, is_subrace, parent_race_id, subrace_level, related_effects)
			VALUES ($1,$2,$3,'common', true, $4, 1, $5)
			ON CONFLICT (card_number) DO UPDATE SET parent_race_id=EXCLUDED.parent_race_id, related_effects=EXCLUDED.related_effects, is_subrace=true`,
			subName, subName, "sub-"+subID, parentID, relJSON); err != nil {
			return err
		}
	}

	mech["effects"] = newEff
	newMechJSON, _ := json.Marshal(mech)
	if _, err := db.Exec("UPDATE effects SET mechanics=$1 WHERE id=$2", newMechJSON, effectID); err != nil {
		return err
	}
	return nil
}

// seedElfSubraceContent заполняет описание и черты подвидов «Дроу» и «Лесной эльф»
// по образцу «Высший эльф» (PHB 2024). Идемпотентна.
func seedElfSubraceContent(db *sql.DB) error {
	type subraceContent struct {
		cardNumber  string
		description string
		traits      []map[string]string
		effectDesc  string
	}
	entries := []subraceContent{
		{
			cardNumber:  "sub-drow",
			description: "Дроу обычно обитают в Подземье, и оно сформировало их магию. Некоторые дроу избегают Подземья, но всё равно несут его магию в себе.",
			effectDesc:  "Магия подвида дроу: расширенное тёмное зрение и заклинания Подземья.",
			traits: []map[string]string{
				{
					"name":        "Пляшущие огоньки",
					"description": "Дальность вашего тёмного зрения увеличивается до 120 футов. Вы также узнаёте заговор __Пляшущие огоньки__.",
				},
				{
					"name":        "Огонь фей",
					"description": "На 3-ем уровне вы узнаёте заклинание __Огонь фей__. Вы можете использовать его один раз до Долгого отдыха.",
				},
				{
					"name":        "Тьма",
					"description": "На 5-ом уровне вы узнаёте заклинание __Тьма__. Вы можете использовать его один раз до Долгого отдыха.",
				},
			},
		},
		{
			cardNumber:  "sub-wood_elf",
			description: "Лесные эльфы носят в себе магию первобытных лесов. Их также называют дикими, зелёными или лесными эльфами.",
			effectDesc:  "Магия подвида лесного эльфа: повышенная скорость и следопытские заклинания.",
			traits: []map[string]string{
				{
					"name":        "Лесная стремительность",
					"description": "Ваша скорость передвижения увеличивается до 35 футов. Вы также узнаёте заговор __Друидизм__.",
				},
				{
					"name":        "Скороход",
					"description": "На 3-ем уровне вы узнаёте заклинание __Скороход__. Вы можете использовать его один раз до Долгого отдыха.",
				},
				{
					"name":        "Бесследное передвижение",
					"description": "На 5-ом уровне вы узнаёте заклинание __Бесследное передвижение__. Вы можете использовать его один раз до Долгого отдыха.",
				},
			},
		},
	}
	for _, e := range entries {
		traitsJSON, err := json.Marshal(e.traits)
		if err != nil {
			return fmt.Errorf("seedElfSubraceContent %s traits: %w", e.cardNumber, err)
		}
		res, err := db.Exec(
			`UPDATE races SET description=$1, traits=$2::jsonb WHERE card_number=$3 AND deleted_at IS NULL`,
			e.description, string(traitsJSON), e.cardNumber,
		)
		if err != nil {
			return fmt.Errorf("seedElfSubraceContent %s: %w", e.cardNumber, err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue // подвид ещё не создан — пропускаем
		}
		if _, err := db.Exec(
			`UPDATE effects SET description=$1 WHERE card_number=$2 AND deleted_at IS NULL`,
			e.effectDesc, "RE-"+e.cardNumber,
		); err != nil {
			return fmt.Errorf("seedElfSubraceContent effect %s: %w", e.cardNumber, err)
		}
	}
	return nil
}

// seedDragonbornSubraces создаёт 10 подвидов драконорождённого (PHB 2024).
// Каждый подвид: сопротивление типу урона + действие «Оружие дыхания» (общее).
// У родителя RACE-0008 убираются legacy lineages и переносимые на подвиды ссылки.
func seedDragonbornSubraces(db *sql.DB) error {
	var parentID string
	err := db.QueryRow("SELECT id FROM races WHERE card_number=$1 AND deleted_at IS NULL", "RACE-0008").Scan(&parentID)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}

	var breathActionID string
	err = db.QueryRow("SELECT id FROM actions WHERE card_number=$1 AND deleted_at IS NULL", "ACT-breath-weapon").Scan(&breathActionID)
	if err == sql.ErrNoRows {
		return nil // нет действия — пропускаем
	}
	if err != nil {
		return err
	}

	type ancestry struct {
		slug        string
		name        string
		description string
		damageType  string
		resistRu    string
		breathRu    string
	}
	entries := []ancestry{
		{"black", "Чёрный", "Ваши предки — чёрные драконы, чья магия связана с кислотой и разложением.", "acid", "кислоте", "Кислотное"},
		{"brass", "Латунный", "Ваши предки — латунные драконы пустынь, повелители огня и жары.", "fire", "огню", "Огненное"},
		{"bronze", "Бронзовый", "Ваши предки — бронзовые драконы морей, чья стихия — молния и шторм.", "lightning", "молнии", "Электрическое"},
		{"copper", "Медный", "Ваши предки — медные драконы холмов, хранители кислотных источников.", "acid", "кислоте", "Кислотное"},
		{"gold", "Золотой", "Ваши предки — золотые драконы, символы мудрости и пламени.", "fire", "огню", "Огненное"},
		{"green", "Зелёный", "Ваши предки — зелёные драконы лесов, чья магия отравлена и коварна.", "poison", "яду", "Ядовитое"},
		{"red", "Красный", "Ваши предки — красные драконы, повелители огня и сокровищ.", "fire", "огню", "Огненное"},
		{"silver", "Серебряный", "Ваши предки — серебряные драконы, стражи холодных вершин.", "cold", "холоду", "Холодное"},
		{"white", "Белый", "Ваши предки — белые драконы ледяных пустошей.", "cold", "холоду", "Холодное"},
		{"blue", "Синий", "Ваши предки — синие драконы пустынь, чья магия — молния и гром.", "lightning", "молнии", "Электрическое"},
	}

	for _, e := range entries {
		subMech := map[string]interface{}{
			"activation": map[string]interface{}{"mode": "passive"},
			"effects": []interface{}{
				map[string]interface{}{
					"resolution": "auto",
					"result": []interface{}{
						map[string]interface{}{
							"kind":        "resistance",
							"damage_type": e.damageType,
							"value":       "resistance",
						},
					},
				},
			},
		}
		subMechJSON, err := json.Marshal(subMech)
		if err != nil {
			return fmt.Errorf("seedDragonbornSubraces %s mechanics: %w", e.slug, err)
		}

		var subEffectID string
		effectName := "Сопротивление: " + e.name
		err = db.QueryRow(`INSERT INTO effects (name, description, card_number, effect_type, rarity, mechanics)
			VALUES ($1,$2,$3,'species_ability','common',$4)
			ON CONFLICT (card_number) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, mechanics=EXCLUDED.mechanics
			RETURNING id`, effectName, "Сопротивление урону "+e.resistRu+".", "RE-sub-"+e.slug, subMechJSON).Scan(&subEffectID)
		if err != nil {
			return fmt.Errorf("seedDragonbornSubraces effect %s: %w", e.slug, err)
		}

		traits := []map[string]string{
			{
				"name":        "Оружие дыхания",
				"description": e.breathRu + " дыхание. Вы получаете способность __Оружие дыхания__ (число использований = бонус мастерства за Долгий отдых).",
			},
			{
				"name":        "Сопротивление урону",
				"description": "Вы обладаете сопротивлением урону " + e.resistRu + ".",
			},
		}
		traitsJSON, err := json.Marshal(traits)
		if err != nil {
			return fmt.Errorf("seedDragonbornSubraces %s traits: %w", e.slug, err)
		}

		relEffJSON, _ := json.Marshal([]string{subEffectID})
		relActJSON, _ := json.Marshal([]string{breathActionID})
		_, err = db.Exec(`INSERT INTO races (name, description, card_number, rarity, is_subrace, parent_race_id, subrace_level, related_effects, related_actions, traits)
			VALUES ($1,$2,$3,'common', true, $4, 1, $5, $6, $7)
			ON CONFLICT (card_number) DO UPDATE SET
				name=EXCLUDED.name,
				description=EXCLUDED.description,
				parent_race_id=EXCLUDED.parent_race_id,
				related_effects=EXCLUDED.related_effects,
				related_actions=EXCLUDED.related_actions,
				traits=EXCLUDED.traits,
				is_subrace=true`,
			e.name, e.description, "sub-"+e.slug, parentID, string(relEffJSON), string(relActJSON), string(traitsJSON))
		if err != nil {
			return fmt.Errorf("seedDragonbornSubraces race %s: %w", e.slug, err)
		}
	}

	if err := trimDragonbornParentRefs(db, parentID); err != nil {
		return err
	}
	if _, err := db.Exec(`UPDATE races SET subrace_level=1, lineages='[]'::jsonb WHERE id=$1`, parentID); err != nil {
		return fmt.Errorf("seedDragonbornSubraces parent: %w", err)
	}
	return nil
}

func trimDragonbornParentRefs(db *sql.DB, parentID string) error {
	excludeIDs := map[string]struct{}{}
	for _, cn := range []string{"RE-dragonborn-2", "RE-dragonborn-3"} {
		var id string
		err := db.QueryRow("SELECT id FROM effects WHERE card_number=$1 AND deleted_at IS NULL", cn).Scan(&id)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		excludeIDs[id] = struct{}{}
	}
	var breathID string
	err := db.QueryRow("SELECT id FROM actions WHERE card_number=$1 AND deleted_at IS NULL", "ACT-breath-weapon").Scan(&breathID)
	if err == nil {
		excludeIDs[breathID] = struct{}{}
	} else if err != sql.ErrNoRows {
		return err
	}

	var relEffRaw, relActRaw []byte
	if err := db.QueryRow("SELECT related_effects, related_actions FROM races WHERE id=$1", parentID).Scan(&relEffRaw, &relActRaw); err != nil {
		return err
	}

	filter := func(raw []byte) ([]byte, error) {
		if len(raw) == 0 {
			return []byte("[]"), nil
		}
		var ids []string
		if err := json.Unmarshal(raw, &ids); err != nil {
			return nil, err
		}
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			if _, skip := excludeIDs[id]; !skip {
				out = append(out, id)
			}
		}
		return json.Marshal(out)
	}

	newEff, err := filter(relEffRaw)
	if err != nil {
		return err
	}
	newAct, err := filter(relActRaw)
	if err != nil {
		return err
	}
	_, err = db.Exec("UPDATE races SET related_effects=$1::jsonb, related_actions=$2::jsonb WHERE id=$3", string(newEff), string(newAct), parentID)
	return err
}

// addRaceSubrace добавляет видам флаг подвида и ссылку на родительский вид.
func addRaceSubrace(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE races ADD COLUMN IF NOT EXISTS is_subrace BOOLEAN DEFAULT false",
		"ALTER TABLE races ADD COLUMN IF NOT EXISTS parent_race_id UUID",
		"CREATE INDEX IF NOT EXISTS idx_races_parent ON races(parent_race_id)",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("addRaceSubrace: %w", err)
		}
	}
	return nil
}

// addSpellResources добавляет заклинаниям список ресурсов (несколько одновременно).
func addSpellResources(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE spells ADD COLUMN IF NOT EXISTS resources JSONB"); err != nil {
		return fmt.Errorf("addSpellResources: %w", err)
	}
	return nil
}

// addCharacterRuntimeFields — runtime-состояние персонажа v3 (фаза C1).
func addCharacterRuntimeFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS equipment JSONB DEFAULT '{}'::jsonb",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS inventory_items JSONB DEFAULT '[]'::jsonb",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS resources JSONB DEFAULT '{}'::jsonb",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS max_resources JSONB DEFAULT '{}'::jsonb",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS active_effects JSONB DEFAULT '[]'::jsonb",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS turn_state JSONB DEFAULT '{}'::jsonb",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS currency JSONB DEFAULT '{}'::jsonb",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("addCharacterRuntimeFields: %w", err)
		}
	}
	return nil
}
func createCharacterEventsTable(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS character_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			character_id UUID NOT NULL REFERENCES characters_v3(id) ON DELETE CASCADE,
			ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
			type VARCHAR(64) NOT NULL,
			payload JSONB NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)`,
		"CREATE INDEX IF NOT EXISTS idx_character_events_character_ts ON character_events(character_id, ts DESC)",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createCharacterEventsTable: %w", err)
		}
	}
	return nil
}

const effectTypeCheckValues = "'passive', 'conditional', 'triggered', 'species_ability', 'class_ability', 'feat_ability', 'item_effect', 'spell_effect', 'negative_effect', 'positive_effect', 'condition'"

func expandEffectTypes(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE effects DROP CONSTRAINT IF EXISTS effects_effect_type_check",
		fmt.Sprintf("ALTER TABLE effects ADD CONSTRAINT effects_effect_type_check CHECK (effect_type IN (%s))", effectTypeCheckValues),
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("expandEffectTypes: %w", err)
		}
	}
	return nil
}

func createResourcesTable(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS resources (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			resource_id VARCHAR(100) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			category VARCHAR(50) DEFAULT 'character',
			image_url TEXT,
			recharge VARCHAR(50),
			sort_order INT DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`,
		"CREATE INDEX IF NOT EXISTS idx_resources_resource_id ON resources(resource_id)",
		"CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category)",
		`INSERT INTO resources (resource_id, name, description, category, image_url, recharge, sort_order)
		 VALUES
			('action', 'Действие', 'Основное действие в ход.', 'action_cost', '/charges/main_action.png', 'per_turn', 10),
			('main_action', 'Основное действие', 'Основное действие в ход.', 'action_cost', '/charges/main_action.png', 'per_turn', 11),
			('bonus_action', 'Бонусное действие', 'Бонусное действие в ход.', 'action_cost', '/charges/bonus_action.png', 'per_turn', 20),
			('reaction', 'Реакция', 'Ответное действие до начала вашего следующего хода.', 'action_cost', '/charges/reaction_action.png', 'per_round', 30),
			('free_action', 'Свободное действие', 'Не тратит основной ресурс действия.', 'action_cost', '/charges/free_action.png', 'per_turn', 40),
			('rage_charge', 'Заряд ярости', 'Расходуется для входа в ярость.', 'class_resource', '/charges/rage_charge.png', 'long_rest', 100),
			('heroic_inspiration', 'Героическое вдохновение', 'Можно потратить для переброса.', 'character_resource', '/charges/main_action.png', 'long_rest', 110)
		 ON CONFLICT (resource_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			category = EXCLUDED.category,
			image_url = EXCLUDED.image_url,
			recharge = EXCLUDED.recharge,
			sort_order = EXCLUDED.sort_order,
			updated_at = NOW()`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createResourcesTable: %w", err)
		}
	}
	return nil
}

// updateWizardSpellChoices переводит заклинания волшебника на rule-driven choices.
func updateWizardSpellChoices(db *sql.DB) error {
	spellcastingMech := `{
		"activation": {"mode": "passive"},
		"effects": [
			{"resolution": "auto", "result": [
				{"kind": "narrative", "description": "Подготовка заклинаний из книги заклинаний. INT — характеристика заклинаний."}
			]},
			{
				"kind": "choice",
				"id": "wizard_cantrips",
				"prompt": "Выберите 3 заговора волшебника",
				"count": 3,
				"options": {"source": "spell", "filter": {"classes": ["wizard"], "levels": [0]}},
				"grant": {"kind": "grant_spell", "label": "cantrip"},
				"resolution": "on_acquire"
			},
			{
				"kind": "choice",
				"id": "wizard_spellbook_level_1",
				"prompt": "Выберите 6 заклинаний 1 уровня в книгу заклинаний",
				"count": 6,
				"options": {"source": "spell", "filter": {"classes": ["wizard"], "levels": [1]}},
				"grant": {"kind": "grant_spell", "label": "spellbook"},
				"resolution": "on_acquire"
			}
		]
	}`
	_, err := db.Exec(`
		UPDATE effects
		SET mechanics = $1::jsonb, updated_at = NOW()
		WHERE card_number = 'EFF-wizard-spellcasting' AND deleted_at IS NULL
	`, spellcastingMech)
	if err != nil {
		return fmt.Errorf("updateWizardSpellChoices: %w", err)
	}
	return nil
}

// addCharacterRuleStateFields добавляет снимок резолюции правил и быстрые derived-поля.
func addCharacterRuleStateFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS skill_expertise JSONB",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS tool_expertise JSONB",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS rule_state JSONB",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS armor_class INT DEFAULT 10",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS initiative_bonus INT DEFAULT 0",
		"ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS passive_perception INT DEFAULT 10",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("addCharacterRuleStateFields: %w", err)
		}
	}
	return nil
}

// addFeatRelatedAbilities добавляет привязку эффектов/действий к чертам (как у видов).
func addFeatRelatedAbilities(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE feats ADD COLUMN IF NOT EXISTS related_effects JSONB",
		"ALTER TABLE feats ADD COLUMN IF NOT EXISTS related_actions JSONB",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("addFeatRelatedAbilities: %w", err)
		}
	}
	return nil
}

// createCharactersV3Table создаёт таблицу персонажей V3.
// Все массивы/объекты — JSONB (никогда text[]).
func createCharactersV3Table(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS characters_v3 (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL,
			group_id UUID,
			name VARCHAR(255) NOT NULL,
			avatar_url TEXT,
			race_id UUID,
			lineage_id VARCHAR(100),
			class_id UUID,
			background_id UUID,
			level INT NOT NULL DEFAULT 1,
			feat_ids JSONB,
			spell_ids JSONB,
			abilities JSONB,
			skill_proficiencies JSONB,
			skill_expertise JSONB,
			saving_throw_proficiencies JSONB,
			tool_proficiencies JSONB,
			tool_expertise JSONB,
			languages JSONB,
			resolved_choices JSONB,
			rule_state JSONB,
			max_hp INT DEFAULT 0,
			current_hp INT DEFAULT 0,
			speed INT DEFAULT 30,
			proficiency_bonus INT DEFAULT 2,
			armor_class INT DEFAULT 10,
			initiative_bonus INT DEFAULT 0,
			passive_perception INT DEFAULT 10,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)`,
		"CREATE INDEX IF NOT EXISTS idx_characters_v3_user_id ON characters_v3(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_characters_v3_created_at ON characters_v3(created_at DESC)",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createCharactersV3Table: %w", err)
		}
	}
	return nil
}

// createRacesTable создаёт таблицу видов (рас)
func createRacesTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS races (
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
			creature_type VARCHAR(100),
			size VARCHAR(100),
			speed INTEGER,
			extra_speeds TEXT,
			darkvision INTEGER,
			traits JSONB,
			lineages JSONB,
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags JSONB,
			is_extended BOOLEAN DEFAULT false,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create races table: %w", err)
	}
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_races_card_number ON races(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_races_created_at ON races(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_races_deleted_at ON races(deleted_at) WHERE deleted_at IS NOT NULL",
	}
	for _, q := range indexes {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("failed to create index for races: %w", err)
		}
	}
	return nil
}

func addMechanicsAndRaceAbilities(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE effects ADD COLUMN IF NOT EXISTS mechanics JSONB",
		"ALTER TABLE actions ADD COLUMN IF NOT EXISTS mechanics JSONB",
		"ALTER TABLE races ADD COLUMN IF NOT EXISTS related_effects JSONB",
		"ALTER TABLE races ADD COLUMN IF NOT EXISTS related_actions JSONB",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("addMechanicsAndRaceAbilities: %w", err)
		}
	}
	return nil
}

func createClassesAndRaceProgression(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE races ADD COLUMN IF NOT EXISTS level_progression JSONB",
		`CREATE TABLE IF NOT EXISTS classes (
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
			hit_die VARCHAR(20),
			primary_abilities JSONB,
			saving_throws JSONB,
			armor_training JSONB,
			weapon_proficiencies JSONB,
			tool_proficiencies JSONB,
			skill_choices JSONB,
			starting_equipment JSONB,
			level_progression JSONB,
			resources JSONB,
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags JSONB,
			is_extended BOOLEAN DEFAULT false,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`,
		"CREATE INDEX IF NOT EXISTS idx_classes_card_number ON classes(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_classes_created_at ON classes(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_classes_deleted_at ON classes(deleted_at) WHERE deleted_at IS NOT NULL",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("createClassesAndRaceProgression: %w", err)
		}
	}
	return nil
}

// addCardPriceCurrency делает цену предмета дробной и добавляет валюту + флаг сокращения.
// Обратно совместимо: существующие int-цены конвертируются в numeric, валюта = NULL (трактуется как золото),
// price_abbreviated по умолчанию true (как было раньше).
func addCardPriceCurrency(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ALTER COLUMN price TYPE NUMERIC USING price::numeric",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS price_currency VARCHAR(20)",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS price_abbreviated BOOLEAN DEFAULT true",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("failed to execute '%s': %w", q, err)
		}
	}
	return nil
}

// addContainersAndBgEquipment добавляет поля контейнеров и варианты снаряжения предысторий
func addContainersAndBgEquipment(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS container_mode VARCHAR(20)",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS contents JSONB",
		"ALTER TABLE backgrounds ADD COLUMN IF NOT EXISTS equipment_options JSONB",
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("failed to execute '%s': %w", q, err)
		}
	}
	return nil
}

// createFeatsTable создает таблицу черт
func createFeatsTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS feats (
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
			category VARCHAR(50) NOT NULL DEFAULT 'general',
			prerequisite TEXT,
			ability_increase JSONB,
			repeatable BOOLEAN DEFAULT false,
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags JSONB,
			is_extended BOOLEAN DEFAULT false,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create feats table: %w", err)
	}
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_feats_category ON feats(category)",
		"CREATE INDEX IF NOT EXISTS idx_feats_card_number ON feats(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_feats_created_at ON feats(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_feats_deleted_at ON feats(deleted_at) WHERE deleted_at IS NOT NULL",
	}
	for _, q := range indexes {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("failed to create index for feats: %w", err)
		}
	}
	trigger := `
		DROP TRIGGER IF EXISTS update_feats_updated_at ON feats;
		CREATE TRIGGER update_feats_updated_at BEFORE UPDATE ON feats
			FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`
	if _, err := db.Exec(trigger); err != nil {
		return fmt.Errorf("failed to create trigger for feats: %w", err)
	}
	return nil
}

// createBackgroundsTable создает таблицу предысторий
func createBackgroundsTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS backgrounds (
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
			ability_scores JSONB,
			origin_feat VARCHAR(255),
			skill_proficiencies JSONB,
			tool_proficiency TEXT,
			equipment TEXT,
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags JSONB,
			is_extended BOOLEAN DEFAULT false,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)`
	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create backgrounds table: %w", err)
	}
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_backgrounds_card_number ON backgrounds(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_backgrounds_created_at ON backgrounds(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_backgrounds_deleted_at ON backgrounds(deleted_at) WHERE deleted_at IS NOT NULL",
	}
	for _, q := range indexes {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("failed to create index for backgrounds: %w", err)
		}
	}
	trigger := `
		DROP TRIGGER IF EXISTS update_backgrounds_updated_at ON backgrounds;
		CREATE TRIGGER update_backgrounds_updated_at BEFORE UPDATE ON backgrounds
			FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`
	if _, err := db.Exec(trigger); err != nil {
		return fmt.Errorf("failed to create trigger for backgrounds: %w", err)
	}
	return nil
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
			effect_type VARCHAR(50) NOT NULL CHECK (effect_type IN ('passive', 'conditional', 'triggered', 'species_ability', 'class_ability', 'feat_ability', 'item_effect', 'spell_effect', 'negative_effect', 'positive_effect')),
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

// addAttunementRangeFields добавляет поля requires_attunement и range в таблицу cards
func addAttunementRangeFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS requires_attunement BOOLEAN DEFAULT FALSE",
		`ALTER TABLE cards ADD COLUMN IF NOT EXISTS "range" VARCHAR(50)`,
		"COMMENT ON COLUMN cards.requires_attunement IS 'Требуется ли настройка на предмет'",
		`COMMENT ON COLUMN cards."range" IS 'Дальность предмета (например, "30/120")'`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeAttunementRangeFields удаляет поля requires_attunement и range из таблицы cards
func removeAttunementRangeFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards DROP COLUMN IF EXISTS requires_attunement",
		`ALTER TABLE cards DROP COLUMN IF EXISTS "range"`,
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

// addElementalDamageFields добавляет поля стихийного урона в таблицу cards
func addElementalDamageFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS elemental_damage_value VARCHAR(20)",
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS elemental_damage_type VARCHAR(20)",
		"COMMENT ON COLUMN cards.elemental_damage_value IS 'Дополнительный стихийный урон (например, 1d4)'",
		"COMMENT ON COLUMN cards.elemental_damage_type IS 'Тип стихийного урона (fire, cold, acid, poison, necrotic, lightning, psychic, radiant, thunder, force)'",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeElementalDamageFields удаляет поля стихийного урона из таблицы cards
func removeElementalDamageFields(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards DROP COLUMN IF EXISTS elemental_damage_value",
		"ALTER TABLE cards DROP COLUMN IF EXISTS elemental_damage_type",
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// addBattleProfileField добавляет поле battle_profile в таблицу cards
func addBattleProfileField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS battle_profile JSONB",
		"COMMENT ON COLUMN cards.battle_profile IS 'Боевой профиль предмета для сервиса battle'",
		"CREATE INDEX IF NOT EXISTS idx_cards_battle_profile ON cards USING GIN (battle_profile)",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeBattleProfileField удаляет поле battle_profile из таблицы cards
func removeBattleProfileField(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_cards_battle_profile",
		"ALTER TABLE cards DROP COLUMN IF EXISTS battle_profile",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// addCustomRarityColorField добавляет поле custom_rarity_color в таблицу cards
func addCustomRarityColorField(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS custom_rarity_color VARCHAR(7)",
		"COMMENT ON COLUMN cards.custom_rarity_color IS 'HEX-цвет (#RRGGBB) для редкости custom'",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

// removeCustomRarityColorField удаляет поле custom_rarity_color из таблицы cards
func removeCustomRarityColorField(db *sql.DB) error {
	if _, err := db.Exec("ALTER TABLE cards DROP COLUMN IF EXISTS custom_rarity_color"); err != nil {
		return fmt.Errorf("failed to drop custom_rarity_color: %w", err)
	}
	return nil
}

// createSpellsTable создает таблицу заклинаний
func createSpellsTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS spells (
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
			level INTEGER NOT NULL DEFAULT 0,
			school VARCHAR(100),
			casting_time TEXT,
			range TEXT,
			component_verbal BOOLEAN DEFAULT false,
			component_somatic BOOLEAN DEFAULT false,
			component_material BOOLEAN DEFAULT false,
			material_text TEXT,
			duration TEXT,
			classes JSONB,
			subclasses JSONB,
			attack_roll BOOLEAN DEFAULT false,
			saving_throw BOOLEAN DEFAULT false,
			concentration BOOLEAN DEFAULT false,
			ritual BOOLEAN DEFAULT false,
			save_types JSONB,
			damage JSONB,
			area TEXT,
			is_healing BOOLEAN DEFAULT false,
			heal_dice VARCHAR(50),
			save_outcome TEXT,
			upcast_description TEXT,
			type VARCHAR(50),
			author VARCHAR(255) DEFAULT 'Admin',
			source VARCHAR(255),
			tags TEXT[],
			is_extended BOOLEAN DEFAULT false,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP WITH TIME ZONE
		)
	`

	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("failed to create spells table: %w", err)
	}

	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_spells_rarity ON spells(rarity)",
		"CREATE INDEX IF NOT EXISTS idx_spells_name ON spells USING gin(to_tsvector('russian', name))",
		"CREATE INDEX IF NOT EXISTS idx_spells_level ON spells(level)",
		"CREATE INDEX IF NOT EXISTS idx_spells_school ON spells(school)",
		"CREATE INDEX IF NOT EXISTS idx_spells_card_number ON spells(card_number)",
		"CREATE INDEX IF NOT EXISTS idx_spells_created_at ON spells(created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_spells_deleted_at ON spells(deleted_at) WHERE deleted_at IS NOT NULL",
	}

	for _, indexQuery := range indexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index for spells: %w", err)
		}
	}

	triggerQuery := `
		DROP TRIGGER IF EXISTS update_spells_updated_at ON spells;
		CREATE TRIGGER update_spells_updated_at
			BEFORE UPDATE ON spells
			FOR EACH ROW
			EXECUTE FUNCTION update_updated_at_column();
	`

	if _, err := db.Exec(triggerQuery); err != nil {
		return fmt.Errorf("failed to create trigger for spells: %w", err)
	}

	return nil
}

// dropSpellsTable удаляет таблицу заклинаний
func dropSpellsTable(db *sql.DB) error {
	_, err := db.Exec("DROP TABLE IF EXISTS spells CASCADE")
	return err
}

// convertSpellArraysToJsonb переводит колонки-массивы заклинаний в jsonb.
// Тип Properties сериализуется в JSON (["a","b"]), что несовместимо с text[],
// но идеально ложится на jsonb. Идемпотентно: jsonb->jsonb через to_jsonb тоже валиден.
func convertSpellArraysToJsonb(db *sql.DB) error {
	cols := []string{"classes", "subclasses", "save_types", "tags"}
	for _, col := range cols {
		query := fmt.Sprintf(
			"ALTER TABLE spells ALTER COLUMN %s TYPE JSONB USING to_jsonb(%s)", col, col)
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to convert spells.%s to jsonb: %w", col, err)
		}
	}
	return nil
}

// widenSpellTextColumns расширяет текстовые колонки заклинаний до TEXT.
func widenSpellTextColumns(db *sql.DB) error {
	cols := []string{"casting_time", "range", "duration", "area"}
	for _, col := range cols {
		if _, err := db.Exec(fmt.Sprintf("ALTER TABLE spells ALTER COLUMN %s TYPE TEXT", col)); err != nil {
			return fmt.Errorf("failed to widen spells.%s: %w", col, err)
		}
	}
	return nil
}

// revertSpellArraysToTextArray возвращает колонки в text[] (откат).
func revertSpellArraysToTextArray(db *sql.DB) error {
	cols := []string{"classes", "subclasses", "save_types", "tags"}
	for _, col := range cols {
		query := fmt.Sprintf(
			"ALTER TABLE spells ALTER COLUMN %s TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(%s))", col, col)
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to revert spells.%s to text[]: %w", col, err)
		}
	}
	return nil
}

// addCardMastery — свойство искусности оружия (Weapon Mastery, PHB 2024).
// Хранит id эффекта-мастерства (EFFECT-0248..0255, type='Эффект мастерства') — структурная
// связь вместо текстовой ссылки [[Мастерство|concept:weapon_mastery]] в description.
// Значение — UUID эффекта, поэтому varchar(64) без FK (эффекты живут в своей таблице,
// жёсткий FK сломал бы импорт/сиды при частичной выгрузке).
func addCardMastery(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE cards ADD COLUMN IF NOT EXISTS mastery VARCHAR(64)",
		"CREATE INDEX IF NOT EXISTS idx_cards_mastery ON cards(mastery)",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}

func removeCardMastery(db *sql.DB) error {
	queries := []string{
		"DROP INDEX IF EXISTS idx_cards_mastery",
		"ALTER TABLE cards DROP COLUMN IF EXISTS mastery",
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query '%s': %w", query, err)
		}
	}
	return nil
}
