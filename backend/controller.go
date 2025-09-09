package main

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CardController - контроллер для работы с карточками
type CardController struct {
	db            *gorm.DB
	openaiService *OpenAIService
}

// NewCardController - создание нового контроллера
func NewCardController(db *gorm.DB) *CardController {
	return &CardController{
		db:            db,
		openaiService: NewOpenAIService(),
	}
}

// GetCards - получение списка карточек с фильтрацией
func (cc *CardController) GetCards(c *gin.Context) {
	var cards []Card

	query := cc.db.Model(&Card{})

	// Фильтрация по редкости
	if rarity := c.Query("rarity"); rarity != "" {
		query = query.Where("rarity = ?", rarity)
	}

	// Фильтрация по свойствам
	if properties := c.Query("properties"); properties != "" {
		query = query.Where("properties = ?", properties)
	}

	// Поиск по названию
	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ?", "%"+search+"%")
	}

	// Фильтрация по типу шаблона
	if excludeTemplateOnly := c.Query("exclude_template_only"); excludeTemplateOnly == "true" {
		// Показываем только карты, которые не являются только шаблонами
		query = query.Where("is_template != ? OR is_template IS NULL", "only_template")
	}

	if templateOnly := c.Query("template_only"); templateOnly == "true" {
		// Показываем только карты, которые являются шаблонами
		query = query.Where("is_template IN ?", []string{"template", "only_template"})
	}

	// Пагинация
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset := (page - 1) * limit

	var total int64
	if err := query.Count(&total).Error; err != nil {
		log.Printf("Ошибка подсчета карточек: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
		return
	}
	log.Printf("Найдено карточек: %d", total)

	if err := query.Offset(offset).Limit(limit).Order("created_at DESC").Find(&cards).Error; err != nil {
		log.Printf("Ошибка получения карточек: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
		return
	}
	log.Printf("Загружено карточек: %d", len(cards))

	// Преобразование в ответы
	responses := make([]CardResponse, 0)
	for _, card := range cards {
		responses = append(responses, CardResponse{
			ID:                  card.ID,
			Name:                card.Name,
			Properties:          card.Properties,
			Description:         card.Description,
			DetailedDescription: card.DetailedDescription,
			ImageURL:            card.ImageURL,
			Rarity:              card.Rarity,
			CardNumber:          card.CardNumber,
			Price:               card.Price,
			Weight:              card.Weight,
			BonusType:           card.BonusType,
			BonusValue:          card.BonusValue,
			DamageType:          card.DamageType,
			DefenseType:         card.DefenseType,
			Type:                card.Type,
			DescriptionFontSize: card.DescriptionFontSize,
			IsExtended:          card.IsExtended,
			IsTemplate:          card.IsTemplate,
			CreatedAt:           card.CreatedAt,
			UpdatedAt:           card.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"cards": responses,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// GetCard - получение карточки по ID
func (cc *CardController) GetCard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID карточки"})
		return
	}

	var card Card
	if err := cc.db.Where("id = ?", id).First(&card).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Карточка не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточки"})
		return
	}

	response := CardResponse{
		ID:                  card.ID,
		Name:                card.Name,
		Properties:          card.Properties,
		Description:         card.Description,
		DetailedDescription: card.DetailedDescription,
		ImageURL:            card.ImageURL,
		Rarity:              card.Rarity,
		CardNumber:          card.CardNumber,
		Price:               card.Price,
		Weight:              card.Weight,
		BonusType:           card.BonusType,
		BonusValue:          card.BonusValue,
		DamageType:          card.DamageType,
		DefenseType:         card.DefenseType,
		Type:                card.Type,
		DescriptionFontSize: card.DescriptionFontSize,
		CreatedAt:           card.CreatedAt,
		UpdatedAt:           card.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}

// CreateCard - создание новой карточки
func (cc *CardController) CreateCard(c *gin.Context) {
	var req CreateCardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	// Валидация данных
	if !IsValidRarity(req.Rarity) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая редкость"})
		return
	}

	if req.BonusType != nil && !IsValidBonusType(*req.BonusType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип бонуса"})
		return
	}

	if !ValidateProperties(req.Properties) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимые свойства"})
		return
	}

	if !ValidatePrice(req.Price) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая цена (должна быть от 1 до 50000)"})
		return
	}

	if !ValidateWeight(req.Weight) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый вес (должен быть от 0.01 до 1000)"})
		return
	}

	// Генерация уникального номера карточки
	cardNumber := generateCardNumber(cc.db)

	card := Card{
		Name:                req.Name,
		Properties:          req.Properties, // Теперь это указатель, GORM сам обработает nil
		Description:         req.Description,
		DetailedDescription: req.DetailedDescription,
		Rarity:              req.Rarity,
		ImageURL:            req.ImageURL,
		Price:               req.Price,
		Weight:              req.Weight,
		BonusType:           req.BonusType,
		BonusValue:          req.BonusValue,
		DamageType:          req.DamageType,
		DefenseType:         req.DefenseType,
		DescriptionFontSize: req.DescriptionFontSize,
		IsExtended:          req.IsExtended,
		Author:              req.Author,
		Source:              req.Source,
		Type:                req.Type,
		RelatedCards:        req.RelatedCards,
		RelatedActions:      req.RelatedActions,
		RelatedEffects:      req.RelatedEffects,
		Attunement:          req.Attunement,
		Tags:                req.Tags,
		CardNumber:          cardNumber,
	}

	if err := cc.db.Create(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания карточки"})
		return
	}

	response := CardResponse{
		ID:                  card.ID,
		Name:                card.Name,
		Properties:          card.Properties,
		Description:         card.Description,
		DetailedDescription: card.DetailedDescription,
		ImageURL:            card.ImageURL,
		Rarity:              card.Rarity,
		CardNumber:          card.CardNumber,
		Price:               card.Price,
		Weight:              card.Weight,
		BonusType:           card.BonusType,
		BonusValue:          card.BonusValue,
		DamageType:          card.DamageType,
		DefenseType:         card.DefenseType,
		Type:                card.Type,
		DescriptionFontSize: card.DescriptionFontSize,
		CreatedAt:           card.CreatedAt,
		UpdatedAt:           card.UpdatedAt,
	}

	c.JSON(http.StatusCreated, response)
}

// UpdateCard - обновление карточки
func (cc *CardController) UpdateCard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID карточки"})
		return
	}

	var req UpdateCardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	// Валидация данных
	if req.Rarity != "" && !IsValidRarity(req.Rarity) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая редкость"})
		return
	}

	if req.BonusType != nil && !IsValidBonusType(*req.BonusType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип бонуса"})
		return
	}

	if req.Properties != nil && !ValidateProperties(req.Properties) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимые свойства"})
		return
	}

	if req.Price != nil && !ValidatePrice(req.Price) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая цена (должна быть от 1 до 50000)"})
		return
	}

	if req.Weight != nil && !ValidateWeight(req.Weight) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый вес (должен быть от 0.01 до 1000)"})
		return
	}

	var card Card
	if err := cc.db.Where("id = ?", id).First(&card).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Карточка не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточки"})
		return
	}

	// Обновление полей
	if req.Name != "" {
		card.Name = req.Name
	}
	if req.Properties != nil {
		card.Properties = req.Properties
	}
	if req.Description != "" {
		card.Description = req.Description
	}
	if req.DetailedDescription != nil && *req.DetailedDescription != "" {
		card.DetailedDescription = req.DetailedDescription
	}
	if req.Rarity != "" {
		card.Rarity = req.Rarity
	}
	if req.ImageURL != "" {
		card.ImageURL = req.ImageURL
	}
	if req.Price != nil {
		card.Price = req.Price
	}
	if req.Weight != nil {
		card.Weight = req.Weight
	}
	if req.BonusType != nil {
		card.BonusType = req.BonusType
	}
	if req.BonusValue != nil {
		card.BonusValue = req.BonusValue
	}
	if req.DamageType != nil {
		card.DamageType = req.DamageType
	}
	if req.DefenseType != nil {
		card.DefenseType = req.DefenseType
	}
	if req.DescriptionFontSize != nil {
		card.DescriptionFontSize = req.DescriptionFontSize
	}
	if req.IsExtended != nil {
		card.IsExtended = req.IsExtended
	}
	if req.Author != "" {
		card.Author = req.Author
	}
	if req.Source != nil {
		card.Source = req.Source
	}
	if req.Type != nil {
		card.Type = req.Type
	}
	if req.RelatedCards != nil {
		card.RelatedCards = req.RelatedCards
	}
	if req.RelatedActions != nil {
		card.RelatedActions = req.RelatedActions
	}
	if req.RelatedEffects != nil {
		card.RelatedEffects = req.RelatedEffects
	}
	if req.Attunement != nil {
		card.Attunement = req.Attunement
	}
	if req.Tags != nil {
		card.Tags = req.Tags
	}
	if req.IsTemplate != "" {
		card.IsTemplate = req.IsTemplate
	}

	if err := cc.db.Save(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления карточки"})
		return
	}

	response := CardResponse{
		ID:                  card.ID,
		Name:                card.Name,
		Properties:          card.Properties,
		Description:         card.Description,
		DetailedDescription: card.DetailedDescription,
		ImageURL:            card.ImageURL,
		Rarity:              card.Rarity,
		CardNumber:          card.CardNumber,
		Price:               card.Price,
		Weight:              card.Weight,
		BonusType:           card.BonusType,
		BonusValue:          card.BonusValue,
		DamageType:          card.DamageType,
		DefenseType:         card.DefenseType,
		Type:                card.Type,
		DescriptionFontSize: card.DescriptionFontSize,
		CreatedAt:           card.CreatedAt,
		UpdatedAt:           card.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}

// DeleteCard - удаление карточки
func (cc *CardController) DeleteCard(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID карточки"})
		return
	}

	// Проверяем, существует ли карточка
	var card Card
	if err := cc.db.Where("id = ?", id).First(&card).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Карточка не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточки"})
		return
	}

	// Удаляем карточку
	if err := cc.db.Delete(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления карточки"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Карточка удалена"})
}

// GenerateImage - генерация изображения для карточки
func (cc *CardController) GenerateImage(c *gin.Context) {
	var req GenerateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	var card Card
	if err := cc.db.Where("id = ?", req.CardID).First(&card).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Карточка не найдена"})
		return
	}

	// Генерация промпта для ИИ
	prompt := req.Prompt
	if prompt == "" {
		prompt = GenerateImagePrompt(card.Name, card.Description, string(card.Rarity))
	}

	// Генерация изображения через OpenAI API
	var imageURL string
	if cc.openaiService != nil {
		generatedURL, err := cc.openaiService.GenerateImage(prompt)
		if err != nil {
			// Если OpenAI недоступен, используем заглушку
			imageURL = "https://via.placeholder.com/300x400/FFFFFF/000000?text=" + strings.ReplaceAll(card.Name, " ", "+")
		} else {
			imageURL = generatedURL
		}
	} else {
		// Если OpenAI API не настроен, используем заглушку
		imageURL = "https://via.placeholder.com/300x400/FFFFFF/000000?text=" + strings.ReplaceAll(card.Name, " ", "+")
	}

	// Обновление карточки с URL изображения
	card.ImageURL = imageURL
	if err := cc.db.Save(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения изображения"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"image_url": imageURL,
		"message":   "Изображение сгенерировано",
	})
}

// ExportCards - экспорт карточек для печати
func (cc *CardController) ExportCards(c *gin.Context) {
	var req ExportCardsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	var cards []Card
	if err := cc.db.Where("id IN ?", req.CardIDs).Find(&cards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
		return
	}

	// TODO: Генерация PDF с карточками для печати
	// Пока возвращаем данные карточек

	var responses []CardResponse
	for _, card := range cards {
		responses = append(responses, CardResponse{
			ID:                  card.ID,
			Name:                card.Name,
			Properties:          card.Properties,
			Description:         card.Description,
			DetailedDescription: card.DetailedDescription,
			ImageURL:            card.ImageURL,
			Rarity:              card.Rarity,
			CardNumber:          card.CardNumber,
			Price:               card.Price,
			Weight:              card.Weight,
			BonusType:           card.BonusType,
			BonusValue:          card.BonusValue,
			CreatedAt:           card.CreatedAt,
			UpdatedAt:           card.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"cards":   responses,
		"message": "Карточки готовы для экспорта",
	})
}

// generateCardNumber - генерация уникального номера карточки
func generateCardNumber(db *gorm.DB) string {
	// Находим максимальный номер карточки (включая удаленные, так как card_number должен быть уникальным)
	var maxCard Card
	db.Unscoped().Order("card_number DESC").First(&maxCard)

	// Извлекаем номер из строки CARD-XXXX
	var nextNum int = 1
	if maxCard.CardNumber != "" {
		if len(maxCard.CardNumber) >= 9 { // CARD-XXXX
			numStr := maxCard.CardNumber[5:9]
			if num, err := strconv.Atoi(numStr); err == nil {
				nextNum = num + 1
			}
		}
	}

	return fmt.Sprintf("CARD-%04d", nextNum)
}
