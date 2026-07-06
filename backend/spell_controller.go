package main

import (
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SpellController - контроллер для работы с заклинаниями
type SpellController struct {
	db            *gorm.DB
	openaiService *OpenAIService
}

// NewSpellController - создание нового контроллера заклинаний
func NewSpellController(db *gorm.DB) *SpellController {
	return &SpellController{
		db:            db,
		openaiService: NewOpenAIService(),
	}
}

// GetSpells - получение списка заклинаний с фильтрацией
func (sc *SpellController) GetSpells(c *gin.Context) {
	var spells []Spell

	query := sc.db.Model(&Spell{})

	// Фильтрация по редкости
	if rarity := c.Query("rarity"); rarity != "" {
		query = query.Where("rarity = ?", rarity)
	}

	// Фильтрация по уровню
	if level := c.Query("level"); level != "" {
		query = query.Where("level = ?", level)
	}

	// Фильтрация по школе
	if school := c.Query("school"); school != "" {
		query = query.Where("school = ?", school)
	}

	// Фильтрация по классу
	if class := c.Query("class"); class != "" {
		query = query.Where("classes::text ILIKE ?", "%"+class+"%")
	}

	// Фильтрация по подклассу
	if subclass := c.Query("subclass"); subclass != "" {
		query = query.Where("subclasses::text ILIKE ?", "%"+subclass+"%")
	}

	// Фильтрация по концентрации
	if conc := c.Query("concentration"); conc == "true" || conc == "false" {
		query = query.Where("concentration = ?", conc == "true")
	}

	// Фильтрация по ритуалу
	if ritual := c.Query("ritual"); ritual == "true" || ritual == "false" {
		query = query.Where("ritual = ?", ritual == "true")
	}

	// Поиск по названию или card_number
	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ? OR card_number = ?", "%"+search+"%", search)
	}

	// Пагинация
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset := (page - 1) * limit

	// Подсчет общего количества
	var total int64
	query.Count(&total)

	// Получение заклинаний (по умолчанию сортировка по уровню, затем по названию)
	sortClause := "level ASC, name ASC"
	if c.Query("sort_by") == "created_desc" {
		sortClause = "created_at DESC"
	}
	if err := query.Order(sortClause).Offset(offset).Limit(limit).Find(&spells).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения заклинаний"})
		return
	}

	// Преобразование в ответы
	responses := make([]SpellResponse, 0)
	for _, spell := range spells {
		responses = append(responses, spell.ToSpellResponse())
	}

	c.JSON(http.StatusOK, gin.H{
		"spells": responses,
		"total":  total,
		"page":   page,
		"limit":  limit,
	})
}

// GetSpell - получение заклинания по ID (UUID) или card_number
func (sc *SpellController) GetSpell(c *gin.Context) {
	idParam := c.Param("id")

	var spell Spell
	var err error

	if id, uuidErr := uuid.Parse(idParam); uuidErr == nil {
		err = sc.db.Where("id = ?", id).First(&spell).Error
	} else {
		err = sc.db.Where("card_number = ?", idParam).First(&spell).Error
	}

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Заклинание не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения заклинания"})
		return
	}

	c.JSON(http.StatusOK, spell.ToSpellResponse())
}

// CreateSpell - создание нового заклинания
func (sc *SpellController) CreateSpell(c *gin.Context) {
	var req CreateSpellRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	// Заклинания по умолчанию обычной редкости
	if req.Rarity == "" {
		req.Rarity = RarityCommon
	}
	if !IsValidRarity(req.Rarity) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая редкость"})
		return
	}

	if req.Level < 0 || req.Level > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Уровень должен быть от 0 до 12"})
		return
	}

	// Проверка уникальности card_number (ID заклинания)
	cardNumber := req.CardNumber
	if cardNumber == "" {
		cardNumber = sc.generateSpellNumber()
	} else {
		var existingSpell Spell
		if err := sc.db.Where("card_number = ?", cardNumber).First(&existingSpell).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Заклинание с таким ID уже существует"})
			return
		}
		matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,30}$", cardNumber)
		if !matched {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов"})
			return
		}
	}

	spell := Spell{
		Name:                req.Name,
		Description:         req.Description,
		DetailedDescription: req.DetailedDescription,
		ImageURL:            req.ImageURL,
		Rarity:              req.Rarity,
		CardNumber:          cardNumber,
		Level:               req.Level,
		School:              req.School,
		CastingTime:         req.CastingTime,
		Range:               req.Range,
		ComponentVerbal:     req.ComponentVerbal,
		ComponentSomatic:    req.ComponentSomatic,
		ComponentMaterial:   req.ComponentMaterial,
		MaterialText:        req.MaterialText,
		Duration:            req.Duration,
		Classes:             req.Classes,
		Subclasses:          req.Subclasses,
		AttackRoll:          req.AttackRoll,
		SavingThrow:         req.SavingThrow,
		Concentration:       req.Concentration,
		Ritual:              req.Ritual,
		Resources:           req.Resources,
		SaveTypes:           req.SaveTypes,
		Damage:              req.Damage,
		Area:                req.Area,
		IsHealing:           req.IsHealing,
		HealDice:            req.HealDice,
		SaveOutcome:         req.SaveOutcome,
		UpcastDescription:   req.UpcastDescription,
		Mechanics:           req.Mechanics,
		Type:                req.Type,
		Author:              req.Author,
		Source:              req.Source,
		Tags:                req.Tags,
		IsExtended:          req.IsExtended,
	}

	if req.Author == "" {
		spell.Author = "Admin"
	}

	if err := sc.db.Create(&spell).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "UNIQUE constraint") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Заклинание с таким ID уже существует"})
			return
		}
		log.Printf("Ошибка создания заклинания: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка создания заклинания: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, spell.ToSpellResponse())
}

// UpdateSpell - обновление заклинания
func (sc *SpellController) UpdateSpell(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID заклинания"})
		return
	}

	var req UpdateSpellRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	var spell Spell
	if err := sc.db.Where("id = ?", id).First(&spell).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Заклинание не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения заклинания"})
		return
	}

	// Обновление полей
	if req.Name != "" {
		spell.Name = req.Name
	}
	if req.Description != "" {
		spell.Description = req.Description
	}
	if req.DetailedDescription != nil {
		spell.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		spell.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		spell.Rarity = req.Rarity
	}
	if req.CardNumber != nil && *req.CardNumber != "" && *req.CardNumber != spell.CardNumber {
		cardNumber := *req.CardNumber
		matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,30}$", cardNumber)
		if !matched {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов"})
			return
		}
		var existing Spell
		if err := sc.db.Where("card_number = ? AND id <> ?", cardNumber, spell.ID).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Заклинание с таким ID уже существует"})
			return
		}
		spell.CardNumber = cardNumber
	}
	if req.Level != nil {
		if *req.Level >= 0 && *req.Level <= 12 {
			spell.Level = *req.Level
		}
	}
	if req.School != nil {
		spell.School = req.School
	}
	if req.CastingTime != nil {
		spell.CastingTime = req.CastingTime
	}
	if req.Range != nil {
		spell.Range = req.Range
	}
	if req.ComponentVerbal != nil {
		spell.ComponentVerbal = *req.ComponentVerbal
	}
	if req.ComponentSomatic != nil {
		spell.ComponentSomatic = *req.ComponentSomatic
	}
	if req.ComponentMaterial != nil {
		spell.ComponentMaterial = *req.ComponentMaterial
	}
	if req.MaterialText != nil {
		spell.MaterialText = req.MaterialText
	}
	if req.Duration != nil {
		spell.Duration = req.Duration
	}
	if req.Classes != nil {
		spell.Classes = req.Classes
	}
	if req.Subclasses != nil {
		spell.Subclasses = req.Subclasses
	}
	if req.AttackRoll != nil {
		spell.AttackRoll = *req.AttackRoll
	}
	if req.SavingThrow != nil {
		spell.SavingThrow = *req.SavingThrow
	}
	if req.Concentration != nil {
		spell.Concentration = *req.Concentration
	}
	if req.Ritual != nil {
		spell.Ritual = *req.Ritual
	}
	if req.Resources != nil {
		spell.Resources = req.Resources
	}
	if req.SaveTypes != nil {
		spell.SaveTypes = req.SaveTypes
	}
	if req.Damage != nil {
		spell.Damage = req.Damage
	}
	if req.Area != nil {
		spell.Area = req.Area
	}
	if req.IsHealing != nil {
		spell.IsHealing = *req.IsHealing
	}
	if req.HealDice != nil {
		spell.HealDice = req.HealDice
	}
	if req.SaveOutcome != nil {
		spell.SaveOutcome = req.SaveOutcome
	}
	if req.UpcastDescription != nil {
		spell.UpcastDescription = req.UpcastDescription
	}
	if req.Mechanics != nil {
		if len(*req.Mechanics) == 0 {
			spell.Mechanics = nil
		} else {
			spell.Mechanics = req.Mechanics
		}
	}
	if req.Type != nil {
		spell.Type = req.Type
	}
	if req.Author != "" {
		spell.Author = req.Author
	}
	if req.Source != nil {
		spell.Source = req.Source
	}
	if req.Tags != nil {
		spell.Tags = req.Tags
	}
	if req.IsExtended != nil {
		spell.IsExtended = req.IsExtended
	}

	if err := sc.db.Save(&spell).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления заклинания"})
		return
	}

	c.JSON(http.StatusOK, spell.ToSpellResponse())
}

// DeleteSpell - удаление заклинания
func (sc *SpellController) DeleteSpell(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID заклинания"})
		return
	}

	if err := sc.db.Delete(&Spell{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления заклинания"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Заклинание удалено"})
}

// generateSpellNumber - генерация номера заклинания (SPELL-XXXX)
func (sc *SpellController) generateSpellNumber() string {
	var maxSpell Spell
	sc.db.Unscoped().Where("card_number LIKE ?", "SPELL-%").Order("card_number DESC").First(&maxSpell)

	nextNum := 1
	if maxSpell.CardNumber != "" {
		if len(maxSpell.CardNumber) >= 10 { // SPELL-XXXX
			numStr := maxSpell.CardNumber[6:10]
			if num, err := strconv.Atoi(numStr); err == nil {
				nextNum = num + 1
			}
		}
	}

	return fmt.Sprintf("SPELL-%04d", nextNum)
}
