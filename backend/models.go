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

// ItemType - тип предмета
type ItemType string

const (
	ItemTypeWeapon     ItemType = "weapon"     // Оружие
	ItemTypeShield     ItemType = "shield"     // Щит
	ItemTypeHelmet     ItemType = "helmet"     // Головной убор
	ItemTypeChest      ItemType = "chest"      // Торс
	ItemTypeGloves     ItemType = "gloves"     // Перчатки
	ItemTypeCloak      ItemType = "cloak"      // Плащ
	ItemTypeBoots      ItemType = "boots"      // Обувь
	ItemTypeRing       ItemType = "ring"       // Кольцо
	ItemTypeNecklace   ItemType = "necklace"   // Ожерелье
	ItemTypePotion     ItemType = "potion"     // Зелье
	ItemTypeScroll     ItemType = "scroll"     // Свиток
	ItemTypeAmmunition ItemType = "ammunition" // Боеприпас
	ItemTypeFood       ItemType = "food"       // Еда
	ItemTypeTool       ItemType = "tool"       // Инструмент
	ItemTypeIngredient ItemType = "ingredient" // Ингредиент
	ItemTypeNone       ItemType = "none"       // Без типа
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
	// Свойства брони
	PropertyCloth       = "cloth"        // Ткань
	PropertyLightArmor  = "light_armor"  // Легкая броня
	PropertyMediumArmor = "medium_armor" // Средняя броня
	PropertyHeavyArmor  = "heavy_armor"  // Тяжелая броня
	// Новые свойства
	PropertyShield   = "shield"   // Щит
	PropertyRing     = "ring"     // Кольцо
	PropertyNecklace = "necklace" // Ожерелье
	PropertyCloak    = "cloak"    // Плащ
)

// BonusType - тип бонуса
type BonusType string

const (
	BonusDamage  BonusType = "damage"
	BonusDefense BonusType = "defense"
)

// TemplateType - тип шаблона
type TemplateType string

const (
	TemplateFalse TemplateType = "false"         // Обычная карта, не шаблон
	TemplateBoth  TemplateType = "template"      // И карта, и шаблон
	TemplateOnly  TemplateType = "only_template" // Только шаблон
)

// EffectTargetType - тип цели эффекта
type EffectTargetType string

const (
	EffectTargetCharacteristic EffectTargetType = "characteristic" // Характеристика
	EffectTargetSkill          EffectTargetType = "skill"          // Навык
	EffectTargetSavingThrow    EffectTargetType = "saving_throw"   // Спасбросок
)

// EffectModifier - модификатор эффекта
type EffectModifier string

const (
	EffectModifierPlus  EffectModifier = "+" // Увеличение
	EffectModifierMinus EffectModifier = "-" // Уменьшение
)

// CardEffect - структура эффекта предмета
type CardEffect struct {
	TargetType     EffectTargetType `json:"targetType"`     // Тип цели (характеристика/навык/спасбросок)
	TargetSpecific string           `json:"targetSpecific"` // Конкретная цель или "all"
	Modifier       EffectModifier   `json:"modifier"`       // Модификатор (+ или -)
	Value          int              `json:"value"`          // Значение эффекта
}

// CardEffects - массив эффектов
type CardEffects []CardEffect

// Scan - кастомный сканер для CardEffects
func (e *CardEffects) Scan(value interface{}) error {
	if value == nil {
		*e = nil
		return nil
	}

	switch v := value.(type) {
	case string:
		return json.Unmarshal([]byte(v), e)
	case []byte:
		return json.Unmarshal(v, e)
	default:
		return fmt.Errorf("неподдерживаемый тип для CardEffects: %T", value)
	}
}

// Value - кастомный value для CardEffects
func (e CardEffects) Value() (driver.Value, error) {
	if e == nil {
		return nil, nil
	}
	return json.Marshal(e)
}

// EquipmentSlot - слот экипировки
type EquipmentSlot string

const (
	SlotHead      EquipmentSlot = "head"      // Голова
	SlotBody      EquipmentSlot = "body"      // Тело
	SlotArms      EquipmentSlot = "arms"      // Наручи
	SlotFeet      EquipmentSlot = "feet"      // Обувь
	SlotCloak     EquipmentSlot = "cloak"     // Плащ
	SlotOneHand   EquipmentSlot = "one_hand"  // Одна рука
	SlotVersatile EquipmentSlot = "versatile" // Универсальное
	SlotTwoHands  EquipmentSlot = "two_hands" // Две руки
	SlotNecklace  EquipmentSlot = "necklace"  // Ожерелье
	SlotRing      EquipmentSlot = "ring"      // Кольцо
)

// Card - модель карточки
type Card struct {
	ID                           uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name                         string         `json:"name" gorm:"not null"`
	Properties                   *Properties    `json:"properties" gorm:"type:text[]"` // Храним как массив PostgreSQL
	Description                  string         `json:"description" gorm:"type:text;not null"`
	DetailedDescription          *string        `json:"detailed_description" gorm:"type:text"`
	ImageURL                     string         `json:"image_url" gorm:"type:text"`
	ImageCloudinaryID            string         `json:"image_cloudinary_id" gorm:"type:varchar(255)"`
	ImageCloudinaryURL           string         `json:"image_cloudinary_url" gorm:"type:text"`
	ImageGenerated               bool           `json:"image_generated" gorm:"type:boolean;default:false"`
	ImageGenerationPrompt        string         `json:"image_generation_prompt" gorm:"type:text"`
	Rarity                       Rarity         `json:"rarity" gorm:"not null"`
	CardNumber                   string         `json:"card_number" gorm:"uniqueIndex;not null"`
	Price                        *int           `json:"price" gorm:"type:int"`
	Weight                       *float64       `json:"weight" gorm:"type:decimal(5,2)"`
	BonusType                    *BonusType     `json:"bonus_type" gorm:"type:varchar(50)"`
	BonusValue                   *string        `json:"bonus_value" gorm:"type:varchar(20)"`
	DamageType                   *string        `json:"damage_type" gorm:"type:varchar(20)"`
	DefenseType                  *string        `json:"defense_type" gorm:"type:varchar(20)"`
	DescriptionFontSize          *int           `json:"description_font_size" gorm:"type:int"`
	TextAlignment                *string        `json:"text_alignment" gorm:"type:varchar(20)"`
	TextFontSize                 *int           `json:"text_font_size" gorm:"type:int"`
	ShowDetailedDescription      *bool          `json:"show_detailed_description" gorm:"type:boolean;default:false"`
	DetailedDescriptionAlignment *string        `json:"detailed_description_alignment" gorm:"type:varchar(20)"`
	DetailedDescriptionFontSize  *int           `json:"detailed_description_font_size" gorm:"type:int"`
	IsExtended                   *bool          `json:"is_extended" gorm:"type:boolean;default:null"`
	Author                       string         `json:"author" gorm:"type:varchar(255);default:'Admin'"`
	Source                       *string        `json:"source" gorm:"type:varchar(255)"`
	Type                         *string        `json:"type" gorm:"type:varchar(50)"`
	RelatedCards                 *Properties    `json:"related_cards" gorm:"type:text[]"`   // JSON массив ID
	RelatedActions               *Properties    `json:"related_actions" gorm:"type:text[]"` // JSON массив ID (плейсхолдер)
	RelatedEffects               *Properties    `json:"related_effects" gorm:"type:text[]"` // JSON массив ID (плейсхолдер)
	Attunement                   *string        `json:"attunement" gorm:"type:text"`
	Tags                         *Properties    `json:"tags" gorm:"type:text[]"`                             // Массив тегов
	IsTemplate                   TemplateType   `json:"is_template" gorm:"type:varchar(20);default:'false'"` // Тип шаблона
	Slot                         *EquipmentSlot `json:"slot" gorm:"type:varchar(20)"`                        // Слот экипировки
	Effects                      *CardEffects   `json:"effects" gorm:"type:jsonb"`                           // Эффекты предмета
	CreatedAt                    time.Time      `json:"created_at"`
	UpdatedAt                    time.Time      `json:"updated_at"`
	DeletedAt                    gorm.DeletedAt `json:"-" gorm:"index"`
}

// CreateCardRequest - запрос на создание карточки
type CreateCardRequest struct {
	Name                         string         `json:"name" binding:"required"`
	Properties                   *Properties    `json:"properties"`
	Description                  string         `json:"description" binding:"required"`
	DetailedDescription          *string        `json:"detailed_description"`
	Rarity                       Rarity         `json:"rarity" binding:"required"`
	ImageURL                     string         `json:"image_url"`
	Price                        *int           `json:"price"`
	Weight                       *float64       `json:"weight"`
	BonusType                    *BonusType     `json:"bonus_type"`
	BonusValue                   *string        `json:"bonus_value"`
	DamageType                   *string        `json:"damage_type"`
	DefenseType                  *string        `json:"defense_type"`
	DescriptionFontSize          *int           `json:"description_font_size"`
	TextAlignment                *string        `json:"text_alignment"`
	TextFontSize                 *int           `json:"text_font_size"`
	ShowDetailedDescription      *bool          `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string        `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int           `json:"detailed_description_font_size"`
	IsExtended                   *bool          `json:"is_extended"`
	Author                       string         `json:"author"`
	Source                       *string        `json:"source"`
	Type                         *string        `json:"type"`
	RelatedCards                 *Properties    `json:"related_cards"`
	RelatedActions               *Properties    `json:"related_actions"`
	RelatedEffects               *Properties    `json:"related_effects"`
	Attunement                   *string        `json:"attunement"`
	Tags                         *Properties    `json:"tags"`
	IsTemplate                   TemplateType   `json:"is_template"`
	Slot                         *EquipmentSlot `json:"slot"`
	Effects                      *CardEffects   `json:"effects"`
}

// UpdateCardRequest - запрос на обновление карточки
type UpdateCardRequest struct {
	Name                         string         `json:"name"`
	Properties                   *Properties    `json:"properties"`
	Description                  string         `json:"description"`
	DetailedDescription          *string        `json:"detailed_description"`
	Rarity                       Rarity         `json:"rarity"`
	ImageURL                     string         `json:"image_url"`
	Price                        *int           `json:"price"`
	Weight                       *float64       `json:"weight"`
	BonusType                    *BonusType     `json:"bonus_type"`
	BonusValue                   *string        `json:"bonus_value"`
	DamageType                   *string        `json:"damage_type"`
	DefenseType                  *string        `json:"defense_type"`
	DescriptionFontSize          *int           `json:"description_font_size"`
	TextAlignment                *string        `json:"text_alignment"`
	TextFontSize                 *int           `json:"text_font_size"`
	ShowDetailedDescription      *bool          `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string        `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int           `json:"detailed_description_font_size"`
	IsExtended                   *bool          `json:"is_extended"`
	Author                       string         `json:"author"`
	Source                       *string        `json:"source"`
	Type                         *string        `json:"type"`
	RelatedCards                 *Properties    `json:"related_cards"`
	RelatedActions               *Properties    `json:"related_actions"`
	RelatedEffects               *Properties    `json:"related_effects"`
	Attunement                   *string        `json:"attunement"`
	Tags                         *Properties    `json:"tags"`
	IsTemplate                   TemplateType   `json:"is_template"`
	Slot                         *EquipmentSlot `json:"slot"`
	Effects                      *CardEffects   `json:"effects"`
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
	ID                           uuid.UUID      `json:"id"`
	Name                         string         `json:"name"`
	Properties                   *Properties    `json:"properties"`
	Description                  string         `json:"description"`
	DetailedDescription          *string        `json:"detailed_description"`
	ImageURL                     string         `json:"image_url"`
	Rarity                       Rarity         `json:"rarity"`
	CardNumber                   string         `json:"card_number"`
	Price                        *int           `json:"price"`
	Weight                       *float64       `json:"weight"`
	BonusType                    *BonusType     `json:"bonus_type"`
	BonusValue                   *string        `json:"bonus_value"`
	DamageType                   *string        `json:"damage_type"`
	DefenseType                  *string        `json:"defense_type"`
	Type                         *string        `json:"type"`
	DescriptionFontSize          *int           `json:"description_font_size"`
	TextAlignment                *string        `json:"text_alignment"`
	TextFontSize                 *int           `json:"text_font_size"`
	ShowDetailedDescription      *bool          `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string        `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int           `json:"detailed_description_font_size"`
	IsExtended                   *bool          `json:"is_extended"`
	Tags                         *Properties    `json:"tags"`
	IsTemplate                   TemplateType   `json:"is_template"`
	Slot                         *EquipmentSlot `json:"slot"`
	Effects                      *CardEffects   `json:"effects"`
	CreatedAt                    time.Time      `json:"created_at"`
	UpdatedAt                    time.Time      `json:"updated_at"`
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
	case PropertyCloth:
		return "Ткань"
	case PropertyLightArmor:
		return "Легкая броня"
	case PropertyMediumArmor:
		return "Средняя броня"
	case PropertyHeavyArmor:
		return "Тяжелая броня"
	case PropertyShield:
		return "Щит"
	case PropertyRing:
		return "Кольцо"
	case PropertyNecklace:
		return "Ожерелье"
	case PropertyCloak:
		return "Плащ"
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

// GetLocalizedName - получение локализованного названия типа шаблона
func (tt TemplateType) GetLocalizedName() string {
	switch tt {
	case TemplateFalse:
		return "Обычная карта"
	case TemplateBoth:
		return "Карта и шаблон"
	case TemplateOnly:
		return "Только шаблон"
	default:
		return string(tt)
	}
}

// IsValidTemplateType - проверяет, является ли тип шаблона допустимым
func IsValidTemplateType(templateType TemplateType) bool {
	switch templateType {
	case TemplateFalse, TemplateBoth, TemplateOnly:
		return true
	default:
		return false
	}
}

// GetLocalizedName - получение локализованного названия слота экипировки
func (es EquipmentSlot) GetLocalizedName() string {
	switch es {
	case SlotHead:
		return "Голова"
	case SlotBody:
		return "Тело"
	case SlotArms:
		return "Наручи"
	case SlotFeet:
		return "Обувь"
	case SlotCloak:
		return "Плащ"
	case SlotOneHand:
		return "Одна рука"
	case SlotVersatile:
		return "Универсальное"
	case SlotTwoHands:
		return "Две руки"
	case SlotNecklace:
		return "Ожерелье"
	case SlotRing:
		return "Кольцо"
	default:
		return string(es)
	}
}

// IsValidEquipmentSlot - проверяет, является ли слот экипировки допустимым
func IsValidEquipmentSlot(slot EquipmentSlot) bool {
	switch slot {
	case SlotHead, SlotBody, SlotArms, SlotFeet, SlotCloak,
		SlotOneHand, SlotVersatile, SlotTwoHands, SlotNecklace, SlotRing:
		return true
	default:
		return false
	}
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
		PropertyReach, PropertyAmmunition, PropertyLoading, PropertySpecial,
		PropertyCloth, PropertyLightArmor, PropertyMediumArmor, PropertyHeavyArmor,
		PropertyShield, PropertyRing, PropertyNecklace, PropertyCloak:
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

// UserRole - роль пользователя в группе
type UserRole string

const (
	RoleDM     UserRole = "dm"     // Мастер игры
	RolePlayer UserRole = "player" // Игрок
)

// User - модель пользователя
type User struct {
	ID           uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Username     string         `json:"username" gorm:"uniqueIndex;not null"`
	Email        string         `json:"email" gorm:"uniqueIndex;not null"`
	PasswordHash string         `json:"-" gorm:"not null"` // Хеш пароля (не возвращаем в JSON)
	DisplayName  string         `json:"display_name" gorm:"not null"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
}

// Group - модель группы
type Group struct {
	ID          uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name        string         `json:"name" gorm:"not null"`
	Description string         `json:"description" gorm:"type:text"`
	DMID        uuid.UUID      `json:"dm_id" gorm:"not null"` // ID мастера игры
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`

	// Связи
	DM      User          `json:"dm" gorm:"foreignKey:DMID"`
	Members []GroupMember `json:"members" gorm:"foreignKey:GroupID"`
}

// GroupMember - участник группы
type GroupMember struct {
	ID      uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	GroupID uuid.UUID `json:"group_id" gorm:"not null"`
	UserID  uuid.UUID `json:"user_id" gorm:"not null"`
	Role    UserRole  `json:"role" gorm:"not null"`

	// Связи
	Group Group `json:"group" gorm:"foreignKey:GroupID"`
	User  User  `json:"user" gorm:"foreignKey:UserID"`

	// Индексы
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// InventoryType - тип инвентаря
type InventoryType string

const (
	InventoryTypePersonal  InventoryType = "personal"  // Личный инвентарь
	InventoryTypeGroup     InventoryType = "group"     // Групповой инвентарь
	InventoryTypeCharacter InventoryType = "character" // Инвентарь персонажа
)

// Inventory - модель инвентаря
type Inventory struct {
	ID          uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Type        InventoryType  `json:"type" gorm:"not null"`
	UserID      *uuid.UUID     `json:"user_id" gorm:"type:uuid"`      // Для личного инвентаря
	GroupID     *uuid.UUID     `json:"group_id" gorm:"type:uuid"`     // Для группового инвентаря
	CharacterID *uuid.UUID     `json:"character_id" gorm:"type:uuid"` // Для инвентаря персонажа
	Name        string         `json:"name" gorm:"not null"`          // Название инвентаря
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`

	// Связи
	User      *User           `json:"user,omitempty" gorm:"foreignKey:UserID"`
	Group     *Group          `json:"group,omitempty" gorm:"foreignKey:GroupID"`
	Character *Character      `json:"character,omitempty" gorm:"foreignKey:CharacterID"`
	Items     []InventoryItem `json:"items" gorm:"foreignKey:InventoryID"`
}

// InventoryItem - предмет в инвентаре
type InventoryItem struct {
	ID           uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	InventoryID  uuid.UUID      `json:"inventory_id" gorm:"not null"`
	CardID       uuid.UUID      `json:"card_id" gorm:"not null"`
	Quantity     int            `json:"quantity" gorm:"not null;default:1"`
	Notes        string         `json:"notes" gorm:"type:text"`                // Заметки игрока
	IsEquipped   bool           `json:"is_equipped" gorm:"default:false"`      // Надет ли предмет
	EquippedSlot *string        `json:"equipped_slot" gorm:"type:varchar(50)"` // Слот экипировки
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`

	// Связи
	Inventory Inventory `json:"inventory" gorm:"foreignKey:InventoryID"`
	Card      Card      `json:"card" gorm:"foreignKey:CardID"`
}

// AuthRequest - запрос на авторизацию
type AuthRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// RegisterRequest - запрос на регистрацию
type RegisterRequest struct {
	Username    string `json:"username" binding:"required,min=3,max=50"`
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=6"`
	DisplayName string `json:"display_name" binding:"required,min=1,max=100"`
}

// AuthResponse - ответ авторизации
type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

// CreateGroupRequest - запрос на создание группы
type CreateGroupRequest struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Description string `json:"description"`
}

// JoinGroupRequest - запрос на присоединение к группе
type JoinGroupRequest struct {
	GroupID uuid.UUID `json:"group_id" binding:"required"`
}

// CreateInventoryRequest - запрос на создание инвентаря
type CreateInventoryRequest struct {
	Type    InventoryType `json:"type" binding:"required"`
	GroupID *uuid.UUID    `json:"group_id"` // Для группового инвентаря
	Name    string        `json:"name" binding:"required,min=1,max=100"`
}

// AddItemToInventoryRequest - запрос на добавление предмета в инвентарь
type AddItemToInventoryRequest struct {
	CardID   uuid.UUID `json:"card_id" binding:"required"`
	Quantity int       `json:"quantity" binding:"required,min=1"`
	Notes    string    `json:"notes"`
}

// UpdateInventoryItemRequest - запрос на обновление предмета в инвентаре
type UpdateInventoryItemRequest struct {
	Quantity   int    `json:"quantity" binding:"required,min=0"`
	Notes      string `json:"notes"`
	IsEquipped *bool  `json:"is_equipped"` // Указатель для опциональности
}

// Character - модель персонажа D&D
type Character struct {
	ID        uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID    uuid.UUID      `json:"user_id" gorm:"not null"`
	GroupID   *uuid.UUID     `json:"group_id" gorm:"type:uuid"` // Может быть null для персонажей без группы
	Name      string         `json:"name" gorm:"not null"`
	Data      string         `json:"data" gorm:"type:text;not null"` // JSON строка с данными персонажа
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`

	// Связи
	User        User        `json:"user" gorm:"foreignKey:UserID"`
	Group       *Group      `json:"group,omitempty" gorm:"foreignKey:GroupID"`
	Inventories []Inventory `json:"inventories,omitempty" gorm:"foreignKey:CharacterID"`
}

// CreateCharacterRequest - запрос на создание персонажа
type CreateCharacterRequest struct {
	Name    string     `json:"name" binding:"required,min=1,max=100"`
	GroupID *uuid.UUID `json:"group_id"`                // Может быть null
	Data    string     `json:"data" binding:"required"` // JSON строка с данными персонажа
}

// UpdateCharacterRequest - запрос на обновление персонажа
type UpdateCharacterRequest struct {
	Name    string     `json:"name"`
	GroupID *uuid.UUID `json:"group_id"`
	Data    string     `json:"data"`
}

// CharacterResponse - ответ с персонажем
type CharacterResponse struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"user_id"`
	GroupID   *uuid.UUID `json:"group_id"`
	Name      string     `json:"name"`
	Data      string     `json:"data"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`

	// Связанные данные
	User        *User       `json:"user,omitempty"`
	Group       *Group      `json:"group,omitempty"`
	Inventories []Inventory `json:"inventories,omitempty"`
}

// ImportCharacterRequest - запрос на импорт персонажа из JSON
type ImportCharacterRequest struct {
	CharacterData string     `json:"character_data" binding:"required"` // JSON строка с данными персонажа
	GroupID       *uuid.UUID `json:"group_id"`                          // Может быть null
}

// ExportCharacterResponse - ответ с экспортом персонажа
type ExportCharacterResponse struct {
	CharacterData string `json:"character_data"` // JSON строка с данными персонажа
}

// ImageGenerationLog - лог генерации изображений
type ImageGenerationLog struct {
	ID               uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	EntityType       string    `json:"entity_type" gorm:"not null"`               // "card" или "weapon_template"
	EntityID         uuid.UUID `json:"entity_id" gorm:"not null"`                 // ID сущности
	CloudinaryID     string    `json:"cloudinary_id" gorm:"not null"`             // ID изображения в Cloudinary
	CloudinaryURL    string    `json:"cloudinary_url" gorm:"not null"`            // URL изображения
	GenerationPrompt string    `json:"generation_prompt" gorm:"type:text"`        // Промпт для генерации
	GenerationModel  string    `json:"generation_model" gorm:"type:varchar(100)"` // Модель ИИ
	GenerationTimeMs int       `json:"generation_time_ms" gorm:"type:int"`        // Время генерации в мс
	CreatedAt        time.Time `json:"created_at"`
}

// ImageLibrary - библиотека изображений
type ImageLibrary struct {
	ID               uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CloudinaryID     string     `json:"cloudinary_id" gorm:"uniqueIndex;not null"`
	CloudinaryURL    string     `json:"cloudinary_url" gorm:"not null"`
	OriginalName     *string    `json:"original_name"`
	FileSize         *int       `json:"file_size"`
	CardName         *string    `json:"card_name"`
	CardRarity       *string    `json:"card_rarity"`
	GenerationPrompt *string    `json:"generation_prompt"`
	GenerationModel  *string    `json:"generation_model"`
	GenerationTimeMs *int       `json:"generation_time_ms"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	DeletedAt        *time.Time `json:"deleted_at,omitempty" gorm:"index"`
}

// TableName указывает имя таблицы для GORM
func (ImageLibrary) TableName() string {
	return "image_library"
}

// CharacterV2 - новая упрощенная модель персонажа
type CharacterV2 struct {
	ID      uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID  uuid.UUID  `json:"user_id" gorm:"type:uuid;not null"`
	GroupID *uuid.UUID `json:"group_id" gorm:"type:uuid"`
	Name    string     `json:"name" gorm:"not null"`
	Race    string     `json:"race" gorm:"not null"`
	Class   string     `json:"class" gorm:"not null"`
	Level   int        `json:"level" gorm:"not null;default:1"`
	Speed   int        `json:"speed" gorm:"not null;default:30"`

	// Характеристики
	Strength     int `json:"strength" gorm:"not null;default:10"`
	Dexterity    int `json:"dexterity" gorm:"not null;default:10"`
	Constitution int `json:"constitution" gorm:"not null;default:10"`
	Intelligence int `json:"intelligence" gorm:"not null;default:10"`
	Wisdom       int `json:"wisdom" gorm:"not null;default:10"`
	Charisma     int `json:"charisma" gorm:"not null;default:10"`

	// Хиты
	MaxHP     int `json:"max_hp" gorm:"not null;default:1"`
	CurrentHP int `json:"current_hp" gorm:"not null;default:1"`

	// Владения спасбросками (JSON массив строк)
	SavingThrowProficiencies string `json:"saving_throw_proficiencies" gorm:"type:text"`

	// Владения навыками (JSON массив строк)
	SkillProficiencies string `json:"skill_proficiencies" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Связи
	User  User   `json:"user" gorm:"foreignKey:UserID"`
	Group *Group `json:"group" gorm:"foreignKey:GroupID"`
}

// TableName указывает имя таблицы для GORM
func (CharacterV2) TableName() string {
	return "characters_v2"
}

// ActionResource - ресурс действия
type ActionResource string

const (
	ResourceAction      ActionResource = "action"       // Основное действие
	ResourceBonusAction ActionResource = "bonus_action" // Бонусное действие
	ResourceReaction    ActionResource = "reaction"      // Ответное действие
	ResourceFreeAction  ActionResource = "free_action"   // Свободное действие
)

// ActionRecharge - перезарядка действия
type ActionRecharge string

const (
	RechargeCustom    ActionRecharge = "custom"     // Произвольная (Текст)
	RechargePerTurn   ActionRecharge = "per_turn"   // За ход
	RechargePerBattle ActionRecharge = "per_battle"  // За битву
	RechargeShortRest ActionRecharge = "short_rest" // За короткий отдых
	RechargeLongRest  ActionRecharge = "long_rest"  // За длинный отдых
)

// ActionType - тип действия
type ActionType string

const (
	ActionTypeBaseAction  ActionType = "base_action"   // Базовое действие
	ActionTypeClassFeature ActionType = "class_feature" // Умение класса
	ActionTypeItemProperty ActionType = "item_property" // Свойство предмета
)

// Script - JSON скрипт для действий
type Script map[string]interface{}

// Scan - кастомный сканер для Script
func (s *Script) Scan(value interface{}) error {
	if value == nil {
		*s = nil
		return nil
	}

	switch v := value.(type) {
	case string:
		return json.Unmarshal([]byte(v), s)
	case []byte:
		return json.Unmarshal(v, s)
	default:
		return fmt.Errorf("неподдерживаемый тип для Script: %T", value)
	}
}

// Value - кастомный value для Script
func (s Script) Value() (driver.Value, error) {
	if s == nil {
		return nil, nil
	}
	return json.Marshal(s)
}

// Action - модель действия D&D
type Action struct {
	ID                           uuid.UUID       `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name                         string          `json:"name" gorm:"not null"`
	Description                  string          `json:"description" gorm:"type:text;not null"`
	DetailedDescription          *string         `json:"detailed_description" gorm:"type:text"`
	ImageURL                     string          `json:"image_url" gorm:"type:text"`
	ImageCloudinaryID            string          `json:"image_cloudinary_id" gorm:"type:varchar(255)"`
	ImageCloudinaryURL           string          `json:"image_cloudinary_url" gorm:"type:text"`
	ImageGenerated               bool            `json:"image_generated" gorm:"type:boolean;default:false"`
	ImageGenerationPrompt        string          `json:"image_generation_prompt" gorm:"type:text"`
	Rarity                       Rarity          `json:"rarity" gorm:"not null"`
	CardNumber                   string          `json:"card_number" gorm:"uniqueIndex;not null"`
	Resource                     ActionResource  `json:"resource" gorm:"not null"`
	Recharge                     *ActionRecharge `json:"recharge" gorm:"type:varchar(50)"`
	RechargeCustom               *string         `json:"recharge_custom" gorm:"type:text"`
	Script                       *Script         `json:"script" gorm:"type:jsonb"`
	ActionType                   ActionType      `json:"action_type" gorm:"not null"`
	Type                         *string         `json:"type" gorm:"type:varchar(50)"`
	Author                       string          `json:"author" gorm:"type:varchar(255);default:'Admin'"`
	Source                       *string         `json:"source" gorm:"type:varchar(255)"`
	Tags                         *Properties     `json:"tags" gorm:"type:text[]"`
	Price                        *int            `json:"price" gorm:"type:int"`
	Weight                       *float64        `json:"weight" gorm:"type:decimal(5,2)"`
	Properties                   *Properties     `json:"properties" gorm:"type:text[]"`
	RelatedCards                 *Properties     `json:"related_cards" gorm:"type:text[]"`
	RelatedActions               *Properties     `json:"related_actions" gorm:"type:text[]"`
	IsExtended                   *bool           `json:"is_extended" gorm:"type:boolean;default:null"`
	DescriptionFontSize          *int            `json:"description_font_size" gorm:"type:int"`
	TextAlignment                *string         `json:"text_alignment" gorm:"type:varchar(20)"`
	TextFontSize                 *int            `json:"text_font_size" gorm:"type:int"`
	ShowDetailedDescription      *bool           `json:"show_detailed_description" gorm:"type:boolean;default:false"`
	DetailedDescriptionAlignment *string         `json:"detailed_description_alignment" gorm:"type:varchar(20)"`
	DetailedDescriptionFontSize *int            `json:"detailed_description_font_size" gorm:"type:int"`
	CreatedAt                    time.Time       `json:"created_at"`
	UpdatedAt                    time.Time       `json:"updated_at"`
	DeletedAt                    gorm.DeletedAt  `json:"-" gorm:"index"`
}

// TableName указывает имя таблицы для GORM
func (Action) TableName() string {
	return "actions"
}

// CreateActionRequest - запрос на создание действия
type CreateActionRequest struct {
	Name                         string          `json:"name" binding:"required"`
	Description                  string          `json:"description" binding:"required"`
	DetailedDescription          *string         `json:"detailed_description"`
	ImageURL                     string          `json:"image_url"`
	Rarity                       Rarity         `json:"rarity" binding:"required"`
	Resource                     ActionResource  `json:"resource" binding:"required"`
	Recharge                     *ActionRecharge `json:"recharge"`
	RechargeCustom               *string         `json:"recharge_custom"`
	Script                       *Script         `json:"script"`
	ActionType                   ActionType      `json:"action_type" binding:"required"`
	Type                         *string         `json:"type"`
	Author                       string          `json:"author"`
	Source                       *string         `json:"source"`
	Tags                         *Properties     `json:"tags"`
	Price                        *int            `json:"price"`
	Weight                       *float64        `json:"weight"`
	Properties                   *Properties     `json:"properties"`
	RelatedCards                 *Properties     `json:"related_cards"`
	RelatedActions               *Properties     `json:"related_actions"`
	IsExtended                   *bool           `json:"is_extended"`
	DescriptionFontSize          *int            `json:"description_font_size"`
	TextAlignment                *string         `json:"text_alignment"`
	TextFontSize                 *int            `json:"text_font_size"`
	ShowDetailedDescription      *bool           `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string         `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int            `json:"detailed_description_font_size"`
}

// UpdateActionRequest - запрос на обновление действия
type UpdateActionRequest struct {
	Name                         string          `json:"name"`
	Description                  string          `json:"description"`
	DetailedDescription          *string         `json:"detailed_description"`
	ImageURL                     string          `json:"image_url"`
	Rarity                       Rarity         `json:"rarity"`
	Resource                     ActionResource  `json:"resource"`
	Recharge                     *ActionRecharge `json:"recharge"`
	RechargeCustom               *string         `json:"recharge_custom"`
	Script                       *Script         `json:"script"`
	ActionType                   ActionType      `json:"action_type"`
	Type                         *string         `json:"type"`
	Author                       string          `json:"author"`
	Source                       *string         `json:"source"`
	Tags                         *Properties     `json:"tags"`
	Price                        *int            `json:"price"`
	Weight                       *float64        `json:"weight"`
	Properties                   *Properties     `json:"properties"`
	RelatedCards                 *Properties     `json:"related_cards"`
	RelatedActions               *Properties     `json:"related_actions"`
	IsExtended                   *bool           `json:"is_extended"`
	DescriptionFontSize          *int            `json:"description_font_size"`
	TextAlignment                *string         `json:"text_alignment"`
	TextFontSize                 *int            `json:"text_font_size"`
	ShowDetailedDescription      *bool           `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string         `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int            `json:"detailed_description_font_size"`
}

// ActionResponse - ответ с действием
type ActionResponse struct {
	ID                           uuid.UUID      `json:"id"`
	Name                         string         `json:"name"`
	Description                  string         `json:"description"`
	DetailedDescription          *string        `json:"detailed_description"`
	ImageURL                     string         `json:"image_url"`
	Rarity                       Rarity         `json:"rarity"`
	CardNumber                   string         `json:"card_number"`
	Resource                     ActionResource `json:"resource"`
	Recharge                     *ActionRecharge `json:"recharge"`
	RechargeCustom               *string         `json:"recharge_custom"`
	Script                       *Script        `json:"script"`
	ActionType                   ActionType     `json:"action_type"`
	Type                         *string        `json:"type"`
	Tags                         *Properties    `json:"tags"`
	Price                        *int           `json:"price"`
	Weight                       *float64       `json:"weight"`
	Properties                   *Properties    `json:"properties"`
	IsExtended                   *bool          `json:"is_extended"`
	DescriptionFontSize          *int           `json:"description_font_size"`
	TextAlignment                *string        `json:"text_alignment"`
	TextFontSize                 *int           `json:"text_font_size"`
	ShowDetailedDescription      *bool          `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string        `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int            `json:"detailed_description_font_size"`
	CreatedAt                    time.Time      `json:"created_at"`
	UpdatedAt                    time.Time      `json:"updated_at"`
}

// GetLocalizedName - получение локализованного названия ресурса действия
func (ar ActionResource) GetLocalizedName() string {
	switch ar {
	case ResourceAction:
		return "Основное действие"
	case ResourceBonusAction:
		return "Бонусное действие"
	case ResourceReaction:
		return "Ответное действие"
	case ResourceFreeAction:
		return "Свободное действие"
	default:
		return string(ar)
	}
}

// GetLocalizedName - получение локализованного названия перезарядки
func (ar ActionRecharge) GetLocalizedName() string {
	switch ar {
	case RechargeCustom:
		return "Произвольная"
	case RechargePerTurn:
		return "За ход"
	case RechargePerBattle:
		return "За битву"
	case RechargeShortRest:
		return "За короткий отдых"
	case RechargeLongRest:
		return "За длинный отдых"
	default:
		return string(ar)
	}
}

// GetLocalizedName - получение локализованного названия типа действия
func (at ActionType) GetLocalizedName() string {
	switch at {
	case ActionTypeBaseAction:
		return "Базовое действие"
	case ActionTypeClassFeature:
		return "Умение класса"
	case ActionTypeItemProperty:
		return "Свойство предмета"
	default:
		return string(at)
	}
}

// EffectType - тип пассивного эффекта
type EffectType string

const (
	EffectTypePassive    EffectType = "passive"    // Пассивный (всегда активен)
	EffectTypeConditional EffectType = "conditional" // Условный (активен при условиях)
	EffectTypeTriggered  EffectType = "triggered"  // Срабатывающий (активируется при событиях)
)

// Effect - модель пассивного эффекта D&D
type Effect struct {
	ID                           uuid.UUID       `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name                         string          `json:"name" gorm:"not null"`
	Description                  string          `json:"description" gorm:"type:text;not null"`
	DetailedDescription          *string         `json:"detailed_description" gorm:"type:text"`
	ImageURL                     string          `json:"image_url" gorm:"type:text"`
	ImageCloudinaryID            string          `json:"image_cloudinary_id" gorm:"type:varchar(255)"`
	ImageCloudinaryURL           string          `json:"image_cloudinary_url" gorm:"type:text"`
	ImageGenerated               bool            `json:"image_generated" gorm:"type:boolean;default:false"`
	ImageGenerationPrompt        string          `json:"image_generation_prompt" gorm:"type:text"`
	Rarity                       Rarity          `json:"rarity" gorm:"not null"`
	CardNumber                   string          `json:"card_number" gorm:"uniqueIndex;not null"`
	EffectType                   EffectType      `json:"effect_type" gorm:"not null"`
	ConditionDescription         *string         `json:"condition_description" gorm:"type:text"`
	Script                       *Script         `json:"script" gorm:"type:jsonb"`
	Type                         *string         `json:"type" gorm:"type:varchar(50)"`
	Author                       string          `json:"author" gorm:"type:varchar(255);default:'Admin'"`
	Source                       *string         `json:"source" gorm:"type:varchar(255)"`
	Tags                         *Properties     `json:"tags" gorm:"type:text[]"`
	Price                        *int            `json:"price" gorm:"type:int"`
	Weight                       *float64        `json:"weight" gorm:"type:decimal(5,2)"`
	Properties                   *Properties     `json:"properties" gorm:"type:text[]"`
	RelatedCards                 *Properties     `json:"related_cards" gorm:"type:text[]"`
	RelatedActions               *Properties     `json:"related_actions" gorm:"type:text[]"`
	RelatedEffects               *Properties     `json:"related_effects" gorm:"type:text[]"`
	IsExtended                   *bool           `json:"is_extended" gorm:"type:boolean;default:null"`
	DescriptionFontSize          *int            `json:"description_font_size" gorm:"type:int"`
	TextAlignment                *string         `json:"text_alignment" gorm:"type:varchar(20)"`
	TextFontSize                 *int            `json:"text_font_size" gorm:"type:int"`
	ShowDetailedDescription      *bool           `json:"show_detailed_description" gorm:"type:boolean;default:false"`
	DetailedDescriptionAlignment *string         `json:"detailed_description_alignment" gorm:"type:varchar(20)"`
	DetailedDescriptionFontSize *int            `json:"detailed_description_font_size" gorm:"type:int"`
	CreatedAt                    time.Time       `json:"created_at"`
	UpdatedAt                    time.Time       `json:"updated_at"`
	DeletedAt                    gorm.DeletedAt  `json:"-" gorm:"index"`
}

// TableName указывает имя таблицы для GORM
func (Effect) TableName() string {
	return "effects"
}

// CreateEffectRequest - запрос на создание эффекта
type CreateEffectRequest struct {
	Name                         string          `json:"name" binding:"required"`
	Description                  string          `json:"description" binding:"required"`
	DetailedDescription          *string         `json:"detailed_description"`
	ImageURL                     string          `json:"image_url"`
	Rarity                       Rarity         `json:"rarity" binding:"required"`
	EffectType                   EffectType      `json:"effect_type" binding:"required"`
	ConditionDescription         *string         `json:"condition_description"`
	Script                       *Script         `json:"script"`
	Type                         *string         `json:"type"`
	Author                       string          `json:"author"`
	Source                       *string         `json:"source"`
	Tags                         *Properties     `json:"tags"`
	Price                        *int            `json:"price"`
	Weight                       *float64        `json:"weight"`
	Properties                   *Properties     `json:"properties"`
	RelatedCards                 *Properties     `json:"related_cards"`
	RelatedActions               *Properties     `json:"related_actions"`
	RelatedEffects               *Properties     `json:"related_effects"`
	IsExtended                   *bool           `json:"is_extended"`
	DescriptionFontSize          *int            `json:"description_font_size"`
	TextAlignment                *string         `json:"text_alignment"`
	TextFontSize                 *int            `json:"text_font_size"`
	ShowDetailedDescription      *bool           `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string         `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int            `json:"detailed_description_font_size"`
}

// UpdateEffectRequest - запрос на обновление эффекта
type UpdateEffectRequest struct {
	Name                         string          `json:"name"`
	Description                  string          `json:"description"`
	DetailedDescription          *string         `json:"detailed_description"`
	ImageURL                     string          `json:"image_url"`
	Rarity                       Rarity         `json:"rarity"`
	EffectType                   EffectType      `json:"effect_type"`
	ConditionDescription         *string         `json:"condition_description"`
	Script                       *Script         `json:"script"`
	Type                         *string         `json:"type"`
	Author                       string          `json:"author"`
	Source                       *string         `json:"source"`
	Tags                         *Properties     `json:"tags"`
	Price                        *int            `json:"price"`
	Weight                       *float64        `json:"weight"`
	Properties                   *Properties     `json:"properties"`
	RelatedCards                 *Properties     `json:"related_cards"`
	RelatedActions               *Properties     `json:"related_actions"`
	RelatedEffects               *Properties     `json:"related_effects"`
	IsExtended                   *bool           `json:"is_extended"`
	DescriptionFontSize          *int            `json:"description_font_size"`
	TextAlignment                *string         `json:"text_alignment"`
	TextFontSize                 *int            `json:"text_font_size"`
	ShowDetailedDescription      *bool           `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string         `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int            `json:"detailed_description_font_size"`
}

// EffectResponse - ответ с эффектом
type EffectResponse struct {
	ID                           uuid.UUID      `json:"id"`
	Name                         string         `json:"name"`
	Description                  string         `json:"description"`
	DetailedDescription          *string        `json:"detailed_description"`
	ImageURL                     string         `json:"image_url"`
	Rarity                       Rarity         `json:"rarity"`
	CardNumber                   string         `json:"card_number"`
	EffectType                   EffectType     `json:"effect_type"`
	ConditionDescription         *string        `json:"condition_description"`
	Script                       *Script        `json:"script"`
	Type                         *string        `json:"type"`
	Tags                         *Properties    `json:"tags"`
	Price                        *int           `json:"price"`
	Weight                       *float64       `json:"weight"`
	Properties                   *Properties    `json:"properties"`
	IsExtended                   *bool          `json:"is_extended"`
	DescriptionFontSize          *int           `json:"description_font_size"`
	TextAlignment                *string        `json:"text_alignment"`
	TextFontSize                 *int           `json:"text_font_size"`
	ShowDetailedDescription      *bool          `json:"show_detailed_description"`
	DetailedDescriptionAlignment *string        `json:"detailed_description_alignment"`
	DetailedDescriptionFontSize  *int            `json:"detailed_description_font_size"`
	CreatedAt                    time.Time      `json:"created_at"`
	UpdatedAt                    time.Time      `json:"updated_at"`
}

// GetLocalizedName - получение локализованного названия типа эффекта
func (et EffectType) GetLocalizedName() string {
	switch et {
	case EffectTypePassive:
		return "Пассивный"
	case EffectTypeConditional:
		return "Условный"
	case EffectTypeTriggered:
		return "Срабатывающий"
	default:
		return string(et)
	}
}

// CreateCharacterV2Request - запрос на создание персонажа V2
type CreateCharacterV2Request struct {
	Name                     string   `json:"name" binding:"required"`
	Race                     string   `json:"race" binding:"required"`
	Class                    string   `json:"class" binding:"required"`
	Level                    int      `json:"level" binding:"required,min=1,max=20"`
	Speed                    int      `json:"speed" binding:"required,min=1"`
	Strength                 int      `json:"strength" binding:"required,min=1,max=30"`
	Dexterity                int      `json:"dexterity" binding:"required,min=1,max=30"`
	Constitution             int      `json:"constitution" binding:"required,min=1,max=30"`
	Intelligence             int      `json:"intelligence" binding:"required,min=1,max=30"`
	Wisdom                   int      `json:"wisdom" binding:"required,min=1,max=30"`
	Charisma                 int      `json:"charisma" binding:"required,min=1,max=30"`
	MaxHP                    int      `json:"max_hp" binding:"required,min=1"`
	CurrentHP                int      `json:"current_hp" binding:"required,min=0"`
	SavingThrowProficiencies []string `json:"saving_throw_proficiencies"`
	SkillProficiencies       []string `json:"skill_proficiencies"`
}

// UpdateCharacterV2Request - запрос на обновление персонажа V2
type UpdateCharacterV2Request struct {
	Name                     string   `json:"name"`
	Race                     string   `json:"race"`
	Class                    string   `json:"class"`
	Level                    int      `json:"level" binding:"min=1,max=20"`
	Speed                    int      `json:"speed" binding:"min=1"`
	Strength                 int      `json:"strength" binding:"min=1,max=30"`
	Dexterity                int      `json:"dexterity" binding:"min=1,max=30"`
	Constitution             int      `json:"constitution" binding:"min=1,max=30"`
	Intelligence             int      `json:"intelligence" binding:"min=1,max=30"`
	Wisdom                   int      `json:"wisdom" binding:"min=1,max=30"`
	Charisma                 int      `json:"charisma" binding:"min=1,max=30"`
	MaxHP                    int      `json:"max_hp" binding:"min=1"`
	CurrentHP                int      `json:"current_hp" binding:"min=0"`
	SavingThrowProficiencies []string `json:"saving_throw_proficiencies"`
	SkillProficiencies       []string `json:"skill_proficiencies"`
}

// CharacterV2Response - ответ с данными персонажа V2
type CharacterV2Response struct {
	ID                       uuid.UUID  `json:"id"`
	UserID                   uuid.UUID  `json:"user_id"`
	GroupID                  *uuid.UUID `json:"group_id"`
	Name                     string     `json:"name"`
	Race                     string     `json:"race"`
	Class                    string     `json:"class"`
	Level                    int        `json:"level"`
	Speed                    int        `json:"speed"`
	Strength                 int        `json:"strength"`
	Dexterity                int        `json:"dexterity"`
	Constitution             int        `json:"constitution"`
	Intelligence             int        `json:"intelligence"`
	Wisdom                   int        `json:"wisdom"`
	Charisma                 int        `json:"charisma"`
	MaxHP                    int        `json:"max_hp"`
	CurrentHP                int        `json:"current_hp"`
	SavingThrowProficiencies []string   `json:"saving_throw_proficiencies"`
	SkillProficiencies       []string   `json:"skill_proficiencies"`
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
	User                     User       `json:"user"`
	Group                    *Group     `json:"group"`
}
