package main

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// RaceTrait - видовая особенность (название + описание)
type RaceTrait struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// RaceTraits - список особенностей/происхождений (jsonb)
type RaceTraits []RaceTrait

// Scan - кастомный сканер для RaceTraits
func (t *RaceTraits) Scan(value interface{}) error {
	if value == nil {
		*t = nil
		return nil
	}
	switch v := value.(type) {
	case string:
		return json.Unmarshal([]byte(v), t)
	case []byte:
		return json.Unmarshal(v, t)
	default:
		return fmt.Errorf("неподдерживаемый тип для RaceTraits: %T", value)
	}
}

// Value - кастомный value для RaceTraits
func (t RaceTraits) Value() (driver.Value, error) {
	if t == nil {
		return nil, nil
	}
	return json.Marshal(t)
}

// Race - модель вида (расы) D&D
type Race struct {
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
	CreatureType          *string        `json:"creature_type" gorm:"type:varchar(100)"` // Тип существа (Гуманоид и т.п.)
	Size                  *string        `json:"size" gorm:"type:varchar(100)"`          // Размер (Средний / Маленький / выбор)
	Speed                 *int           `json:"speed" gorm:"type:int"`                  // Скорость, футы
	ExtraSpeeds           *string        `json:"extra_speeds" gorm:"type:text"`          // Доп. скорости (плавание/полёт/лазание)
	Darkvision            *int           `json:"darkvision" gorm:"type:int"`             // Тёмное зрение, футы (0 = нет)
	Traits                *RaceTraits    `json:"traits" gorm:"type:jsonb"`               // Видовые особенности
	Lineages              *RaceTraits    `json:"lineages" gorm:"type:jsonb"`             // Происхождения/подвиды (опц., legacy)
	IsSubrace             *bool          `json:"is_subrace" gorm:"type:boolean;default:false"` // это подвид другого вида
	ParentRaceID          *uuid.UUID     `json:"parent_race_id" gorm:"type:uuid"`        // родительский вид (для подвида)
	SubraceLevel          *int           `json:"subrace_level" gorm:"type:int;default:1"` // на каком уровне выбирается подвид
	RelatedEffects        *Properties    `json:"related_effects" gorm:"type:jsonb"`      // id привязанных эффектов
	RelatedActions        *Properties    `json:"related_actions" gorm:"type:jsonb"`      // id привязанных действий
	LevelProgression      *JSONMap       `json:"level_progression" gorm:"type:jsonb"`    // способности вида по уровням
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
func (Race) TableName() string { return "races" }

// CreateRaceRequest - запрос на создание вида
type CreateRaceRequest struct {
	Name                string      `json:"name" binding:"required"`
	Description         string      `json:"description" binding:"required"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	CreatureType        *string     `json:"creature_type"`
	Size                *string     `json:"size"`
	Speed               *int        `json:"speed"`
	ExtraSpeeds         *string     `json:"extra_speeds"`
	Darkvision          *int        `json:"darkvision"`
	Traits              *RaceTraits `json:"traits"`
	Lineages            *RaceTraits `json:"lineages"`
	IsSubrace           *bool       `json:"is_subrace"`
	ParentRaceID        *uuid.UUID  `json:"parent_race_id"`
	SubraceLevel        *int        `json:"subrace_level"`
	RelatedEffects      *Properties `json:"related_effects"`
	RelatedActions      *Properties `json:"related_actions"`
	LevelProgression    *JSONMap    `json:"level_progression"`
	Type                *string     `json:"type"`
	Author              string      `json:"author"`
	Source              *string     `json:"source"`
	Tags                *Properties `json:"tags"`
	IsExtended          *bool       `json:"is_extended"`
}

// UpdateRaceRequest - запрос на обновление вида
type UpdateRaceRequest struct {
	Name                string      `json:"name"`
	Description         string      `json:"description"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CreatureType        *string     `json:"creature_type"`
	Size                *string     `json:"size"`
	Speed               *int        `json:"speed"`
	ExtraSpeeds         *string     `json:"extra_speeds"`
	Darkvision          *int        `json:"darkvision"`
	Traits              *RaceTraits `json:"traits"`
	Lineages            *RaceTraits `json:"lineages"`
	IsSubrace           *bool       `json:"is_subrace"`
	ParentRaceID        *uuid.UUID  `json:"parent_race_id"`
	SubraceLevel        *int        `json:"subrace_level"`
	RelatedEffects      *Properties `json:"related_effects"`
	RelatedActions      *Properties `json:"related_actions"`
	LevelProgression    *JSONMap    `json:"level_progression"`
	Type                *string     `json:"type"`
	Author              string      `json:"author"`
	Source              *string     `json:"source"`
	Tags                *Properties `json:"tags"`
	IsExtended          *bool       `json:"is_extended"`
}

// RaceResponse - ответ с видом
type RaceResponse struct {
	ID                  uuid.UUID   `json:"id"`
	Name                string      `json:"name"`
	Description         string      `json:"description"`
	DetailedDescription *string     `json:"detailed_description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	CreatureType        *string     `json:"creature_type"`
	Size                *string     `json:"size"`
	Speed               *int        `json:"speed"`
	ExtraSpeeds         *string     `json:"extra_speeds"`
	Darkvision          *int        `json:"darkvision"`
	Traits              *RaceTraits `json:"traits"`
	Lineages            *RaceTraits `json:"lineages"`
	IsSubrace           *bool       `json:"is_subrace"`
	ParentRaceID        *uuid.UUID  `json:"parent_race_id"`
	SubraceLevel        *int        `json:"subrace_level"`
	RelatedEffects      *Properties `json:"related_effects"`
	RelatedActions      *Properties `json:"related_actions"`
	LevelProgression    *JSONMap    `json:"level_progression"`
	Type                *string     `json:"type"`
	Author              string      `json:"author"`
	Source              *string     `json:"source"`
	Tags                *Properties `json:"tags"`
	IsExtended          *bool       `json:"is_extended"`
	CreatedAt           time.Time   `json:"created_at"`
	UpdatedAt           time.Time   `json:"updated_at"`
}

// ToRaceResponse преобразует модель вида в API-ответ.
func (r Race) ToRaceResponse() RaceResponse {
	return RaceResponse{
		ID: r.ID, Name: r.Name, Description: r.Description, DetailedDescription: r.DetailedDescription,
		ImageURL: r.ImageURL, Rarity: r.Rarity, CardNumber: r.CardNumber,
		CreatureType: r.CreatureType, Size: r.Size, Speed: r.Speed, ExtraSpeeds: r.ExtraSpeeds,
		Darkvision: r.Darkvision, Traits: r.Traits, Lineages: r.Lineages,
		IsSubrace: r.IsSubrace, ParentRaceID: r.ParentRaceID, SubraceLevel: r.SubraceLevel,
		RelatedEffects: r.RelatedEffects, RelatedActions: r.RelatedActions, LevelProgression: r.LevelProgression,
		Type: r.Type, Author: r.Author, Source: r.Source, Tags: r.Tags,
		IsExtended: r.IsExtended, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
