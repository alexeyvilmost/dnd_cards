package main

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Rarity - редкость предмета
type Rarity string

const (
	RarityCommon   Rarity = "common"    // Обычное (белый)
	RarityUncommon Rarity = "uncommon"  // Необычное (зеленый)
	RarityRare     Rarity = "rare"      // Редкое (синий)
	RarityVeryRare Rarity = "very_rare" // Очень редкое (фиолетовый)
	RarityArtifact Rarity = "artifact"  // Артефакт (оранжевый)
)

// Properties - свойства предмета (массив строк)
type Properties []string

// Scan - кастомный сканер для Properties
func (p *Properties) Scan(value interface{}) error {
	if value == nil {
		*p = nil
		return nil
	}

	switch v := value.(type) {
	case string:
		// Если это JSON строка, парсим её
		if strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]") {
			return json.Unmarshal([]byte(v), p)
		}
		// Если это PostgreSQL массив, парсим его
		*p = parsePostgreSQLArray(v)
		return nil
	case []byte:
		// Если это JSON байты, парсим их
		if len(v) > 0 && v[0] == '[' {
			return json.Unmarshal(v, p)
		}
		// Если это PostgreSQL массив, парсим его
		*p = parsePostgreSQLArray(string(v))
		return nil
	default:
		return fmt.Errorf("неподдерживаемый тип для Properties: %T", value)
	}
}

// Value - кастомный value для Properties
func (p Properties) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return json.Marshal(p)
}

// parsePostgreSQLArray - парсинг PostgreSQL массива
func parsePostgreSQLArray(s string) Properties {
	// Убираем фигурные скобки
	s = strings.Trim(s, "{}")
	if s == "" {
		return Properties{}
	}

	// Разбиваем по запятым, учитывая кавычки
	var result Properties
	var current strings.Builder
	inQuotes := false

	for i := 0; i < len(s); i++ {
		char := s[i]
		if char == '"' {
			inQuotes = !inQuotes
		} else if char == ',' && !inQuotes {
			result = append(result, strings.TrimSpace(current.String()))
			current.Reset()
		} else {
			current.WriteByte(char)
		}
	}

	// Добавляем последний элемент
	if current.Len() > 0 {
		result = append(result, strings.TrimSpace(current.String()))
	}

	return result
}

const (
	PropertyConsumable = "consumable" // Расходуемое
	PropertySingleUse  = "single_use" // Одноразовое
	PropertyLight      = "light"      // Легкое
	PropertyHeavy      = "heavy"      // Тяжелое
	PropertyFinesse    = "finesse"    // Фехтовальное
	PropertyThrown     = "thrown"     // Метательное
	PropertyVersatile  = "versatile"  // Универсальное
	PropertyTwoHanded  = "two-handed" // Двуручное
	PropertyReach      = "reach"      // Досягаемости
	PropertyAmmunition = "ammunition" // Требует боеприпасы
	PropertyLoading    = "loading"    // Зарядка
	PropertySpecial    = "special"    // Особое
)

// BonusType - тип бонуса
type BonusType string

const (
	BonusDamage  BonusType = "damage"
	BonusDefense BonusType = "defense"
)

// Card - модель карточки
type Card struct {
	ID                  uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name                string         `json:"name" gorm:"not null"`
	Properties          *Properties    `json:"properties" gorm:"type:text[]"` // Храним как массив PostgreSQL
	Description         string         `json:"description" gorm:"type:text;not null"`
	ImageURL            string         `json:"image_url" gorm:"type:text"`
	Rarity              Rarity         `json:"rarity" gorm:"not null"`
	CardNumber          string         `json:"card_number" gorm:"uniqueIndex;not null"`
	Price               *int           `json:"price" gorm:"type:int"`
	Weight              *float64       `json:"weight" gorm:"type:decimal(5,2)"`
	BonusType           *BonusType     `json:"bonus_type" gorm:"type:varchar(50)"`
	BonusValue          *string        `json:"bonus_value" gorm:"type:varchar(20)"`
	DamageType          *string        `json:"damage_type" gorm:"type:varchar(20)"`
	DefenseType         *string        `json:"defense_type" gorm:"type:varchar(20)"`
	DescriptionFontSize *int           `json:"description_font_size" gorm:"type:int"`
	IsExtended          *bool          `json:"is_extended" gorm:"type:boolean;default:null"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	DeletedAt           gorm.DeletedAt `json:"-" gorm:"index"`
}

// CreateCardRequest - запрос на создание карточки
type CreateCardRequest struct {
	Name                string      `json:"name" binding:"required"`
	Properties          *Properties `json:"properties"`
	Description         string      `json:"description" binding:"required"`
	Rarity              Rarity      `json:"rarity" binding:"required"`
	ImageURL            string      `json:"image_url"`
	Price               *int        `json:"price"`
	Weight              *float64    `json:"weight"`
	BonusType           *BonusType  `json:"bonus_type"`
	BonusValue          *string     `json:"bonus_value"`
	DamageType          *string     `json:"damage_type"`
	DefenseType         *string     `json:"defense_type"`
	DescriptionFontSize *int        `json:"description_font_size"`
	IsExtended          *bool       `json:"is_extended"`
}

// UpdateCardRequest - запрос на обновление карточки
type UpdateCardRequest struct {
	Name                string      `json:"name"`
	Properties          *Properties `json:"properties"`
	Description         string      `json:"description"`
	Rarity              Rarity      `json:"rarity"`
	ImageURL            string      `json:"image_url"`
	Price               *int        `json:"price"`
	Weight              *float64    `json:"weight"`
	BonusType           *BonusType  `json:"bonus_type"`
	BonusValue          *string     `json:"bonus_value"`
	DamageType          *string     `json:"damage_type"`
	DefenseType         *string     `json:"defense_type"`
	DescriptionFontSize *int        `json:"description_font_size"`
	IsExtended          *bool       `json:"is_extended"`
}

// GenerateImageRequest - запрос на генерацию изображения
type GenerateImageRequest struct {
	CardID uuid.UUID `json:"card_id" binding:"required"`
	Prompt string    `json:"prompt"`
}

// ExportCardsRequest - запрос на экспорт карт
type ExportCardsRequest struct {
	CardIDs []uuid.UUID `json:"card_ids" binding:"required"`
}

// CardResponse - ответ с карточкой
type CardResponse struct {
	ID                  uuid.UUID   `json:"id"`
	Name                string      `json:"name"`
	Properties          *Properties `json:"properties"`
	Description         string      `json:"description"`
	ImageURL            string      `json:"image_url"`
	Rarity              Rarity      `json:"rarity"`
	CardNumber          string      `json:"card_number"`
	Price               *int        `json:"price"`
	Weight              *float64    `json:"weight"`
	BonusType           *BonusType  `json:"bonus_type"`
	BonusValue          *string     `json:"bonus_value"`
	DamageType          *string     `json:"damage_type"`
	DefenseType         *string     `json:"defense_type"`
	DescriptionFontSize *int        `json:"description_font_size"`
	IsExtended          *bool       `json:"is_extended"`
	CreatedAt           time.Time   `json:"created_at"`
	UpdatedAt           time.Time   `json:"updated_at"`
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
	if len(p) == 0 {
		return ""
	}

	// Возвращаем первое свойство для совместимости
	switch p[0] {
	case PropertyConsumable:
		return "Расходуемое"
	case PropertySingleUse:
		return "Одноразовое"
	case PropertyLight:
		return "Легкое"
	case PropertyHeavy:
		return "Тяжелое"
	case PropertyFinesse:
		return "Фехтовальное"
	case PropertyThrown:
		return "Метательное"
	case PropertyVersatile:
		return "Универсальное"
	case PropertyTwoHanded:
		return "Двуручное"
	case PropertyReach:
		return "Досягаемости"
	case PropertyAmmunition:
		return "Требует боеприпасы"
	case PropertyLoading:
		return "Зарядка"
	case PropertySpecial:
		return "Особое"
	default:
		return "Неизвестно"
	}
}

// GetLocalizedName - получение локализованного названия типа бонуса
func (bt BonusType) GetLocalizedName() string {
	switch bt {
	case BonusDamage:
		return "Урон"
	case BonusDefense:
		return "Защита"
	default:
		return string(bt)
	}
}

// WeaponTemplate представляет шаблон оружия
type WeaponTemplate struct {
	ID         string     `json:"id" gorm:"primaryKey;type:uuid"`
	Name       string     `json:"name" gorm:"not null"`
	NameEn     string     `json:"name_en" gorm:"not null"`
	Category   string     `json:"category" gorm:"not null"`    // simple_melee, martial_melee, simple_ranged, martial_ranged
	DamageType string     `json:"damage_type" gorm:"not null"` // slashing, piercing, bludgeoning
	Damage     string     `json:"damage" gorm:"not null"`      // 1d4, 1d6, 1d8, etc.
	Weight     float64    `json:"weight" gorm:"not null"`
	Price      int        `json:"price" gorm:"not null"`
	Properties Properties `json:"properties" gorm:"type:text[]"` // Храним как массив PostgreSQL
	ImagePath  string     `json:"image_path"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// WeaponTemplateResponse представляет ответ с шаблоном оружия
type WeaponTemplateResponse struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	NameEn     string   `json:"name_en"`
	Category   string   `json:"category"`
	DamageType string   `json:"damage_type"`
	Damage     string   `json:"damage"`
	Weight     float64  `json:"weight"`
	Price      int      `json:"price"`
	Properties []string `json:"properties"`
	ImagePath  string   `json:"image_path"`
}

// GetWeaponTemplatesRequest представляет запрос на получение шаблонов
type GetWeaponTemplatesRequest struct {
	Category string `json:"category"` // optional filter
}

// IsValidRarity - проверяет, является ли редкость допустимой
func IsValidRarity(rarity Rarity) bool {
	switch rarity {
	case RarityCommon, RarityUncommon, RarityRare, RarityVeryRare, RarityArtifact:
		return true
	default:
		return false
	}
}

// IsValidRarityString - проверяет строку редкости
func IsValidRarityString(rarity string) bool {
	switch Rarity(rarity) {
	case RarityCommon, RarityUncommon, RarityRare, RarityVeryRare, RarityArtifact:
		return true
	default:
		return false
	}
}

// IsValidBonusType - проверяет, является ли тип бонуса допустимым
func IsValidBonusType(bonusType BonusType) bool {
	switch bonusType {
	case BonusDamage, BonusDefense:
		return true
	default:
		return false
	}
}

// IsValidProperty - проверяет, является ли свойство допустимым
func IsValidProperty(property string) bool {
	switch property {
	case PropertyConsumable, PropertySingleUse, PropertyLight, PropertyHeavy,
		PropertyFinesse, PropertyThrown, PropertyVersatile, PropertyTwoHanded,
		PropertyReach, PropertyAmmunition, PropertyLoading, PropertySpecial:
		return true
	default:
		return false
	}
}

// ValidateProperties - проверяет массив свойств
func ValidateProperties(properties *Properties) bool {
	if properties == nil {
		return true
	}
	for _, prop := range *properties {
		if !IsValidProperty(prop) {
			return false
		}
	}
	return true
}

// ValidatePrice - проверяет цену
func ValidatePrice(price *int) bool {
	if price == nil {
		return true
	}
	return *price >= 1 && *price <= 50000
}

// ValidateWeight - проверяет вес
func ValidateWeight(weight *float64) bool {
	if weight == nil {
		return true
	}
	return *weight >= 0.01 && *weight <= 1000
}
