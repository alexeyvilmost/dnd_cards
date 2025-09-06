package main

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CharacterController handles character-related HTTP requests
type CharacterController struct {
	db *gorm.DB
}

// NewCharacterController creates a new character controller
func NewCharacterController(db *gorm.DB) *CharacterController {
	return &CharacterController{db: db}
}

// GetCharacters - получение списка персонажей пользователя
func (cc *CharacterController) GetCharacters(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	// Получаем параметры запроса
	groupIDStr := c.Query("group_id")
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 50
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	// Строим запрос
	query := cc.db.Model(&Character{}).Where("user_id = ?", userID)

	// Фильтр по группе
	if groupIDStr != "" {
		groupID, err := uuid.Parse(groupIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID группы"})
			return
		}
		query = query.Where("group_id = ?", groupID)
	}

	// Получаем общее количество
	var total int64
	query.Count(&total)

	// Получаем персонажей с пагинацией
	var characters []Character
	result := query.Preload("Group").Preload("Inventories").
		Order("created_at DESC").
		Limit(limit).Offset(offset).Find(&characters)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажей"})
		return
	}

	// Преобразуем в ответы
	characterResponses := make([]CharacterResponse, 0, len(characters))
	for _, char := range characters {
		characterResponses = append(characterResponses, CharacterResponse{
			ID:          char.ID,
			UserID:      char.UserID,
			GroupID:     char.GroupID,
			Name:        char.Name,
			Data:        char.Data,
			CreatedAt:   char.CreatedAt,
			UpdatedAt:   char.UpdatedAt,
			Group:       char.Group,
			Inventories: char.Inventories,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"characters": characterResponses,
		"total":      total,
		"limit":      limit,
		"offset":     offset,
	})
}

// GetCharacter - получение персонажа по ID
func (cc *CharacterController) GetCharacter(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterIDStr := c.Param("id")
	characterID, err := uuid.Parse(characterIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	var character Character
	result := cc.db.Preload("Group").Preload("Inventories").
		Where("id = ? AND user_id = ?", characterID, userID).First(&character)

	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	characterResponse := CharacterResponse{
		ID:          character.ID,
		UserID:      character.UserID,
		GroupID:     character.GroupID,
		Name:        character.Name,
		Data:        character.Data,
		CreatedAt:   character.CreatedAt,
		UpdatedAt:   character.UpdatedAt,
		Group:       character.Group,
		Inventories: character.Inventories,
	}

	c.JSON(http.StatusOK, characterResponse)
}

// CreateCharacter - создание нового персонажа
func (cc *CharacterController) CreateCharacter(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req CreateCharacterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Проверяем, что JSON валидный
	var characterData map[string]interface{}
	if err := json.Unmarshal([]byte(req.Data), &characterData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат JSON данных персонажа"})
		return
	}

	// Проверяем, что пользователь является участником группы (если указана группа)
	if req.GroupID != nil {
		var groupMember GroupMember
		result := cc.db.Where("group_id = ? AND user_id = ?", req.GroupID, userID).First(&groupMember)
		if result.Error != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "вы не являетесь участником этой группы"})
			return
		}
	}

	character := Character{
		UserID:  userID.(uuid.UUID),
		GroupID: req.GroupID,
		Name:    req.Name,
		Data:    req.Data,
	}

	result := cc.db.Create(&character)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания персонажа"})
		return
	}

	// Загружаем связанные данные
	cc.db.Preload("Group").Preload("Inventories").First(&character, character.ID)

	characterResponse := CharacterResponse{
		ID:          character.ID,
		UserID:      character.UserID,
		GroupID:     character.GroupID,
		Name:        character.Name,
		Data:        character.Data,
		CreatedAt:   character.CreatedAt,
		UpdatedAt:   character.UpdatedAt,
		Group:       character.Group,
		Inventories: character.Inventories,
	}

	c.JSON(http.StatusCreated, characterResponse)
}

// UpdateCharacter - обновление персонажа
func (cc *CharacterController) UpdateCharacter(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterIDStr := c.Param("id")
	characterID, err := uuid.Parse(characterIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	var req UpdateCharacterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Проверяем, что персонаж существует и принадлежит пользователю
	var character Character
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	// Проверяем JSON данные (если они обновляются)
	if req.Data != "" {
		var characterData map[string]interface{}
		if err := json.Unmarshal([]byte(req.Data), &characterData); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат JSON данных персонажа"})
			return
		}
		character.Data = req.Data
	}

	// Проверяем группу (если она обновляется)
	if req.GroupID != nil {
		var groupMember GroupMember
		result := cc.db.Where("group_id = ? AND user_id = ?", req.GroupID, userID).First(&groupMember)
		if result.Error != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "вы не являетесь участником этой группы"})
			return
		}
		character.GroupID = req.GroupID
	}

	// Обновляем поля
	if req.Name != "" {
		character.Name = req.Name
	}

	result = cc.db.Save(&character)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления персонажа"})
		return
	}

	// Загружаем связанные данные
	cc.db.Preload("Group").Preload("Inventories").First(&character, character.ID)

	characterResponse := CharacterResponse{
		ID:          character.ID,
		UserID:      character.UserID,
		GroupID:     character.GroupID,
		Name:        character.Name,
		Data:        character.Data,
		CreatedAt:   character.CreatedAt,
		UpdatedAt:   character.UpdatedAt,
		Group:       character.Group,
		Inventories: character.Inventories,
	}

	c.JSON(http.StatusOK, characterResponse)
}

// DeleteCharacter - удаление персонажа
func (cc *CharacterController) DeleteCharacter(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterIDStr := c.Param("id")
	characterID, err := uuid.Parse(characterIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	// Проверяем, что персонаж существует и принадлежит пользователю
	var character Character
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	// Удаляем персонажа (мягкое удаление)
	result = cc.db.Delete(&character)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка удаления персонажа"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "персонаж успешно удален"})
}

// ImportCharacter - импорт персонажа из JSON
func (cc *CharacterController) ImportCharacter(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req ImportCharacterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Проверяем, что JSON валидный
	var characterData map[string]interface{}
	if err := json.Unmarshal([]byte(req.CharacterData), &characterData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат JSON данных персонажа"})
		return
	}

	// Извлекаем имя персонажа из JSON
	var characterName string
	var actualData string = req.CharacterData

	// Проверяем, является ли это файлом экспорта с полной структурой
	if dataField, exists := characterData["data"]; exists {
		if dataStr, ok := dataField.(string); ok {
			// Это файл экспорта, извлекаем данные из поля "data"
			actualData = dataStr
			// Парсим вложенные данные для извлечения имени
			var nestedData map[string]interface{}
			if err := json.Unmarshal([]byte(dataStr), &nestedData); err == nil {
				if nameData, exists := nestedData["name"]; exists {
					if nameMap, ok := nameData.(map[string]interface{}); ok {
						if nameValue, exists := nameMap["value"]; exists {
							if nameStr, ok := nameValue.(string); ok {
								characterName = nameStr
							}
						}
					}
				}
			}
		}
	} else {
		// Это прямые данные персонажа
		if nameData, exists := characterData["name"]; exists {
			if nameMap, ok := nameData.(map[string]interface{}); ok {
				if nameValue, exists := nameMap["value"]; exists {
					if nameStr, ok := nameValue.(string); ok {
						characterName = nameStr
					}
				}
			}
		}
	}

	if characterName == "" {
		characterName = "Импортированный персонаж"
	}

	// Проверяем, что пользователь является участником группы (если указана группа)
	if req.GroupID != nil {
		var groupMember GroupMember
		result := cc.db.Where("group_id = ? AND user_id = ?", req.GroupID, userID).First(&groupMember)
		if result.Error != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "вы не являетесь участником этой группы"})
			return
		}
	}

	character := Character{
		UserID:  userID.(uuid.UUID),
		GroupID: req.GroupID,
		Name:    characterName,
		Data:    actualData,
	}

	result := cc.db.Create(&character)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка импорта персонажа"})
		return
	}

	// Загружаем связанные данные
	cc.db.Preload("Group").Preload("Inventories").First(&character, character.ID)

	characterResponse := CharacterResponse{
		ID:          character.ID,
		UserID:      character.UserID,
		GroupID:     character.GroupID,
		Name:        character.Name,
		Data:        character.Data,
		CreatedAt:   character.CreatedAt,
		UpdatedAt:   character.UpdatedAt,
		Group:       character.Group,
		Inventories: character.Inventories,
	}

	c.JSON(http.StatusCreated, characterResponse)
}

// ExportCharacter - экспорт персонажа в JSON
func (cc *CharacterController) ExportCharacter(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterIDStr := c.Param("id")
	characterID, err := uuid.Parse(characterIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	var character Character
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	response := ExportCharacterResponse{
		CharacterData: character.Data,
	}

	c.JSON(http.StatusOK, response)
}
