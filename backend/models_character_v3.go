package main

import (
	"time"

	"github.com/google/uuid"
)

// CharacterV3 — новая модель персонажа, ссылающаяся на сущности (вид/класс/
// предыстория/черты/заклинания) и хранящая разрешённые выборы из механики.
// Низкоуровневые умения этих сущностей — это эффекты и действия.
type CharacterV3 struct {
	ID        uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID    uuid.UUID  `json:"user_id" gorm:"type:uuid;not null"`
	GroupID   *uuid.UUID `json:"group_id" gorm:"type:uuid"`
	Name      string     `json:"name" gorm:"not null"`
	AvatarURL string     `json:"avatar_url" gorm:"type:text"`

	// Ссылки на сущности
	RaceID       *uuid.UUID `json:"race_id" gorm:"type:uuid"`
	LineageID    *string    `json:"lineage_id" gorm:"type:varchar(100)"` // id варианта из race.lineages
	ClassID      *uuid.UUID `json:"class_id" gorm:"type:uuid"`
	BackgroundID *uuid.UUID `json:"background_id" gorm:"type:uuid"`
	Level        int        `json:"level" gorm:"not null;default:1"`

	// Списки ссылок (jsonb-массивы строковых uuid)
	FeatIDs  *Properties `json:"feat_ids" gorm:"type:jsonb"`
	SpellIDs *Properties `json:"spell_ids" gorm:"type:jsonb"`

	// Базовые (введённые) характеристики: {"str":15,"dex":14,...}
	Abilities *JSONMap `json:"abilities" gorm:"type:jsonb"`

	// Итоговые владения (jsonb-массивы)
	SkillProficiencies       *Properties `json:"skill_proficiencies" gorm:"type:jsonb"`
	SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies" gorm:"type:jsonb"`
	ToolProficiencies        *Properties `json:"tool_proficiencies" gorm:"type:jsonb"`
	Languages                *Properties `json:"languages" gorm:"type:jsonb"`

	// Разрешённые выборы из механики: {"<choiceId>": ["<optId>", ...]}
	ResolvedChoices *JSONMap `json:"resolved_choices" gorm:"type:jsonb"`

	// Снимок вычисляемых полей (для быстрого листа; можно пересчитать из ссылок)
	MaxHP            int `json:"max_hp" gorm:"default:0"`
	CurrentHP        int `json:"current_hp" gorm:"default:0"`
	Speed            int `json:"speed" gorm:"default:30"`
	ProficiencyBonus int `json:"proficiency_bonus" gorm:"default:2"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Связи
	User  User   `json:"user" gorm:"foreignKey:UserID"`
	Group *Group `json:"group,omitempty" gorm:"foreignKey:GroupID"`
}

// TableName указывает имя таблицы для GORM
func (CharacterV3) TableName() string { return "characters_v3" }

// CreateCharacterV3Request — запрос на создание персонажа V3.
// Все ссылки опциональны, чтобы можно было сохранить незавершённого персонажа
// (черновик); обязательно только имя.
type CreateCharacterV3Request struct {
	Name         string     `json:"name" binding:"required"`
	AvatarURL    string     `json:"avatar_url"`
	RaceID       *uuid.UUID `json:"race_id"`
	LineageID    *string    `json:"lineage_id"`
	ClassID      *uuid.UUID `json:"class_id"`
	BackgroundID *uuid.UUID `json:"background_id"`
	Level        int        `json:"level"`

	FeatIDs  *Properties `json:"feat_ids"`
	SpellIDs *Properties `json:"spell_ids"`

	Abilities *JSONMap `json:"abilities"`

	SkillProficiencies       *Properties `json:"skill_proficiencies"`
	SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies"`
	ToolProficiencies        *Properties `json:"tool_proficiencies"`
	Languages                *Properties `json:"languages"`

	ResolvedChoices *JSONMap `json:"resolved_choices"`

	MaxHP            int `json:"max_hp"`
	CurrentHP        int `json:"current_hp"`
	Speed            int `json:"speed"`
	ProficiencyBonus int `json:"proficiency_bonus"`
}

// UpdateCharacterV3Request — запрос на обновление. Полная замена полей черновика
// (редактор держит полное состояние персонажа). Имя опционально.
type UpdateCharacterV3Request struct {
	Name         string     `json:"name"`
	AvatarURL    string     `json:"avatar_url"`
	RaceID       *uuid.UUID `json:"race_id"`
	LineageID    *string    `json:"lineage_id"`
	ClassID      *uuid.UUID `json:"class_id"`
	BackgroundID *uuid.UUID `json:"background_id"`
	Level        int        `json:"level"`

	FeatIDs  *Properties `json:"feat_ids"`
	SpellIDs *Properties `json:"spell_ids"`

	Abilities *JSONMap `json:"abilities"`

	SkillProficiencies       *Properties `json:"skill_proficiencies"`
	SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies"`
	ToolProficiencies        *Properties `json:"tool_proficiencies"`
	Languages                *Properties `json:"languages"`

	ResolvedChoices *JSONMap `json:"resolved_choices"`

	MaxHP            int `json:"max_hp"`
	CurrentHP        int `json:"current_hp"`
	Speed            int `json:"speed"`
	ProficiencyBonus int `json:"proficiency_bonus"`
}
