package main

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─── Черты (Feat) ────────────────────────────────────────────────────────────

// FeatCategory - категория черты
type FeatCategory string

const (
	FeatOrigin        FeatCategory = "origin"         // Черта происхождения
	FeatGeneral       FeatCategory = "general"        // Универсальная черта
	FeatFightingStyle FeatCategory = "fighting_style" // Боевой стиль
	FeatEpicBoon      FeatCategory = "epic_boon"      // Эпический дар
)

// Feat - модель черты D&D
type Feat struct {
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
	Category              FeatCategory   `json:"category" gorm:"type:varchar(50);not null;default:'general'"`
	Prerequisite          *string        `json:"prerequisite" gorm:"type:text"`      // Требования
	AbilityIncrease       *Properties    `json:"ability_increase" gorm:"type:jsonb"` // Коды характеристик (str/dex/...)
	RelatedEffects        *Properties    `json:"related_effects" gorm:"type:jsonb"`  // id привязанных эффектов
	RelatedActions        *Properties    `json:"related_actions" gorm:"type:jsonb"`  // id привязанных действий
	Repeatable            bool           `json:"repeatable" gorm:"type:boolean;default:false"`
	Type                  *string        `json:"type" gorm:"type:varchar(50)"`
	Author                string         `json:"author" gorm:"type:varchar(255);default:'Admin'"`
	Source                *string        `json:"source" gorm:"type:varchar(255)"`
	Tags                  *Properties    `json:"tags" gorm:"type:jsonb"`
	IsExtended            *bool          `json:"is_extended" gorm:"type:boolean;default:null"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	DeletedAt             gorm.DeletedAt `json:"-" gorm:"index"`
}

// TableName указывает имя таблицы для GORM
func (Feat) TableName() string { return "feats" }

// CreateFeatRequest - запрос на создание черты
type CreateFeatRequest struct {
	Name                string       `json:"name" binding:"required"`
	Description         string       `json:"description" binding:"required"`
	DetailedDescription *string      `json:"detailed_description"`
	ImageURL            string       `json:"image_url"`
	Rarity              Rarity       `json:"rarity"`
	CardNumber          string       `json:"card_number"`
	Category            FeatCategory `json:"category"`
	Prerequisite        *string      `json:"prerequisite"`
	AbilityIncrease     *Properties  `json:"ability_increase"`
	RelatedEffects      *Properties  `json:"related_effects"`
	RelatedActions      *Properties  `json:"related_actions"`
	Repeatable          bool         `json:"repeatable"`
	Type                *string      `json:"type"`
	Author              string       `json:"author"`
	Source              *string      `json:"source"`
	Tags                *Properties  `json:"tags"`
	IsExtended          *bool        `json:"is_extended"`
}

// UpdateFeatRequest - запрос на обновление черты
type UpdateFeatRequest struct {
	Name                string       `json:"name"`
	Description         string       `json:"description"`
	DetailedDescription *string      `json:"detailed_description"`
	ImageURL            string       `json:"image_url"`
	Rarity              Rarity       `json:"rarity"`
	Category            FeatCategory `json:"category"`
	Prerequisite        *string      `json:"prerequisite"`
	AbilityIncrease     *Properties  `json:"ability_increase"`
	RelatedEffects      *Properties  `json:"related_effects"`
	RelatedActions      *Properties  `json:"related_actions"`
	Repeatable          *bool        `json:"repeatable"`
	Type                *string      `json:"type"`
	Author              string       `json:"author"`
	Source              *string      `json:"source"`
	Tags                *Properties  `json:"tags"`
	IsExtended          *bool        `json:"is_extended"`
}

// FeatResponse - ответ с чертой
type FeatResponse struct {
	ID                  uuid.UUID    `json:"id"`
	Name                string       `json:"name"`
	Description         string       `json:"description"`
	DetailedDescription *string      `json:"detailed_description"`
	ImageURL            string       `json:"image_url"`
	Rarity              Rarity       `json:"rarity"`
	CardNumber          string       `json:"card_number"`
	Category            FeatCategory `json:"category"`
	Prerequisite        *string      `json:"prerequisite"`
	AbilityIncrease     *Properties  `json:"ability_increase"`
	RelatedEffects      *Properties  `json:"related_effects"`
	RelatedActions      *Properties  `json:"related_actions"`
	Repeatable          bool         `json:"repeatable"`
	Type                *string      `json:"type"`
	Author              string       `json:"author"`
	Source              *string      `json:"source"`
	Tags                *Properties  `json:"tags"`
	IsExtended          *bool        `json:"is_extended"`
	CreatedAt           time.Time    `json:"created_at"`
	UpdatedAt           time.Time    `json:"updated_at"`
}

// ToFeatResponse преобразует модель черты в API-ответ.
func (f Feat) ToFeatResponse() FeatResponse {
	return FeatResponse{
		ID: f.ID, Name: f.Name, Description: f.Description, DetailedDescription: f.DetailedDescription,
		ImageURL: f.ImageURL, Rarity: f.Rarity, CardNumber: f.CardNumber, Category: f.Category,
		Prerequisite: f.Prerequisite, AbilityIncrease: f.AbilityIncrease,
		RelatedEffects: f.RelatedEffects, RelatedActions: f.RelatedActions, Repeatable: f.Repeatable,
		Type: f.Type, Author: f.Author, Source: f.Source, Tags: f.Tags, IsExtended: f.IsExtended,
		CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt,
	}
}

// ─── Предыстории (Background) ─────────────────────────────────────────────────

// Background - модель предыстории D&D
type Background struct {
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
	AbilityScores         *Properties    `json:"ability_scores" gorm:"type:jsonb"`      // 3 кода характеристик
	OriginFeat            *string        `json:"origin_feat" gorm:"type:varchar(255)"`  // Черта происхождения (название)
	SkillProficiencies    *Properties    `json:"skill_proficiencies" gorm:"type:jsonb"` // Владение навыками
	ToolProficiency       *string        `json:"tool_proficiency" gorm:"type:text"`     // Владение инструментами
	Equipment             *string        `json:"equipment" gorm:"type:text"`            // Снаряжение (текст, legacy)
	EquipmentOptions      *BackgroundEquipmentOptions `json:"equipment_options" gorm:"type:jsonb"` // Варианты А/Б (предметы + золото)
	Type                  *string        `json:"type" gorm:"type:varchar(50)"`
	Author                string         `json:"author" gorm:"type:varchar(255);default:'Admin'"`
	Source                *string        `json:"source" gorm:"type:varchar(255)"`
	Tags                  *Properties    `json:"tags" gorm:"type:jsonb"`
	IsExtended            *bool          `json:"is_extended" gorm:"type:boolean;default:null"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	DeletedAt             gorm.DeletedAt `json:"-" gorm:"index"`
}

// TableName указывает имя таблицы для GORM
func (Background) TableName() string { return "backgrounds" }

// CreateBackgroundRequest - запрос на создание предыстории
type CreateBackgroundRequest struct {
	Name                string      `json:"name" binding:"required"`
	Description         string      `json:"description" binding:"required"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	AbilityScores       *Properties `json:"ability_scores"`
	OriginFeat          *string     `json:"origin_feat"`
	SkillProficiencies  *Properties `json:"skill_proficiencies"`
	ToolProficiency     *string     `json:"tool_proficiency"`
	Equipment           *string     `json:"equipment"`
	EquipmentOptions    *BackgroundEquipmentOptions `json:"equipment_options"`
	Type                *string     `json:"type"`
	Author              string      `json:"author"`
	Source              *string     `json:"source"`
	Tags                *Properties  `json:"tags"`
	IsExtended          *bool       `json:"is_extended"`
}

// UpdateBackgroundRequest - запрос на обновление предыстории
type UpdateBackgroundRequest struct {
	Name                string      `json:"name"`
	Description         string      `json:"description"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	AbilityScores       *Properties `json:"ability_scores"`
	OriginFeat          *string     `json:"origin_feat"`
	SkillProficiencies  *Properties `json:"skill_proficiencies"`
	ToolProficiency     *string     `json:"tool_proficiency"`
	Equipment           *string     `json:"equipment"`
	EquipmentOptions    *BackgroundEquipmentOptions `json:"equipment_options"`
	Type                *string     `json:"type"`
	Author              string      `json:"author"`
	Source              *string     `json:"source"`
	Tags                *Properties  `json:"tags"`
	IsExtended          *bool       `json:"is_extended"`
}

// BackgroundResponse - ответ с предысторией
type BackgroundResponse struct {
	ID                  uuid.UUID   `json:"id"`
	Name                string      `json:"name"`
	Description         string      `json:"description"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	AbilityScores       *Properties `json:"ability_scores"`
	OriginFeat          *string     `json:"origin_feat"`
	SkillProficiencies  *Properties `json:"skill_proficiencies"`
	ToolProficiency     *string     `json:"tool_proficiency"`
	Equipment           *string     `json:"equipment"`
	EquipmentOptions    *BackgroundEquipmentOptions `json:"equipment_options"`
	Type                *string     `json:"type"`
	Author              string      `json:"author"`
	Source              *string     `json:"source"`
	Tags                *Properties `json:"tags"`
	IsExtended          *bool       `json:"is_extended"`
	CreatedAt           time.Time   `json:"created_at"`
	UpdatedAt           time.Time   `json:"updated_at"`
}

// ToBackgroundResponse преобразует модель предыстории в API-ответ.
func (b Background) ToBackgroundResponse() BackgroundResponse {
	return BackgroundResponse{
		ID: b.ID, Name: b.Name, Description: b.Description, DetailedDescription: b.DetailedDescription,
		ImageURL: b.ImageURL, Rarity: b.Rarity, CardNumber: b.CardNumber, AbilityScores: b.AbilityScores,
		OriginFeat: b.OriginFeat, SkillProficiencies: b.SkillProficiencies, ToolProficiency: b.ToolProficiency,
		Equipment: b.Equipment, EquipmentOptions: b.EquipmentOptions, Type: b.Type, Author: b.Author, Source: b.Source, Tags: b.Tags,
		IsExtended: b.IsExtended, CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
	}
}
