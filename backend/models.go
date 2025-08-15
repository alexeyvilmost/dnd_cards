package main

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Rarity - редкость предмета
type Rarity string

const (
	RarityCommon    Rarity = "common"     // Обычное (белый)
	RarityUncommon  Rarity = "uncommon"   // Необычное (зеленый)
	RarityRare      Rarity = "rare"       // Редкое (синий)
	RarityVeryRare  Rarity = "very_rare"  // Очень редкое (фиолетовый)
	RarityArtifact  Rarity = "artifact"   // Артефакт (оранжевый)
)

// Properties - свойства зелья
type Properties string

const (
	PropertyConsumable Properties = "consumable" // Расходуемое
	PropertySingleUse  Properties = "single_use" // Одноразовое
)

// Card - модель карточки
type Card struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name        string     `json:"name" gorm:"not null"`
	Properties  Properties `json:"properties" gorm:"not null"`
	Description string     `json:"description" gorm:"type:text;not null"`
	ImageURL    string     `json:"image_url" gorm:"type:text"`
	Rarity      Rarity     `json:"rarity" gorm:"not null"`
	CardNumber  string     `json:"card_number" gorm:"uniqueIndex;not null"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

// CreateCardRequest - запрос на создание карточки
type CreateCardRequest struct {
	Name        string     `json:"name" binding:"required"`
	Properties  Properties `json:"properties" binding:"required"`
	Description string     `json:"description" binding:"required"`
	Rarity      Rarity     `json:"rarity" binding:"required"`
}

// UpdateCardRequest - запрос на обновление карточки
type UpdateCardRequest struct {
	Name        string     `json:"name"`
	Properties  Properties `json:"properties"`
	Description string     `json:"description"`
	Rarity      Rarity     `json:"rarity"`
}

// GenerateImageRequest - запрос на генерацию изображения
type GenerateImageRequest struct {
	CardID   uuid.UUID `json:"card_id" binding:"required"`
	Prompt   string    `json:"prompt"`
}

// ExportCardsRequest - запрос на экспорт карт
type ExportCardsRequest struct {
	CardIDs []uuid.UUID `json:"card_ids" binding:"required"`
}

// CardResponse - ответ с карточкой
type CardResponse struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	Properties  Properties `json:"properties"`
	Description string     `json:"description"`
	ImageURL    string     `json:"image_url"`
	Rarity      Rarity     `json:"rarity"`
	CardNumber  string     `json:"card_number"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// GetRarityColor - получение цвета для редкости
func (r Rarity) GetColor() string {
	switch r {
	case RarityCommon:
		return "#FFFFFF" // Белый
	case RarityUncommon:
		return "#00FF00" // Зеленый
	case RarityRare:
		return "#0080FF" // Синий
	case RarityVeryRare:
		return "#8000FF" // Фиолетовый
	case RarityArtifact:
		return "#FF8000" // Оранжевый
	default:
		return "#FFFFFF"
	}
}

// GetRarityName - получение названия редкости на русском
func (r Rarity) GetRarityName() string {
	switch r {
	case RarityCommon:
		return "Обычное"
	case RarityUncommon:
		return "Необычное"
	case RarityRare:
		return "Редкое"
	case RarityVeryRare:
		return "Очень редкое"
	case RarityArtifact:
		return "Артефакт"
	default:
		return "Неизвестно"
	}
}

// GetPropertiesName - получение названия свойств на русском
func (p Properties) GetPropertiesName() string {
	switch p {
	case PropertyConsumable:
		return "Расходуемое"
	case PropertySingleUse:
		return "Одноразовое"
	default:
		return "Неизвестно"
	}
}
