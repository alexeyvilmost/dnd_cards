package main

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// CharacterV3 — новая модель персонажа, ссылающаяся на сущности (вид/класс/
// предыстория/черты/заклинания) и хранящая разрешённые выборы из механики.
// Низкоуровневые умения этих сущностей — это эффекты и действия.
type CharacterV3 struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID      uuid.UUID  `json:"user_id" gorm:"type:uuid;not null"`
	GroupID     *uuid.UUID `json:"group_id" gorm:"type:uuid"`
	Name        string     `json:"name" gorm:"not null"`
	AvatarURL   string     `json:"avatar_url" gorm:"type:text"`
	Description string     `json:"description" gorm:"type:text"`
	Notes       string     `json:"notes" gorm:"type:text"`

	// Ссылки на сущности
	RaceID       *uuid.UUID `json:"race_id" gorm:"type:uuid"`
	LineageID    *string    `json:"lineage_id" gorm:"type:varchar(100)"` // id варианта из race.lineages
	ClassID      *uuid.UUID `json:"class_id" gorm:"type:uuid"`
	BackgroundID *uuid.UUID `json:"background_id" gorm:"type:uuid"`
	Level        int        `json:"level" gorm:"not null;default:1"`

	// Списки ссылок (jsonb-массивы строковых uuid)
	FeatIDs     *Properties `json:"feat_ids" gorm:"type:jsonb"`
	SpellIDs    *Properties `json:"spell_ids" gorm:"type:jsonb"`
	ActionIDs   *Properties `json:"action_ids" gorm:"type:jsonb"`
	EffectIDs   *Properties `json:"effect_ids" gorm:"type:jsonb"`
	ResourceIDs *Properties `json:"resource_ids" gorm:"type:jsonb"`

	// Базовые (введённые) характеристики: {"str":15,"dex":14,...}
	Abilities *JSONMap `json:"abilities" gorm:"type:jsonb"`

	// Итоговые владения (jsonb-массивы)
	SkillProficiencies       *Properties `json:"skill_proficiencies" gorm:"type:jsonb"`
	SkillExpertise           *Properties `json:"skill_expertise" gorm:"type:jsonb"`
	SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies" gorm:"type:jsonb"`
	ToolProficiencies        *Properties `json:"tool_proficiencies" gorm:"type:jsonb"`
	ToolExpertise            *Properties `json:"tool_expertise" gorm:"type:jsonb"`
	Languages                *Properties `json:"languages" gorm:"type:jsonb"`

	// Разрешённые выборы из механики: {"<choiceId>": ["<optId>", ...]}
	ResolvedChoices *JSONMap `json:"resolved_choices" gorm:"type:jsonb"`

	// Снимок состояния правил: источники, применённые grants, конфликты, derived.
	RuleState *JSONMap `json:"rule_state" gorm:"type:jsonb"`

	// Снимок вычисляемых полей (для быстрого листа; можно пересчитать из ссылок)
	MaxHP             int `json:"max_hp" gorm:"default:0"`
	CurrentHP         int `json:"current_hp" gorm:"default:0"`
	Speed             int `json:"speed" gorm:"default:30"`
	ProficiencyBonus  int `json:"proficiency_bonus" gorm:"default:2"`
	ArmorClass        int `json:"armor_class" gorm:"default:10"`
	InitiativeBonus   int `json:"initiative_bonus" gorm:"default:0"`
	PassivePerception int `json:"passive_perception" gorm:"default:10"`

	// Runtime (фаза C1): экипировка, инвентарь, ресурсы боя
	Equipment      *JSONMap           `json:"equipment" gorm:"type:jsonb"`
	InventoryItems *InventoryItemRows `json:"inventory_items" gorm:"type:jsonb"`
	Resources      *JSONMap           `json:"resources" gorm:"type:jsonb"`
	MaxResources   *JSONMap           `json:"max_resources" gorm:"type:jsonb"`
	ActiveEffects  *ActiveEffectRows  `json:"active_effects" gorm:"type:jsonb"`
	TurnState      *JSONMap           `json:"turn_state" gorm:"type:jsonb"`
	Currency       *JSONMap           `json:"currency" gorm:"type:jsonb"`

	// Онлайн-бой: id текущего боя, в котором участвует персонаж (nil = не в бою).
	// Ставится/снимается сервером при add/remove комбатанта с этим characterId (см.
	// encounter_controller.go). Правило «один бой на персонажа» держится на этом поле.
	// НЕ входит в Update/PatchRuntime DTO — сохраняется как есть при load-then-save.
	CurrentEncounterID *uuid.UUID `json:"current_encounter_id" gorm:"type:uuid"`

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
	Description  string     `json:"description"`
	Notes        string     `json:"notes"`
	RaceID       *uuid.UUID `json:"race_id"`
	LineageID    *string    `json:"lineage_id"`
	ClassID      *uuid.UUID `json:"class_id"`
	BackgroundID *uuid.UUID `json:"background_id"`
	Level        int        `json:"level"`

	FeatIDs     *Properties `json:"feat_ids"`
	SpellIDs    *Properties `json:"spell_ids"`
	ActionIDs   *Properties `json:"action_ids"`
	EffectIDs   *Properties `json:"effect_ids"`
	ResourceIDs *Properties `json:"resource_ids"`

	Abilities *JSONMap `json:"abilities"`

	SkillProficiencies       *Properties `json:"skill_proficiencies"`
	SkillExpertise           *Properties `json:"skill_expertise"`
	SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies"`
	ToolProficiencies        *Properties `json:"tool_proficiencies"`
	ToolExpertise            *Properties `json:"tool_expertise"`
	Languages                *Properties `json:"languages"`

	ResolvedChoices *JSONMap `json:"resolved_choices"`
	RuleState       *JSONMap `json:"rule_state"`

	MaxHP             int `json:"max_hp"`
	CurrentHP         int `json:"current_hp"`
	Speed             int `json:"speed"`
	ProficiencyBonus  int `json:"proficiency_bonus"`
	ArmorClass        int `json:"armor_class"`
	InitiativeBonus   int `json:"initiative_bonus"`
	PassivePerception int `json:"passive_perception"`
}

// UpdateCharacterV3Request — запрос на обновление. Полная замена полей черновика
// (редактор держит полное состояние персонажа). Имя опционально.
type UpdateCharacterV3Request struct {
	Name         string     `json:"name"`
	AvatarURL    string     `json:"avatar_url"`
	Description  string     `json:"description"`
	Notes        string     `json:"notes"`
	RaceID       *uuid.UUID `json:"race_id"`
	LineageID    *string    `json:"lineage_id"`
	ClassID      *uuid.UUID `json:"class_id"`
	BackgroundID *uuid.UUID `json:"background_id"`
	Level        int        `json:"level"`

	FeatIDs     *Properties `json:"feat_ids"`
	SpellIDs    *Properties `json:"spell_ids"`
	ActionIDs   *Properties `json:"action_ids"`
	EffectIDs   *Properties `json:"effect_ids"`
	ResourceIDs *Properties `json:"resource_ids"`

	Abilities *JSONMap `json:"abilities"`

	SkillProficiencies       *Properties `json:"skill_proficiencies"`
	SkillExpertise           *Properties `json:"skill_expertise"`
	SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies"`
	ToolProficiencies        *Properties `json:"tool_proficiencies"`
	ToolExpertise            *Properties `json:"tool_expertise"`
	Languages                *Properties `json:"languages"`

	ResolvedChoices *JSONMap `json:"resolved_choices"`
	RuleState       *JSONMap `json:"rule_state"`

	MaxHP             int `json:"max_hp"`
	CurrentHP         int `json:"current_hp"`
	Speed             int `json:"speed"`
	ProficiencyBonus  int `json:"proficiency_bonus"`
	ArmorClass        int `json:"armor_class"`
	InitiativeBonus   int `json:"initiative_bonus"`
	PassivePerception int `json:"passive_perception"`
}

// PatchCharacterRuntimeRequest — частичное обновление runtime (не трогает черновик).
type PatchCharacterRuntimeRequest struct {
	CurrentHP      *int               `json:"current_hp"`
	MaxHP          *int               `json:"max_hp"`
	Equipment      *JSONMap           `json:"equipment"`
	InventoryItems *InventoryItemRows `json:"inventory_items"`
	Resources      *JSONMap           `json:"resources"`
	MaxResources   *JSONMap           `json:"max_resources"`
	ActiveEffects  *ActiveEffectRows  `json:"active_effects"`
	TurnState      *JSONMap           `json:"turn_state"`
	Currency       *JSONMap           `json:"currency"`
}

// InventoryItemRow — строка инвентаря персонажа v3.
// S4 контейнеры: ContainerID — card_id контейнера, в котором лежит предмет (пусто = верхний уровень).
// Поле jsonb, миграция не требуется (колонка inventory_items уже JSONB).
type InventoryItemRow struct {
	CardID      string `json:"card_id"`
	Qty         int    `json:"qty"`
	ContainerID string `json:"container_id,omitempty"`
}

// InventoryItemRows — jsonb-массив инвентаря.
type InventoryItemRows []InventoryItemRow

func (r *InventoryItemRows) Scan(value interface{}) error {
	if value == nil {
		*r = nil
		return nil
	}
	var data []byte
	switch v := value.(type) {
	case string:
		data = []byte(v)
	case []byte:
		data = v
	default:
		return fmt.Errorf("неподдерживаемый тип для InventoryItemRows: %T", value)
	}
	if len(data) == 0 || string(data) == "null" {
		*r = nil
		return nil
	}
	return json.Unmarshal(data, r)
}

func (r InventoryItemRows) Value() (driver.Value, error) {
	if r == nil {
		return nil, nil
	}
	return json.Marshal(r)
}

// ActiveEffectRow — активный эффект на листе v3 (runtime).
type ActiveEffectRow struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Mechanics  JSONMap `json:"mechanics"`
	RoundsLeft *int    `json:"roundsLeft,omitempty"`
	Expiry     *string `json:"expiry,omitempty"`
	Source     string  `json:"source"`
}

// ActiveEffectRows — jsonb-массив активных эффектов.
type ActiveEffectRows []ActiveEffectRow

func (r *ActiveEffectRows) Scan(value interface{}) error {
	if value == nil {
		*r = nil
		return nil
	}
	var data []byte
	switch v := value.(type) {
	case string:
		data = []byte(v)
	case []byte:
		data = v
	default:
		return fmt.Errorf("неподдерживаемый тип для ActiveEffectRows: %T", value)
	}
	if len(data) == 0 || string(data) == "null" {
		*r = nil
		return nil
	}
	return json.Unmarshal(data, r)
}

func (r ActiveEffectRows) Value() (driver.Value, error) {
	if r == nil {
		return nil, nil
	}
	return json.Marshal(r)
}
