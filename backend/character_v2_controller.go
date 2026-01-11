package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CharacterV2Controller контроллер для работы с персонажами V2
type CharacterV2Controller struct {
	db *gorm.DB
}

// NewCharacterV2Controller создает новый контроллер персонажей V2
func NewCharacterV2Controller(db *gorm.DB) *CharacterV2Controller {
	return &CharacterV2Controller{db: db}
}

// CreateCharacterV2 создает нового персонажа V2
func (cc *CharacterV2Controller) CreateCharacterV2(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req CreateCharacterV2Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса"})
		return
	}

	// Конвертируем массивы в JSON строки
	savingThrowJSON, err := json.Marshal(req.SavingThrowProficiencies)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обработки владений спасбросками"})
		return
	}

	skillJSON, err := json.Marshal(req.SkillProficiencies)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обработки владений навыками"})
		return
	}

	character := CharacterV2{
		UserID:                   userID.(uuid.UUID),
		GroupID:                  nil, // Пока не поддерживаем группы
		Name:                     req.Name,
		Race:                     req.Race,
		Class:                    req.Class,
		Level:                    req.Level,
		Speed:                    req.Speed,
		Strength:                 req.Strength,
		Dexterity:                req.Dexterity,
		Constitution:             req.Constitution,
		Intelligence:             req.Intelligence,
		Wisdom:                   req.Wisdom,
		Charisma:                 req.Charisma,
		MaxHP:                    req.MaxHP,
		CurrentHP:                req.CurrentHP,
		SavingThrowProficiencies: string(savingThrowJSON),
		SkillProficiencies:       string(skillJSON),
	}

	if err := cc.db.Create(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания персонажа"})
		return
	}

	// Получаем полную информацию о персонаже с связями
	var fullCharacter CharacterV2
	if err := cc.db.Preload("User").Preload("Group").First(&fullCharacter, character.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения данных персонажа"})
		return
	}

	// Конвертируем JSON строки обратно в массивы для ответа
	var savingThrows, skills []string
	json.Unmarshal([]byte(fullCharacter.SavingThrowProficiencies), &savingThrows)
	json.Unmarshal([]byte(fullCharacter.SkillProficiencies), &skills)

	response := CharacterV2Response{
		ID:                       fullCharacter.ID,
		UserID:                   fullCharacter.UserID,
		GroupID:                  fullCharacter.GroupID,
		Name:                     fullCharacter.Name,
		Race:                     fullCharacter.Race,
		Class:                    fullCharacter.Class,
		Level:                    fullCharacter.Level,
		Speed:                    fullCharacter.Speed,
		Strength:                 fullCharacter.Strength,
		Dexterity:                fullCharacter.Dexterity,
		Constitution:             fullCharacter.Constitution,
		Intelligence:             fullCharacter.Intelligence,
		Wisdom:                   fullCharacter.Wisdom,
		Charisma:                 fullCharacter.Charisma,
		MaxHP:                    fullCharacter.MaxHP,
		CurrentHP:                fullCharacter.CurrentHP,
		SavingThrowProficiencies: savingThrows,
		SkillProficiencies:       skills,
		CreatedAt:                fullCharacter.CreatedAt,
		UpdatedAt:                fullCharacter.UpdatedAt,
		User:                     fullCharacter.User,
		Group:                    fullCharacter.Group,
	}

	c.JSON(http.StatusCreated, response)
}

// GetCharacterV2 получает персонажа V2 по ID
func (cc *CharacterV2Controller) GetCharacterV2(c *gin.Context) {
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

	var character CharacterV2
	result := cc.db.Preload("User").Preload("Group").Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	// Конвертируем JSON строки обратно в массивы для ответа
	var savingThrows, skills []string
	json.Unmarshal([]byte(character.SavingThrowProficiencies), &savingThrows)
	json.Unmarshal([]byte(character.SkillProficiencies), &skills)

	response := CharacterV2Response{
		ID:                       character.ID,
		UserID:                   character.UserID,
		GroupID:                  character.GroupID,
		Name:                     character.Name,
		Race:                     character.Race,
		Class:                    character.Class,
		Level:                    character.Level,
		Speed:                    character.Speed,
		Strength:                 character.Strength,
		Dexterity:                character.Dexterity,
		Constitution:             character.Constitution,
		Intelligence:             character.Intelligence,
		Wisdom:                   character.Wisdom,
		Charisma:                 character.Charisma,
		MaxHP:                    character.MaxHP,
		CurrentHP:                character.CurrentHP,
		SavingThrowProficiencies: savingThrows,
		SkillProficiencies:       skills,
		CreatedAt:                character.CreatedAt,
		UpdatedAt:                character.UpdatedAt,
		User:                     character.User,
		Group:                    character.Group,
	}

	c.JSON(http.StatusOK, response)
}

// GetCharactersV2 получает список персонажей V2 пользователя
func (cc *CharacterV2Controller) GetCharactersV2(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var characters []CharacterV2
	if err := cc.db.Preload("User").Preload("Group").Where("user_id = ?", userID).Find(&characters).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения списка персонажей"})
		return
	}

	var responses []CharacterV2Response
	for _, character := range characters {
		// Конвертируем JSON строки обратно в массивы для ответа
		var savingThrows, skills []string
		json.Unmarshal([]byte(character.SavingThrowProficiencies), &savingThrows)
		json.Unmarshal([]byte(character.SkillProficiencies), &skills)

		response := CharacterV2Response{
			ID:                       character.ID,
			UserID:                   character.UserID,
			GroupID:                  character.GroupID,
			Name:                     character.Name,
			Race:                     character.Race,
			Class:                    character.Class,
			Level:                    character.Level,
			Speed:                    character.Speed,
			Strength:                 character.Strength,
			Dexterity:                character.Dexterity,
			Constitution:             character.Constitution,
			Intelligence:             character.Intelligence,
			Wisdom:                   character.Wisdom,
			Charisma:                 character.Charisma,
			MaxHP:                    character.MaxHP,
			CurrentHP:                character.CurrentHP,
			SavingThrowProficiencies: savingThrows,
			SkillProficiencies:       skills,
			CreatedAt:                character.CreatedAt,
			UpdatedAt:                character.UpdatedAt,
			User:                     character.User,
			Group:                    character.Group,
		}
		responses = append(responses, response)
	}

	c.JSON(http.StatusOK, responses)
}

// UpdateCharacterV2 обновляет персонажа V2
func (cc *CharacterV2Controller) UpdateCharacterV2(c *gin.Context) {
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

	var req UpdateCharacterV2Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса"})
		return
	}

	// Получаем персонажа
	var character CharacterV2
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	// Обновляем поля
	if req.Name != "" {
		character.Name = req.Name
	}
	if req.Race != "" {
		character.Race = req.Race
	}
	if req.Class != "" {
		character.Class = req.Class
	}
	if req.Level > 0 {
		character.Level = req.Level
	}
	if req.Speed > 0 {
		character.Speed = req.Speed
	}
	if req.Strength > 0 {
		character.Strength = req.Strength
	}
	if req.Dexterity > 0 {
		character.Dexterity = req.Dexterity
	}
	if req.Constitution > 0 {
		character.Constitution = req.Constitution
	}
	if req.Intelligence > 0 {
		character.Intelligence = req.Intelligence
	}
	if req.Wisdom > 0 {
		character.Wisdom = req.Wisdom
	}
	if req.Charisma > 0 {
		character.Charisma = req.Charisma
	}
	if req.MaxHP > 0 {
		character.MaxHP = req.MaxHP
	}
	if req.CurrentHP >= 0 {
		character.CurrentHP = req.CurrentHP
	}
	if req.SavingThrowProficiencies != nil {
		savingThrowJSON, err := json.Marshal(req.SavingThrowProficiencies)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обработки владений спасбросками"})
			return
		}
		character.SavingThrowProficiencies = string(savingThrowJSON)
	}
	if req.SkillProficiencies != nil {
		skillJSON, err := json.Marshal(req.SkillProficiencies)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обработки владений навыками"})
			return
		}
		character.SkillProficiencies = string(skillJSON)
	}

	// Сохраняем изменения
	if err := cc.db.Save(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления персонажа"})
		return
	}

	// Получаем обновленного персонажа с связями
	var fullCharacter CharacterV2
	if err := cc.db.Preload("User").Preload("Group").First(&fullCharacter, character.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения обновленных данных персонажа"})
		return
	}

	// Конвертируем JSON строки обратно в массивы для ответа
	var savingThrows, skills []string
	json.Unmarshal([]byte(fullCharacter.SavingThrowProficiencies), &savingThrows)
	json.Unmarshal([]byte(fullCharacter.SkillProficiencies), &skills)

	response := CharacterV2Response{
		ID:                       fullCharacter.ID,
		UserID:                   fullCharacter.UserID,
		GroupID:                  fullCharacter.GroupID,
		Name:                     fullCharacter.Name,
		Race:                     fullCharacter.Race,
		Class:                    fullCharacter.Class,
		Level:                    fullCharacter.Level,
		Speed:                    fullCharacter.Speed,
		Strength:                 fullCharacter.Strength,
		Dexterity:                fullCharacter.Dexterity,
		Constitution:             fullCharacter.Constitution,
		Intelligence:             fullCharacter.Intelligence,
		Wisdom:                   fullCharacter.Wisdom,
		Charisma:                 fullCharacter.Charisma,
		MaxHP:                    fullCharacter.MaxHP,
		CurrentHP:                fullCharacter.CurrentHP,
		SavingThrowProficiencies: savingThrows,
		SkillProficiencies:       skills,
		CreatedAt:                fullCharacter.CreatedAt,
		UpdatedAt:                fullCharacter.UpdatedAt,
		User:                     fullCharacter.User,
		Group:                    fullCharacter.Group,
	}

	c.JSON(http.StatusOK, response)
}

// DeleteCharacterV2 удаляет персонажа V2
func (cc *CharacterV2Controller) DeleteCharacterV2(c *gin.Context) {
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

	// Проверяем, что персонаж принадлежит пользователю
	var character CharacterV2
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	// Удаляем персонажа
	if err := cc.db.Delete(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка удаления персонажа"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "персонаж успешно удален"})
}

// UpdateCharacterV2Stat обновляет характеристику персонажа V2
func (cc *CharacterV2Controller) UpdateCharacterV2Stat(c *gin.Context) {
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
		"strength": true, "dexterity": true, "constitution": true,
		"intelligence": true, "wisdom": true, "charisma": true,
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
	var character CharacterV2
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}

	// Обновляем характеристику
	switch statName {
	case "strength":
		character.Strength = req.Value
	case "dexterity":
		character.Dexterity = req.Value
	case "constitution":
		character.Constitution = req.Value
	case "intelligence":
		character.Intelligence = req.Value
	case "wisdom":
		character.Wisdom = req.Value
	case "charisma":
		character.Charisma = req.Value
	}

	// Сохраняем изменения
	if err := cc.db.Save(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка сохранения персонажа"})
		return
	}

	// Возвращаем обновленного персонажа
	var fullCharacter CharacterV2
	if err := cc.db.Preload("User").Preload("Group").First(&fullCharacter, character.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения обновленных данных персонажа"})
		return
	}

	// Конвертируем JSON строки обратно в массивы для ответа
	var savingThrows, skills []string
	json.Unmarshal([]byte(fullCharacter.SavingThrowProficiencies), &savingThrows)
	json.Unmarshal([]byte(fullCharacter.SkillProficiencies), &skills)

	response := CharacterV2Response{
		ID:                       fullCharacter.ID,
		UserID:                   fullCharacter.UserID,
		GroupID:                  fullCharacter.GroupID,
		Name:                     fullCharacter.Name,
		Race:                     fullCharacter.Race,
		Class:                    fullCharacter.Class,
		Level:                    fullCharacter.Level,
		Speed:                    fullCharacter.Speed,
		Strength:                 fullCharacter.Strength,
		Dexterity:                fullCharacter.Dexterity,
		Constitution:             fullCharacter.Constitution,
		Intelligence:             fullCharacter.Intelligence,
		Wisdom:                   fullCharacter.Wisdom,
		Charisma:                 fullCharacter.Charisma,
		MaxHP:                    fullCharacter.MaxHP,
		CurrentHP:                fullCharacter.CurrentHP,
		SavingThrowProficiencies: savingThrows,
		SkillProficiencies:       skills,
		CreatedAt:                fullCharacter.CreatedAt,
		UpdatedAt:                fullCharacter.UpdatedAt,
		User:                     fullCharacter.User,
		Group:                    fullCharacter.Group,
	}

	c.JSON(http.StatusOK, response)
}

// AddItemsToCharacterInventory добавляет предметы в инвентарь персонажа
func (cc *CharacterV2Controller) AddItemsToCharacterInventory(c *gin.Context) {
	startTime := time.Now()
	log.Println("🚀 [PERF] AddItemsToCharacterInventory: Начало")

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

	var req struct {
		CardIDs []string `json:"card_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса"})
		return
	}

	log.Printf("📊 [PERF] AddItemsToCharacterInventory: Добавляем %d предметов", len(req.CardIDs))

	// Проверяем, что персонаж принадлежит пользователю
	checkStartTime := time.Now()
	var character CharacterV2
	result := cc.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return
	}
	log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Проверка персонажа - %v", time.Since(checkStartTime))

	// Получаем или создаем инвентарь персонажа
	inventoryStartTime := time.Now()
	var inventory Inventory
	err = cc.db.Where("character_id = ? AND type = ?", characterID, InventoryTypeCharacter).First(&inventory).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Создаем новый инвентарь для персонажа
			createStartTime := time.Now()
			inventory = Inventory{
				Type:        InventoryTypeCharacter,
				CharacterID: &characterID,
				Name:        "Инвентарь " + character.Name,
			}
			if err := cc.db.Create(&inventory).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания инвентаря"})
				return
			}
			log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Создание инвентаря - %v", time.Since(createStartTime))
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения инвентаря"})
			return
		}
	} else {
		log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Поиск инвентаря - %v", time.Since(inventoryStartTime))
	}

	// Добавляем предметы в инвентарь
	itemsStartTime := time.Now()
	var addedItems []InventoryItem
	for i, cardIDStr := range req.CardIDs {
		itemStartTime := time.Now()

		cardID, err := uuid.Parse(cardIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID карты: " + cardIDStr})
			return
		}

		// Проверяем, существует ли карта
		cardCheckStartTime := time.Now()
		var card Card
		if err := cc.db.First(&card, cardID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "карта не найдена: " + cardIDStr})
			return
		}
		log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Проверка карты %d - %v", i+1, time.Since(cardCheckStartTime))

		// Проверяем, есть ли уже такой предмет в инвентаре
		existingCheckStartTime := time.Now()
		var existingItem InventoryItem
		err = cc.db.Where("inventory_id = ? AND card_id = ?", inventory.ID, cardID).First(&existingItem).Error
		if err == nil {
			// Предмет уже есть, увеличиваем количество
			updateStartTime := time.Now()
			existingItem.Quantity++
			if err := cc.db.Save(&existingItem).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления количества предмета"})
				return
			}
			log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Обновление количества предмета %d - %v", i+1, time.Since(updateStartTime))
			addedItems = append(addedItems, existingItem)
		} else if err == gorm.ErrRecordNotFound {
			// Создаем новый предмет в инвентаре
			createStartTime := time.Now()
			newItem := InventoryItem{
				InventoryID: inventory.ID,
				CardID:      cardID,
				Quantity:    1,
			}
			if err := cc.db.Create(&newItem).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка добавления предмета в инвентарь"})
				return
			}
			log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Создание предмета %d - %v", i+1, time.Since(createStartTime))
			addedItems = append(addedItems, newItem)
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка проверки предмета в инвентаре"})
			return
		}
		log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Проверка существования предмета %d - %v", i+1, time.Since(existingCheckStartTime))
		log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Обработка предмета %d - %v", i+1, time.Since(itemStartTime))
	}
	log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Обработка всех предметов - %v", time.Since(itemsStartTime))

	// Загружаем добавленные предметы с информацией о картах
	preloadStartTime := time.Now()
	if err := cc.db.Preload("Card").Where("inventory_id = ?", inventory.ID).Find(&addedItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки добавленных предметов"})
		return
	}
	log.Printf("⏱️ [PERF] AddItemsToCharacterInventory: Загрузка предметов с картами - %v", time.Since(preloadStartTime))
	log.Printf("📊 [PERF] AddItemsToCharacterInventory: Добавлено предметов: %d", len(addedItems))

	log.Printf("✅ [PERF] AddItemsToCharacterInventory: Общее время - %v", time.Since(startTime))
	c.JSON(http.StatusOK, gin.H{
		"message": "предметы успешно добавлены в инвентарь",
		"items":   addedItems,
	})
}

// EquipItem экипирует предмет персонажа
func (controller *CharacterV2Controller) EquipItem(c *gin.Context) {
	startTime := time.Now()
	log.Printf("🎯 [PERF] Начало экипировки предмета")

	characterID := c.Param("id")
	userID, err := GetCurrentUserID(c)
	if err != nil {
		log.Printf("❌ [PERF] Ошибка получения user_id: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	// Проверяем, что персонаж принадлежит пользователю
	var character CharacterV2
	if err := controller.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character).Error; err != nil {
		log.Printf("❌ [PERF] Персонаж не найден: %v", err)
		c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		return
	}

	var request struct {
		ItemID   string `json:"item_id"`
		SlotType string `json:"slot_type"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		log.Printf("❌ [PERF] Ошибка парсинга запроса: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат запроса"})
		return
	}

	log.Printf("🎯 [PERF] Экипировка предмета %s в слот %s", request.ItemID, request.SlotType)

	// Находим предмет в инвентаре персонажа
	var inventoryItem InventoryItem
	if err := controller.db.Preload("Card").Where("id = ? AND inventory_id IN (SELECT id FROM inventories WHERE character_id = ?)", request.ItemID, characterID).First(&inventoryItem).Error; err != nil {
		log.Printf("❌ [PERF] Предмет не найден в инвентаре: %v", err)
		c.JSON(http.StatusNotFound, gin.H{"error": "предмет не найден в инвентаре"})
		return
	}

	// Проверяем, что предмет подходит для этого слота (только при экипировке, не при снятии)
	if request.SlotType != "" && request.SlotType != "null" && !isItemCompatibleWithSlot(&inventoryItem.Card, request.SlotType) {
		log.Printf("❌ [PERF] Предмет не подходит для слота: %s", request.SlotType)
		log.Printf("❌ [PERF] Предмет: %s, слот предмета: %v", inventoryItem.Card.Name, inventoryItem.Card.Slot)
		c.JSON(http.StatusBadRequest, gin.H{"error": "предмет не подходит для этого слота экипировки"})
		return
	}

	// Если снимаем предмет (slot_type пустой или null)
	if request.SlotType == "" || request.SlotType == "null" {
		// Просто снимаем предмет
		if err := controller.db.Model(&inventoryItem).Updates(map[string]interface{}{"is_equipped": false, "equipped_slot": nil}).Error; err != nil {
			log.Printf("❌ [PERF] Ошибка снятия предмета: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка снятия предмета"})
			return
		}
		log.Printf("✅ [PERF] Предмет %s снят с экипировки", inventoryItem.ID)
	} else {
		log.Printf("🎯 [EQUIP] Экипируем предмет: %s (%s) в слот: %s", inventoryItem.ID, inventoryItem.Card.Name, request.SlotType)

		// Определяем, какие слоты нужно освободить при экипировке оружия
		slotsToUnequip := getSlotsToUnequipForWeapon(request.SlotType, &inventoryItem.Card)
		log.Printf("🎯 [EQUIP] Слоты для освобождения: %v", slotsToUnequip)

		// Получаем все экипированные предметы персонажа
		var allEquippedItems []InventoryItem
		if err := controller.db.Preload("Card").Where("inventory_id IN (SELECT id FROM inventories WHERE character_id = ?) AND is_equipped = true AND id != ?", characterID, inventoryItem.ID).Find(&allEquippedItems).Error; err != nil {
			log.Printf("⚠️ [EQUIP] Ошибка при поиске экипированных предметов: %v", err)
		} else {
			log.Printf("🎯 [EQUIP] Найдено экипированных предметов: %d", len(allEquippedItems))
			// Снимаем предметы, которые нужно освободить
			unequippedCount := 0
			for _, existingItem := range allEquippedItems {
				log.Printf("🎯 [EQUIP] Проверяем предмет: %s (%s), слот: %v", existingItem.ID, existingItem.Card.Name, existingItem.EquippedSlot)
				if shouldUnequipItem(&existingItem, slotsToUnequip, &inventoryItem.Card) {
					log.Printf("🎯 [EQUIP] Решено снять предмет: %s (%s)", existingItem.ID, existingItem.Card.Name)
					if err := controller.db.Model(&existingItem).Updates(map[string]interface{}{"is_equipped": false, "equipped_slot": nil}).Error; err != nil {
						log.Printf("❌ [EQUIP] Ошибка снятия предмета %s: %v", existingItem.ID, err)
					} else {
						unequippedCount++
						log.Printf("✅ [EQUIP] Предмет %s (%s) снят при экипировке нового оружия", existingItem.ID, existingItem.Card.Name)
					}
				} else {
					log.Printf("🎯 [EQUIP] Предмет %s (%s) НЕ нужно снимать", existingItem.ID, existingItem.Card.Name)
				}
			}
			log.Printf("🎯 [EQUIP] Всего снято предметов: %d", unequippedCount)
		}

		// Экипируем новый предмет
		if err := controller.db.Model(&inventoryItem).Updates(map[string]interface{}{"is_equipped": true, "equipped_slot": request.SlotType}).Error; err != nil {
			log.Printf("❌ [EQUIP] Ошибка экипировки: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка экипировки предмета"})
			return
		}
		log.Printf("✅ [EQUIP] Предмет %s успешно экипирован в слот %s", inventoryItem.ID, request.SlotType)
	}

	log.Printf("✅ [PERF] Экипировка завершена за %v", time.Since(startTime))
	c.JSON(http.StatusOK, gin.H{
		"message": "предмет успешно экипирован",
		"item":    inventoryItem,
	})
}

// getWeaponType определяет тип оружия (ближний/дальний бой) по тегам
func getWeaponType(card *Card) string {
	if card == nil || card.Type == nil || *card.Type != "weapon" {
		return ""
	}

	// Проверяем теги
	if card.Tags != nil {
		tags := *card.Tags
		for _, tag := range tags {
			if tag == "Дальнобойное" {
				return "ranged"
			}
			if tag == "Ближнее" {
				return "melee"
			}
		}
	}

	// Если тегов нет, проверяем свойства
	if card.Properties != nil {
		properties := *card.Properties
		for _, prop := range properties {
			if prop == "ammunition" || prop == "loading" {
				return "ranged"
			}
		}
	}

	// По умолчанию считаем ближним боем
	return "melee"
}

// getSlotsToUnequipForWeapon определяет, какие слоты нужно освободить при экипировке оружия
func getSlotsToUnequipForWeapon(slotType string, card *Card) []string {
	log.Printf("🔍 [SLOTS] Определение слотов для освобождения: slotType=%s, card=%v", slotType, card)

	if card == nil || card.Type == nil || *card.Type != "weapon" {
		log.Printf("🔍 [SLOTS] Предмет не является оружием, освобождаем только слот %s", slotType)
		// Для не-оружия просто освобождаем тот же слот
		return []string{slotType}
	}

	weaponType := getWeaponType(card)
	log.Printf("🔍 [SLOTS] Тип оружия: %s", weaponType)

	slotsToUnequip := []string{}

	// Определяем, какие слоты нужно освободить в зависимости от типа экипируемого оружия
	if slotType == "melee_two_hands" || slotType == "ranged_two_hands" {
		// Двуручное оружие освобождает все слоты соответствующего ряда
		if slotType == "melee_two_hands" {
			// Освобождаем все слоты ближнего боя (верхний ряд)
			slotsToUnequip = append(slotsToUnequip, "melee_one_hand", "melee_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Двуручное оружие ближнего боя - освобождаем слоты: %v", slotsToUnequip)
		} else {
			// Освобождаем все слоты дальнего боя (нижний ряд)
			slotsToUnequip = append(slotsToUnequip, "ranged_one_hand", "ranged_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Двуручное оружие дальнего боя - освобождаем слоты: %v", slotsToUnequip)
		}
	} else if slotType == "melee_one_hand" || slotType == "ranged_one_hand" {
		// Одноручное оружие освобождает все слоты соответствующего ряда
		if slotType == "melee_one_hand" {
			// Освобождаем все слоты ближнего боя (верхний ряд)
			slotsToUnequip = append(slotsToUnequip, "melee_one_hand", "melee_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Одноручное оружие ближнего боя - освобождаем слоты: %v", slotsToUnequip)
		} else {
			// Освобождаем все слоты дальнего боя (нижний ряд)
			slotsToUnequip = append(slotsToUnequip, "ranged_one_hand", "ranged_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Одноручное оружие дальнего боя - освобождаем слоты: %v", slotsToUnequip)
		}
	} else if slotType == "two_hands" {
		// Старый формат двуручного оружия - определяем тип по оружию
		if weaponType == "melee" {
			// Освобождаем все слоты ближнего боя
			slotsToUnequip = append(slotsToUnequip, "melee_one_hand", "melee_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Двуручное оружие ближнего боя (старый формат) - освобождаем слоты: %v", slotsToUnequip)
		} else {
			// Освобождаем все слоты дальнего боя
			slotsToUnequip = append(slotsToUnequip, "ranged_one_hand", "ranged_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Двуручное оружие дальнего боя (старый формат) - освобождаем слоты: %v", slotsToUnequip)
		}
	} else if slotType == "one_hand" {
		// Старый формат одноручного оружия - определяем тип по оружию
		if weaponType == "melee" {
			// Освобождаем все слоты ближнего боя
			slotsToUnequip = append(slotsToUnequip, "melee_one_hand", "melee_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Одноручное оружие ближнего боя (старый формат) - освобождаем слоты: %v", slotsToUnequip)
		} else {
			// Освобождаем все слоты дальнего боя
			slotsToUnequip = append(slotsToUnequip, "ranged_one_hand", "ranged_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Одноручное оружие дальнего боя (старый формат) - освобождаем слоты: %v", slotsToUnequip)
		}
	} else if slotType == "versatile" {
		// Универсальное оружие - определяем тип по оружию
		if weaponType == "melee" {
			// Освобождаем все слоты ближнего боя
			slotsToUnequip = append(slotsToUnequip, "melee_one_hand", "melee_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Универсальное оружие ближнего боя - освобождаем слоты: %v", slotsToUnequip)
		} else {
			// Освобождаем все слоты дальнего боя
			slotsToUnequip = append(slotsToUnequip, "ranged_one_hand", "ranged_two_hands", "one_hand", "versatile", "two_hands")
			log.Printf("🔍 [SLOTS] Универсальное оружие дальнего боя - освобождаем слоты: %v", slotsToUnequip)
		}
	} else {
		// Для других типов слотов просто освобождаем тот же слот
		slotsToUnequip = append(slotsToUnequip, slotType)
		log.Printf("🔍 [SLOTS] Другой тип слота - освобождаем только слот %s", slotType)
	}

	log.Printf("🔍 [SLOTS] Итоговый список слотов для освобождения: %v", slotsToUnequip)
	return slotsToUnequip
}

// shouldUnequipItem проверяет, нужно ли снимать предмет при экипировке нового оружия
func shouldUnequipItem(item *InventoryItem, slotsToUnequip []string, newItemCard *Card) bool {
	log.Printf("🔍 [UNEQUIP_CHECK] Проверка предмета: ID=%s, Name=%s", item.ID, item.Card.Name)

	if item.EquippedSlot == nil {
		log.Printf("🔍 [UNEQUIP_CHECK] Предмет не экипирован (equipped_slot = nil)")
		return false
	}

	// Проверяем, что карта загружена
	if item.Card.ID == uuid.Nil {
		log.Printf("🔍 [UNEQUIP_CHECK] Карта не загружена")
		return false
	}

	equippedSlot := *item.EquippedSlot
	log.Printf("🔍 [UNEQUIP_CHECK] Слот предмета: %s, Слоты для освобождения: %v", equippedSlot, slotsToUnequip)

	// Если слот точно совпадает с одним из слотов для освобождения
	for _, slot := range slotsToUnequip {
		if equippedSlot == slot {
			log.Printf("✅ [UNEQUIP_CHECK] Слот точно совпадает: %s == %s -> СНИМАТЬ", equippedSlot, slot)
			return true
		}
	}

	// Специальная логика для оружия: проверяем, находится ли оно в соответствующем ряду
	if item.Card.Type != nil && *item.Card.Type == "weapon" {
		weaponType := getWeaponType(&item.Card)
		newWeaponType := getWeaponType(newItemCard)
		log.Printf("🔍 [UNEQUIP_CHECK] Тип текущего оружия: %s, Тип нового оружия: %s", weaponType, newWeaponType)

		// Если это оружие того же типа (ближний/дальний бой), снимаем его
		// Проверяем, есть ли в списке слотов для освобождения слоты соответствующего типа
		hasMeleeSlots := false
		hasRangedSlots := false
		for _, slot := range slotsToUnequip {
			if slot == "melee_one_hand" || slot == "melee_two_hands" {
				hasMeleeSlots = true
			}
			if slot == "ranged_one_hand" || slot == "ranged_two_hands" {
				hasRangedSlots = true
			}
			// Также учитываем старый формат "one_hand" и "versatile"
			if slot == "one_hand" || slot == "versatile" {
				// Если экипируем двуручное оружие ближнего боя, снимаем все оружие ближнего боя
				if newWeaponType == "melee" {
					hasMeleeSlots = true
				}
				// Если экипируем двуручное оружие дальнего боя, снимаем все оружие дальнего боя
				if newWeaponType == "ranged" {
					hasRangedSlots = true
				}
			}
		}

		log.Printf("🔍 [UNEQUIP_CHECK] hasMeleeSlots=%v, hasRangedSlots=%v", hasMeleeSlots, hasRangedSlots)

		// Если экипируем оружие ближнего боя, снимаем все оружие ближнего боя
		if weaponType == "melee" && hasMeleeSlots {
			log.Printf("✅ [UNEQUIP_CHECK] Оружие ближнего боя и есть слоты для ближнего боя -> СНИМАТЬ")
			return true
		}
		// Если экипируем оружие дальнего боя, снимаем все оружие дальнего боя
		if weaponType == "ranged" && hasRangedSlots {
			log.Printf("✅ [UNEQUIP_CHECK] Оружие дальнего боя и есть слоты для дальнего боя -> СНИМАТЬ")
			return true
		}
	} else {
		log.Printf("🔍 [UNEQUIP_CHECK] Предмет не является оружием (type=%v)", item.Card.Type)
	}

	log.Printf("❌ [UNEQUIP_CHECK] Предмет НЕ нужно снимать")
	return false
}

// isItemCompatibleWithSlot проверяет совместимость предмета со слотом
func isItemCompatibleWithSlot(card *Card, slotType string) bool {
	if card == nil {
		log.Printf("🔍 [COMPAT] Предмет nil")
		return false
	}

	if card.Slot == nil {
		log.Printf("🔍 [COMPAT] У предмета '%s' нет слота экипировки", card.Name)
		return false
	}

	log.Printf("🔍 [COMPAT] Проверка совместимости: предмет '%s', слот предмета '%s', целевой слот '%s'", card.Name, *card.Slot, slotType)

	cardSlot := string(*card.Slot)

	// Точное совпадение
	if cardSlot == slotType {
		log.Printf("🔍 [COMPAT] Совместимость: точное совпадение")
		return true
	}

	// Поддержка новых специфичных типов слотов для оружия
	// melee_one_hand и ranged_one_hand совместимы с базовым one_hand
	if cardSlot == "one_hand" {
		if slotType == "melee_one_hand" || slotType == "ranged_one_hand" ||
			slotType == "melee_two_hands" || slotType == "ranged_two_hands" {
			log.Printf("🔍 [COMPAT] Совместимость: базовый one_hand совместим с %s", slotType)
			return true
		}
	}

	// Обратная совместимость: новые типы слотов совместимы с базовым one_hand
	if (cardSlot == "melee_one_hand" || cardSlot == "ranged_one_hand" ||
		cardSlot == "melee_two_hands" || cardSlot == "ranged_two_hands") && slotType == "one_hand" {
		log.Printf("🔍 [COMPAT] Совместимость: специфичный слот %s совместим с базовым one_hand", cardSlot)
		return true
	}

	// Двуручное оружие совместимо с two_hands
	if cardSlot == "two_hands" {
		if slotType == "melee_two_hands" || slotType == "ranged_two_hands" {
			log.Printf("🔍 [COMPAT] Совместимость: базовый two_hands совместим с %s", slotType)
			return true
		}
	}

	if (cardSlot == "melee_two_hands" || cardSlot == "ranged_two_hands") && slotType == "two_hands" {
		log.Printf("🔍 [COMPAT] Совместимость: специфичный слот %s совместим с базовым two_hands", cardSlot)
		return true
	}

	// Универсальное оружие совместимо с melee_one_hand и ranged_one_hand
	if cardSlot == "versatile" {
		if slotType == "melee_one_hand" || slotType == "ranged_one_hand" || slotType == "one_hand" {
			log.Printf("🔍 [COMPAT] Совместимость: универсальное оружие совместимо с %s", slotType)
			return true
		}
	}

	log.Printf("🔍 [COMPAT] Совместимость: несовместимо")
	return false
}

// contains проверяет наличие элемента в слайсе
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// ArmorCalculationResult - результат расчета защиты
type ArmorCalculationResult struct {
	BaseAC    int                     `json:"base_ac"`    // Базовая защита (10 + модификатор ЛВК)
	ArmorAC   int                     `json:"armor_ac"`   // Защита от брони
	FinalAC   int                     `json:"final_ac"`   // Итоговая защита
	ArmorType string                  `json:"armor_type"` // Тип брони
	ArmorName string                  `json:"armor_name"` // Название брони
	Details   ArmorCalculationDetails `json:"details"`    // Детали расчета
}

// ArmorCalculationDetails - детали расчета защиты
type ArmorCalculationDetails struct {
	BaseFormula  string `json:"base_formula"`  // Формула базовой защиты
	ArmorFormula string `json:"armor_formula"` // Формула защиты от брони
	DexterityMod int    `json:"dexterity_mod"` // Модификатор ловкости
	ArmorBonus   int    `json:"armor_bonus"`   // Бонус от брони
	MaxDexBonus  *int   `json:"max_dex_bonus"` // Максимальный бонус от ловкости (для средней брони)
}

// CalculateArmorClass рассчитывает защиту персонажа с учетом экипированной брони
func (controller *CharacterV2Controller) CalculateArmorClass(character *CharacterV2, inventories []Inventory) ArmorCalculationResult {
	result := ArmorCalculationResult{
		BaseAC: 10 + (character.Dexterity-10)/2, // Базовая защита = 10 + модификатор ЛВК
		Details: ArmorCalculationDetails{
			BaseFormula:  "10 + модификатор ЛВК",
			DexterityMod: (character.Dexterity - 10) / 2,
		},
	}

	// Ищем экипированную броню в слоте "body"
	var equippedArmor *InventoryItem
	for _, inv := range inventories {
		for _, item := range inv.Items {
			if item.IsEquipped && item.EquippedSlot != nil && *item.EquippedSlot == "body" {
				equippedArmor = &item
				break
			}
		}
		if equippedArmor != nil {
			break
		}
	}

	if equippedArmor == nil {
		// Нет брони - используем базовую защиту
		result.FinalAC = result.BaseAC
		result.ArmorType = "Без брони"
		result.ArmorName = ""
		result.Details.ArmorFormula = "Без брони"
		return result
	}

	// Определяем тип брони по свойствам
	armorType := "Неизвестно"
	armorBonus := 0
	maxDexBonus := (*int)(nil)

	if equippedArmor.Card.Properties != nil {
		properties := *equippedArmor.Card.Properties
		for _, prop := range properties {
			switch prop {
			case PropertyCloth:
				armorType = "Ткань"
				armorBonus = 0
				// Ткань работает как легкая броня
				result.Details.ArmorFormula = "Значение защиты + модификатор ЛВК"
			case PropertyLightArmor:
				armorType = "Легкая броня"
				armorBonus = 0
				result.Details.ArmorFormula = "Значение защиты + модификатор ЛВК"
			case PropertyMediumArmor:
				armorType = "Средняя броня"
				armorBonus = 0
				maxDexBonus = new(int)
				*maxDexBonus = 2
				result.Details.ArmorFormula = "Значение защиты + модификатор ЛВК (до +2)"
			case PropertyHeavyArmor:
				armorType = "Тяжелая броня"
				armorBonus = 0
				result.Details.ArmorFormula = "Значение защиты"
			}
		}
	}

	// Получаем бонус защиты от предмета
	if equippedArmor.Card.BonusType != nil && *equippedArmor.Card.BonusType == BonusDefense {
		if equippedArmor.Card.BonusValue != nil {
			// Парсим бонус (может быть "+1", "1", "+2" и т.д.)
			bonusStr := *equippedArmor.Card.BonusValue
			if len(bonusStr) > 0 && bonusStr[0] == '+' {
				bonusStr = bonusStr[1:]
			}
			if bonus, err := strconv.Atoi(bonusStr); err == nil {
				armorBonus = bonus
			}
		}
	}

	result.ArmorType = armorType
	result.ArmorName = equippedArmor.Card.Name
	result.ArmorAC = armorBonus
	result.Details.ArmorBonus = armorBonus
	result.Details.MaxDexBonus = maxDexBonus

	// Рассчитываем итоговую защиту по правилам D&D
	switch armorType {
	case "Ткань", "Легкая броня":
		// Легкая броня: Значение защиты + модификатор ЛВК
		result.FinalAC = armorBonus + result.Details.DexterityMod
	case "Средняя броня":
		// Средняя броня: Значение защиты + модификатор ЛВК (до +2)
		dexBonus := result.Details.DexterityMod
		if maxDexBonus != nil && dexBonus > *maxDexBonus {
			dexBonus = *maxDexBonus
		}
		result.FinalAC = armorBonus + dexBonus
	case "Тяжелая броня":
		// Тяжелая броня: Значение защиты (без модификатора ЛВК)
		result.FinalAC = armorBonus
	default:
		// Неизвестный тип брони - используем базовую защиту
		result.FinalAC = result.BaseAC
	}

	return result
}

// GetCharacterArmor возвращает информацию о защите персонажа
func (controller *CharacterV2Controller) GetCharacterArmor(c *gin.Context) {
	startTime := time.Now()
	log.Printf("🛡️ [ARMOR] Начало расчета защиты персонажа")

	characterID := c.Param("id")
	userID, err := GetCurrentUserID(c)
	if err != nil {
		log.Printf("❌ [ARMOR] Ошибка получения user_id: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	// Проверяем, что персонаж принадлежит пользователю
	var character CharacterV2
	if err := controller.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character).Error; err != nil {
		log.Printf("❌ [ARMOR] Персонаж не найден: %v", err)
		c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		return
	}

	// Получаем инвентари персонажа
	var inventories []Inventory
	if err := controller.db.Preload("Items.Card").Where("character_id = ?", characterID).Find(&inventories).Error; err != nil {
		log.Printf("❌ [ARMOR] Ошибка получения инвентарей: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения инвентарей"})
		return
	}

	// Рассчитываем защиту
	armorResult := controller.CalculateArmorClass(&character, inventories)

	log.Printf("✅ [ARMOR] Расчет защиты завершен за %v", time.Since(startTime))
	log.Printf("🛡️ [ARMOR] Итоговая защита: %d (тип: %s)", armorResult.FinalAC, armorResult.ArmorType)

	c.JSON(http.StatusOK, armorResult)
}
