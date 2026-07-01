package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CharacterV3Controller — контроллер персонажей V3 (сущностно-ориентированное хранение).
type CharacterV3Controller struct {
	db *gorm.DB
}

func NewCharacterV3Controller(db *gorm.DB) *CharacterV3Controller {
	return &CharacterV3Controller{db: db}
}

// applyLevelDefaults проставляет разумные значения по умолчанию.
func applyCharacterV3Defaults(ch *CharacterV3) {
	if ch.Level <= 0 {
		ch.Level = 1
	}
	if ch.Speed <= 0 {
		ch.Speed = 30
	}
	if ch.ProficiencyBonus <= 0 {
		ch.ProficiencyBonus = 2
	}
}

// CreateCharacterV3 создаёт нового персонажа V3.
func (cc *CharacterV3Controller) CreateCharacterV3(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req CreateCharacterV3Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса", "details": err.Error()})
		return
	}

	character := CharacterV3{
		UserID:                   userID.(uuid.UUID),
		Name:                     req.Name,
		AvatarURL:                req.AvatarURL,
		RaceID:                   req.RaceID,
		LineageID:                req.LineageID,
		ClassID:                  req.ClassID,
		BackgroundID:             req.BackgroundID,
		Level:                    req.Level,
		FeatIDs:                  req.FeatIDs,
		SpellIDs:                 req.SpellIDs,
		Abilities:                req.Abilities,
		SkillProficiencies:       req.SkillProficiencies,
		SavingThrowProficiencies: req.SavingThrowProficiencies,
		ToolProficiencies:        req.ToolProficiencies,
		Languages:                req.Languages,
		ResolvedChoices:          req.ResolvedChoices,
		MaxHP:                    req.MaxHP,
		CurrentHP:                req.CurrentHP,
		Speed:                    req.Speed,
		ProficiencyBonus:         req.ProficiencyBonus,
	}
	applyCharacterV3Defaults(&character)

	if err := cc.db.Create(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания персонажа", "details": err.Error()})
		return
	}

	var full CharacterV3
	if err := cc.db.Preload("User").Preload("Group").First(&full, character.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения данных персонажа"})
		return
	}
	c.JSON(http.StatusCreated, full)
}

// GetCharactersV3 возвращает список персонажей V3 текущего пользователя.
func (cc *CharacterV3Controller) GetCharactersV3(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var characters []CharacterV3
	if err := cc.db.Preload("User").Preload("Group").
		Where("user_id = ?", userID).Order("created_at DESC").Find(&characters).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения списка персонажей"})
		return
	}
	c.JSON(http.StatusOK, characters)
}

// GetCharacterV3 возвращает персонажа V3 по ID (в рамках текущего пользователя).
func (cc *CharacterV3Controller) GetCharacterV3(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	var character CharacterV3
	result := cc.db.Preload("User").Preload("Group").
		Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}
	c.JSON(http.StatusOK, character)
}

// UpdateCharacterV3 обновляет персонажа V3 (полная замена полей черновика).
func (cc *CharacterV3Controller) UpdateCharacterV3(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	var character CharacterV3
	if err := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	var req UpdateCharacterV3Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса", "details": err.Error()})
		return
	}

	if req.Name != "" {
		character.Name = req.Name
	}
	character.AvatarURL = req.AvatarURL
	character.RaceID = req.RaceID
	character.LineageID = req.LineageID
	character.ClassID = req.ClassID
	character.BackgroundID = req.BackgroundID
	character.Level = req.Level
	character.FeatIDs = req.FeatIDs
	character.SpellIDs = req.SpellIDs
	character.Abilities = req.Abilities
	character.SkillProficiencies = req.SkillProficiencies
	character.SavingThrowProficiencies = req.SavingThrowProficiencies
	character.ToolProficiencies = req.ToolProficiencies
	character.Languages = req.Languages
	character.ResolvedChoices = req.ResolvedChoices
	character.MaxHP = req.MaxHP
	character.CurrentHP = req.CurrentHP
	character.Speed = req.Speed
	character.ProficiencyBonus = req.ProficiencyBonus
	applyCharacterV3Defaults(&character)

	if err := cc.db.Save(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления персонажа", "details": err.Error()})
		return
	}

	var full CharacterV3
	if err := cc.db.Preload("User").Preload("Group").First(&full, character.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения данных персонажа"})
		return
	}
	c.JSON(http.StatusOK, full)
}

// DeleteCharacterV3 удаляет персонажа V3.
func (cc *CharacterV3Controller) DeleteCharacterV3(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).Delete(&CharacterV3{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка удаления персонажа"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "персонаж удалён"})
}
