package main

import (
	"encoding/json"
	"log"
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

	// Создаем автоматически инвентарь для персонажа
	defaultInventory := Inventory{
		Type:        InventoryTypeCharacter,
		CharacterID: &character.ID,
		Name:        "Инвентарь " + character.Name,
	}

	if err := cc.db.Create(&defaultInventory).Error; err != nil {
		// Логируем ошибку, но не прерываем создание персонажа
		log.Printf("Ошибка создания инвентаря для персонажа %s: %v", character.Name, err)
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

	// Логируем размер входящих данных
	log.Printf("=== ИМПОРТ ПЕРСОНАЖА ===")
	log.Printf("Размер входящих данных: %d байт", len(req.CharacterData))
	log.Printf("Первые 200 символов: %s", req.CharacterData[:minInt(200, len(req.CharacterData))])
	log.Printf("Последние 200 символов: %s", req.CharacterData[maxInt(0, len(req.CharacterData)-200):])

	// Проверяем, что JSON валидный
	var characterData map[string]interface{}
	if err := json.Unmarshal([]byte(req.CharacterData), &characterData); err != nil {
		log.Printf("Ошибка парсинга JSON: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат JSON данных персонажа"})
		return
	}

	// Логируем ключи верхнего уровня
	log.Printf("Ключи верхнего уровня: %v", getKeys(characterData))

	// Извлекаем имя персонажа из JSON
	var characterName string
	var actualData string = req.CharacterData

	// Проверяем, является ли это файлом экспорта с полной структурой
	if dataField, exists := characterData["data"]; exists {
		log.Printf("Найдено поле 'data' в верхнем уровне")
		if dataStr, ok := dataField.(string); ok {
			log.Printf("Поле 'data' является строкой, размер: %d байт", len(dataStr))
			log.Printf("Последние 200 символов поля 'data': %s", dataStr[maxInt(0, len(dataStr)-200):])

			// Это файл экспорта, извлекаем данные из поля "data"
			actualData = dataStr

			// Парсим вложенные данные для извлечения имени
			var nestedData map[string]interface{}
			if err := json.Unmarshal([]byte(dataStr), &nestedData); err == nil {
				log.Printf("Успешно распарсили вложенные данные")
				log.Printf("Ключи вложенных данных: %v", getKeys(nestedData))

				// Проверяем наличие traits во вложенных данных
				if _, hasTraits := nestedData["traits"]; hasTraits {
					log.Printf("✓ Найдено поле 'traits' во вложенных данных")
				} else if textField, hasText := nestedData["text"]; hasText {
					if textMap, ok := textField.(map[string]interface{}); ok {
						if _, hasTraitsInText := textMap["traits"]; hasTraitsInText {
							log.Printf("✓ Найдено поле 'traits' в data.text")
						} else {
							log.Printf("✗ Поле 'traits' НЕ найдено в data.text")
						}
					}
				} else {
					log.Printf("✗ Поле 'traits' НЕ найдено во вложенных данных")
				}

				if nameData, exists := nestedData["name"]; exists {
					if nameMap, ok := nameData.(map[string]interface{}); ok {
						if nameValue, exists := nameMap["value"]; exists {
							if nameStr, ok := nameValue.(string); ok {
								characterName = nameStr
								log.Printf("Имя персонажа извлечено из вложенных данных: %s", characterName)
							}
						}
					}
				}
			} else {
				log.Printf("Ошибка парсинга вложенных данных: %v", err)
			}
		} else {
			log.Printf("Поле 'data' не является строкой")
		}
	} else {
		log.Printf("Поле 'data' НЕ найдено в верхнем уровне")
		// Это прямые данные персонажа
		if nameData, exists := characterData["name"]; exists {
			if nameMap, ok := nameData.(map[string]interface{}); ok {
				if nameValue, exists := nameMap["value"]; exists {
					if nameStr, ok := nameValue.(string); ok {
						characterName = nameStr
						log.Printf("Имя персонажа извлечено из прямых данных: %s", characterName)
					}
				}
			}
		}

		// Проверяем наличие traits в прямых данных
		if _, hasTraits := characterData["traits"]; hasTraits {
			log.Printf("✓ Найдено поле 'traits' в прямых данных")
		} else {
			log.Printf("✗ Поле 'traits' НЕ найдено в прямых данных")
		}
	}

	if characterName == "" {
		characterName = "Импортированный персонаж"
		log.Printf("Имя персонажа не найдено, используется по умолчанию: %s", characterName)
	}

	log.Printf("Финальное имя персонажа: %s", characterName)
	log.Printf("Размер данных для сохранения: %d байт", len(actualData))

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

	log.Printf("Создаем персонажа в БД:")
	log.Printf("- UserID: %s", character.UserID)
	log.Printf("- GroupID: %v", character.GroupID)
	log.Printf("- Name: %s", character.Name)
	log.Printf("- Data размер: %d байт", len(character.Data))

	result := cc.db.Create(&character)
	if result.Error != nil {
		log.Printf("Ошибка создания персонажа в БД: %v", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка импорта персонажа"})
		return
	}

	log.Printf("Персонаж успешно создан в БД с ID: %s", character.ID)

	// Создаем автоматически инвентарь для персонажа
	defaultInventory := Inventory{
		Type:        InventoryTypeCharacter,
		CharacterID: &character.ID,
		Name:        "Инвентарь " + character.Name,
	}

	if err := cc.db.Create(&defaultInventory).Error; err != nil {
		// Логируем ошибку, но не прерываем импорт персонажа
		log.Printf("Ошибка создания инвентаря для персонажа %s: %v", character.Name, err)
	} else {
		log.Printf("Инвентарь успешно создан для персонажа %s", character.Name)
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

	log.Printf("=== ИМПОРТ ЗАВЕРШЕН ===")
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

// UpdateCharacterStat - обновление характеристики персонажа
func (cc *CharacterController) UpdateCharacterStat(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterIDStr := c.Param("id")
	statName := c.Param("statName")
	
	characterID, err := uuid.Parse(characterIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	// Валидация названия характеристики
	validStats := map[string]bool{
		"str": true, "dex": true, "con": true,
		"int": true, "wis": true, "cha": true,
	}
	if !validStats[statName] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверное название характеристики"})
		return
	}

	var req struct {
		Value int `json:"value" binding:"required,min=1,max=30"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса"})
		return
	}

	// Получаем персонажа
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

	// Парсим JSON данные персонажа
	var characterData map[string]interface{}
	if err := json.Unmarshal([]byte(character.Data), &characterData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка парсинга данных персонажа"})
		return
	}

	// Обновляем значение характеристики
	if stats, ok := characterData["stats"].(map[string]interface{}); ok {
		if stat, ok := stats[statName].(map[string]interface{}); ok {
			stat["score"] = req.Value
			stat["modifier"] = (req.Value - 10) / 2
		}
	}

	// Сохраняем обновленные данные
	updatedData, err := json.Marshal(characterData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка сериализации данных персонажа"})
		return
	}

	// Обновляем в базе данных
	character.Data = string(updatedData)
	if err := cc.db.Save(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка сохранения персонажа"})
		return
	}

	// Возвращаем обновленного персонажа
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

// getKeys возвращает список ключей из map
func getKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// minInt возвращает минимальное из двух значений
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// maxInt возвращает максимальное из двух значений
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
