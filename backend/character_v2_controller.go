package main

import (
	"encoding/json"
	"net/http"

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
		UserID:                    userID.(uuid.UUID),
		GroupID:                   nil, // Пока не поддерживаем группы
		Name:                      req.Name,
		Race:                      req.Race,
		Class:                     req.Class,
		Level:                     req.Level,
		Speed:                     req.Speed,
		Strength:                  req.Strength,
		Dexterity:                 req.Dexterity,
		Constitution:              req.Constitution,
		Intelligence:              req.Intelligence,
		Wisdom:                    req.Wisdom,
		Charisma:                  req.Charisma,
		MaxHP:                     req.MaxHP,
		CurrentHP:                 req.CurrentHP,
		SavingThrowProficiencies:  string(savingThrowJSON),
		SkillProficiencies:        string(skillJSON),
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
		ID:                        fullCharacter.ID,
		UserID:                    fullCharacter.UserID,
		GroupID:                   fullCharacter.GroupID,
		Name:                      fullCharacter.Name,
		Race:                      fullCharacter.Race,
		Class:                     fullCharacter.Class,
		Level:                     fullCharacter.Level,
		Speed:                     fullCharacter.Speed,
		Strength:                  fullCharacter.Strength,
		Dexterity:                 fullCharacter.Dexterity,
		Constitution:              fullCharacter.Constitution,
		Intelligence:              fullCharacter.Intelligence,
		Wisdom:                    fullCharacter.Wisdom,
		Charisma:                  fullCharacter.Charisma,
		MaxHP:                     fullCharacter.MaxHP,
		CurrentHP:                 fullCharacter.CurrentHP,
		SavingThrowProficiencies:  savingThrows,
		SkillProficiencies:        skills,
		CreatedAt:                 fullCharacter.CreatedAt,
		UpdatedAt:                 fullCharacter.UpdatedAt,
		User:                      fullCharacter.User,
		Group:                     fullCharacter.Group,
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
		ID:                        character.ID,
		UserID:                    character.UserID,
		GroupID:                   character.GroupID,
		Name:                      character.Name,
		Race:                      character.Race,
		Class:                     character.Class,
		Level:                     character.Level,
		Speed:                     character.Speed,
		Strength:                  character.Strength,
		Dexterity:                 character.Dexterity,
		Constitution:              character.Constitution,
		Intelligence:              character.Intelligence,
		Wisdom:                    character.Wisdom,
		Charisma:                  character.Charisma,
		MaxHP:                     character.MaxHP,
		CurrentHP:                 character.CurrentHP,
		SavingThrowProficiencies:  savingThrows,
		SkillProficiencies:        skills,
		CreatedAt:                 character.CreatedAt,
		UpdatedAt:                 character.UpdatedAt,
		User:                      character.User,
		Group:                     character.Group,
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
			ID:                        character.ID,
			UserID:                    character.UserID,
			GroupID:                   character.GroupID,
			Name:                      character.Name,
			Race:                      character.Race,
			Class:                     character.Class,
			Level:                     character.Level,
			Speed:                     character.Speed,
			Strength:                  character.Strength,
			Dexterity:                 character.Dexterity,
			Constitution:              character.Constitution,
			Intelligence:              character.Intelligence,
			Wisdom:                    character.Wisdom,
			Charisma:                  character.Charisma,
			MaxHP:                     character.MaxHP,
			CurrentHP:                 character.CurrentHP,
			SavingThrowProficiencies:  savingThrows,
			SkillProficiencies:        skills,
			CreatedAt:                 character.CreatedAt,
			UpdatedAt:                 character.UpdatedAt,
			User:                      character.User,
			Group:                     character.Group,
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
		ID:                        fullCharacter.ID,
		UserID:                    fullCharacter.UserID,
		GroupID:                   fullCharacter.GroupID,
		Name:                      fullCharacter.Name,
		Race:                      fullCharacter.Race,
		Class:                     fullCharacter.Class,
		Level:                     fullCharacter.Level,
		Speed:                     fullCharacter.Speed,
		Strength:                  fullCharacter.Strength,
		Dexterity:                 fullCharacter.Dexterity,
		Constitution:              fullCharacter.Constitution,
		Intelligence:              fullCharacter.Intelligence,
		Wisdom:                    fullCharacter.Wisdom,
		Charisma:                  fullCharacter.Charisma,
		MaxHP:                     fullCharacter.MaxHP,
		CurrentHP:                 fullCharacter.CurrentHP,
		SavingThrowProficiencies:  savingThrows,
		SkillProficiencies:        skills,
		CreatedAt:                 fullCharacter.CreatedAt,
		UpdatedAt:                 fullCharacter.UpdatedAt,
		User:                      fullCharacter.User,
		Group:                     fullCharacter.Group,
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
		ID:                        fullCharacter.ID,
		UserID:                    fullCharacter.UserID,
		GroupID:                   fullCharacter.GroupID,
		Name:                      fullCharacter.Name,
		Race:                      fullCharacter.Race,
		Class:                     fullCharacter.Class,
		Level:                     fullCharacter.Level,
		Speed:                     fullCharacter.Speed,
		Strength:                  fullCharacter.Strength,
		Dexterity:                 fullCharacter.Dexterity,
		Constitution:              fullCharacter.Constitution,
		Intelligence:              fullCharacter.Intelligence,
		Wisdom:                    fullCharacter.Wisdom,
		Charisma:                  fullCharacter.Charisma,
		MaxHP:                     fullCharacter.MaxHP,
		CurrentHP:                 fullCharacter.CurrentHP,
		SavingThrowProficiencies:  savingThrows,
		SkillProficiencies:        skills,
		CreatedAt:                 fullCharacter.CreatedAt,
		UpdatedAt:                 fullCharacter.UpdatedAt,
		User:                      fullCharacter.User,
		Group:                     fullCharacter.Group,
	}

	c.JSON(http.StatusOK, response)
}
