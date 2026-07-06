package main

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ClassEquipmentOptions - варианты А/Б/В стартового снаряжения класса (jsonb).
// Незаполненные варианты — nil (UI показывает только заполненные).
type ClassEquipmentOptions struct {
	OptionA *EquipmentOption `json:"option_a,omitempty"`
	OptionB *EquipmentOption `json:"option_b,omitempty"`
	OptionC *EquipmentOption `json:"option_c,omitempty"`
}

// Scan - кастомный сканер для ClassEquipmentOptions
func (o *ClassEquipmentOptions) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case string:
		return json.Unmarshal([]byte(v), o)
	case []byte:
		return json.Unmarshal(v, o)
	default:
		return fmt.Errorf("неподдерживаемый тип для ClassEquipmentOptions: %T", value)
	}
}

// Value - кастомный value для ClassEquipmentOptions
func (o ClassEquipmentOptions) Value() (driver.Value, error) {
	return json.Marshal(o)
}

// Class - модель класса персонажа D&D.
type Class struct {
	ID                    uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name                  string         `json:"name" gorm:"not null"`
	Description           string         `json:"description" gorm:"type:text;not null"`
	DetailedDescription   *string        `json:"detailed_description" gorm:"type:text"`
	ImageURL              string         `json:"image_url" gorm:"type:text"`
	ImageCloudinaryID     string         `json:"image_cloudinary_id" gorm:"type:varchar(255)"`
	ImageCloudinaryURL    string         `json:"image_cloudinary_url" gorm:"type:text"`
	ImageGenerated        bool           `json:"image_generated" gorm:"type:boolean;default:false"`
	ImageGenerationPrompt string         `json:"image_generation_prompt" gorm:"type:text"`
	Rarity                Rarity         `json:"rarity" gorm:"not null;default:'common'"`
	CardNumber            string         `json:"card_number" gorm:"uniqueIndex;not null"`
	HitDie                *string        `json:"hit_die" gorm:"type:varchar(20)"`
	PrimaryAbilities      *Properties    `json:"primary_abilities" gorm:"type:jsonb"`
	RecommendedAbilities  *JSONMap       `json:"recommended_abilities" gorm:"type:jsonb"` // Оптимальный point-buy расклад {str:15,dex:14,...}
	SavingThrows          *Properties    `json:"saving_throws" gorm:"type:jsonb"`
	ArmorTraining         *Properties    `json:"armor_training" gorm:"type:jsonb"`
	WeaponProficiencies   *Properties    `json:"weapon_proficiencies" gorm:"type:jsonb"`
	ToolProficiencies     *Properties    `json:"tool_proficiencies" gorm:"type:jsonb"`
	SkillChoices          *JSONMap       `json:"skill_choices" gorm:"type:jsonb"`
	StartingEquipment     *JSONMap       `json:"starting_equipment" gorm:"type:jsonb"`
	EquipmentOptions      *ClassEquipmentOptions `json:"equipment_options" gorm:"type:jsonb"` // Варианты А/Б/В (предметы + золото)
	LevelProgression      *JSONMap       `json:"level_progression" gorm:"type:jsonb"`
	Resources             *JSONMap       `json:"resources" gorm:"type:jsonb"`
	IsSubclass            *bool          `json:"is_subclass" gorm:"type:boolean;default:false"`
	ParentClassID         *uuid.UUID     `json:"parent_class_id" gorm:"type:uuid;index:idx_classes_parent"`
	SubclassLevel         *int           `json:"subclass_level" gorm:"type:int;default:3"` // у родителя: уровень выбора подкласса
	RelatedEffects        *Properties    `json:"related_effects" gorm:"type:jsonb"`
	RelatedActions        *Properties    `json:"related_actions" gorm:"type:jsonb"`
	Type                  *string        `json:"type" gorm:"type:varchar(50)"`
	Author                string         `json:"author" gorm:"type:varchar(255);default:'Admin'"`
	Source                *string        `json:"source" gorm:"type:varchar(255)"`
	Tags                  *Properties    `json:"tags" gorm:"type:jsonb"`
	IsExtended            *bool          `json:"is_extended" gorm:"type:boolean;default:null"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	DeletedAt             gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Class) TableName() string { return "classes" }

type CreateClassRequest struct {
	Name                string      `json:"name" binding:"required"`
	Description         string      `json:"description" binding:"required"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	HitDie               *string     `json:"hit_die"`
	PrimaryAbilities     *Properties `json:"primary_abilities"`
	RecommendedAbilities *JSONMap    `json:"recommended_abilities"`
	SavingThrows         *Properties `json:"saving_throws"`
	ArmorTraining        *Properties `json:"armor_training"`
	WeaponProficiencies  *Properties `json:"weapon_proficiencies"`
	ToolProficiencies    *Properties `json:"tool_proficiencies"`
	SkillChoices         *JSONMap    `json:"skill_choices"`
	StartingEquipment    *JSONMap    `json:"starting_equipment"`
	EquipmentOptions     *ClassEquipmentOptions `json:"equipment_options"`
	LevelProgression     *JSONMap    `json:"level_progression"`
	Resources            *JSONMap    `json:"resources"`
	IsSubclass           *bool       `json:"is_subclass"`
	ParentClassID        *uuid.UUID  `json:"parent_class_id"`
	SubclassLevel        *int        `json:"subclass_level"`
	RelatedEffects       *Properties `json:"related_effects"`
	RelatedActions       *Properties `json:"related_actions"`
	Type                 *string     `json:"type"`
	Author               string      `json:"author"`
	Source               *string     `json:"source"`
	Tags                 *Properties `json:"tags"`
	IsExtended           *bool       `json:"is_extended"`
}

type UpdateClassRequest struct {
	Name                string      `json:"name"`
	Description         string      `json:"description"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	HitDie               *string     `json:"hit_die"`
	PrimaryAbilities     *Properties `json:"primary_abilities"`
	RecommendedAbilities *JSONMap    `json:"recommended_abilities"`
	SavingThrows         *Properties `json:"saving_throws"`
	ArmorTraining        *Properties `json:"armor_training"`
	WeaponProficiencies  *Properties `json:"weapon_proficiencies"`
	ToolProficiencies    *Properties `json:"tool_proficiencies"`
	SkillChoices         *JSONMap    `json:"skill_choices"`
	StartingEquipment    *JSONMap    `json:"starting_equipment"`
	EquipmentOptions     *ClassEquipmentOptions `json:"equipment_options"`
	LevelProgression     *JSONMap    `json:"level_progression"`
	Resources            *JSONMap    `json:"resources"`
	IsSubclass           *bool       `json:"is_subclass"`
	ParentClassID        *uuid.UUID  `json:"parent_class_id"`
	SubclassLevel        *int        `json:"subclass_level"`
	RelatedEffects       *Properties `json:"related_effects"`
	RelatedActions       *Properties `json:"related_actions"`
	Type                 *string     `json:"type"`
	Author               string      `json:"author"`
	Source               *string     `json:"source"`
	Tags                 *Properties `json:"tags"`
	IsExtended           *bool       `json:"is_extended"`
}

type ClassResponse struct {
	ID                  uuid.UUID   `json:"id"`
	Name                string      `json:"name"`
	Description         string      `json:"description"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	HitDie               *string     `json:"hit_die"`
	PrimaryAbilities     *Properties `json:"primary_abilities"`
	RecommendedAbilities *JSONMap    `json:"recommended_abilities"`
	SavingThrows         *Properties `json:"saving_throws"`
	ArmorTraining        *Properties `json:"armor_training"`
	WeaponProficiencies  *Properties `json:"weapon_proficiencies"`
	ToolProficiencies    *Properties `json:"tool_proficiencies"`
	SkillChoices         *JSONMap    `json:"skill_choices"`
	StartingEquipment    *JSONMap    `json:"starting_equipment"`
	EquipmentOptions     *ClassEquipmentOptions `json:"equipment_options"`
	LevelProgression     *JSONMap    `json:"level_progression"`
	Resources            *JSONMap    `json:"resources"`
	IsSubclass           *bool       `json:"is_subclass"`
	ParentClassID        *uuid.UUID  `json:"parent_class_id"`
	SubclassLevel        *int        `json:"subclass_level"`
	RelatedEffects       *Properties `json:"related_effects"`
	RelatedActions       *Properties `json:"related_actions"`
	Type                 *string     `json:"type"`
	Author               string      `json:"author"`
	Source               *string     `json:"source"`
	Tags                 *Properties `json:"tags"`
	IsExtended           *bool       `json:"is_extended"`
	CreatedAt            time.Time   `json:"created_at"`
	UpdatedAt            time.Time   `json:"updated_at"`
}

func (cl Class) ToClassResponse() ClassResponse {
	return ClassResponse{
		ID: cl.ID, Name: cl.Name, Description: cl.Description, DetailedDescription: cl.DetailedDescription,
		ImageURL: cl.ImageURL, Rarity: cl.Rarity, CardNumber: cl.CardNumber, HitDie: cl.HitDie,
		PrimaryAbilities: cl.PrimaryAbilities, RecommendedAbilities: cl.RecommendedAbilities,
		SavingThrows: cl.SavingThrows, ArmorTraining: cl.ArmorTraining,
		WeaponProficiencies: cl.WeaponProficiencies, ToolProficiencies: cl.ToolProficiencies,
		SkillChoices: cl.SkillChoices, StartingEquipment: cl.StartingEquipment,
		EquipmentOptions: cl.EquipmentOptions,
		LevelProgression: cl.LevelProgression, Resources: cl.Resources,
		IsSubclass: cl.IsSubclass, ParentClassID: cl.ParentClassID, SubclassLevel: cl.SubclassLevel,
		RelatedEffects: cl.RelatedEffects, RelatedActions: cl.RelatedActions,
		Type: cl.Type, Author: cl.Author, Source: cl.Source, Tags: cl.Tags, IsExtended: cl.IsExtended,
		CreatedAt: cl.CreatedAt, UpdatedAt: cl.UpdatedAt,
	}
}
