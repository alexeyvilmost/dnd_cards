package main

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Monster is a reusable, data-driven creature stat block. Its executable
// behavior is composed from ordinary Action and Effect entities; the monster
// row only owns creature facts and references.
type Monster struct {
	ID               uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Slug             string         `json:"slug" gorm:"type:varchar(100);uniqueIndex;not null"`
	Name             string         `json:"name" gorm:"type:varchar(255);not null"`
	NameEn           *string        `json:"name_en" gorm:"type:varchar(255)"`
	Description      string         `json:"description" gorm:"type:text"`
	Size             string         `json:"size" gorm:"type:varchar(30);not null;default:'medium'"`
	CreatureType     string         `json:"creature_type" gorm:"type:varchar(100);not null;default:'humanoid'"`
	Alignment        string         `json:"alignment" gorm:"type:varchar(100)"`
	ChallengeRating  string         `json:"challenge_rating" gorm:"type:varchar(20);not null;default:'0'"`
	ArmorClass       int            `json:"armor_class" gorm:"not null;default:10"`
	MaxHP            int            `json:"max_hp" gorm:"not null;default:1"`
	Speed            int            `json:"speed" gorm:"not null;default:30"`
	InitiativeBonus  int            `json:"initiative_bonus" gorm:"not null;default:0"`
	ProficiencyBonus int            `json:"proficiency_bonus" gorm:"not null;default:2"`
	Abilities        *JSONMap       `json:"abilities" gorm:"type:jsonb;not null;default:'{}'::jsonb"`
	ActionIDs        *Properties    `json:"action_ids" gorm:"type:jsonb;not null;default:'[]'::jsonb"`
	EffectIDs        *Properties    `json:"effect_ids" gorm:"type:jsonb;not null;default:'[]'::jsonb"`
	AI               *JSONMap       `json:"ai" gorm:"type:jsonb;not null;default:'{}'::jsonb"`
	TokenURL         string         `json:"token_url" gorm:"type:text"`
	TokenStorageID   string         `json:"token_storage_id" gorm:"type:varchar(255)"`
	Source           string         `json:"source" gorm:"type:varchar(255)"`
	Support          *JSONMap       `json:"support" gorm:"type:jsonb"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Monster) TableName() string { return "monsters" }

type MonsterUpsertRequest struct {
	Slug             string      `json:"slug"`
	Name             string      `json:"name" binding:"required"`
	NameEn           *string     `json:"name_en"`
	Description      string      `json:"description"`
	Size             string      `json:"size"`
	CreatureType     string      `json:"creature_type"`
	Alignment        string      `json:"alignment"`
	ChallengeRating  string      `json:"challenge_rating"`
	ArmorClass       int         `json:"armor_class"`
	MaxHP            int         `json:"max_hp"`
	Speed            int         `json:"speed"`
	InitiativeBonus  int         `json:"initiative_bonus"`
	ProficiencyBonus int         `json:"proficiency_bonus"`
	Abilities        *JSONMap    `json:"abilities"`
	ActionIDs        *Properties `json:"action_ids"`
	EffectIDs        *Properties `json:"effect_ids"`
	AI               *JSONMap    `json:"ai"`
	TokenURL         string      `json:"token_url"`
	Source           string      `json:"source"`
}
