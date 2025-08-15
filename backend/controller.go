package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CardController - контроллер для работы с карточками
type CardController struct {
	db *gorm.DB
}

// NewCardController - создание нового контроллера
func NewCardController(db *gorm.DB) *CardController {
	return &CardController{db: db}
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
	
	// Пагинация
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset := (page - 1) * limit
	
	var total int64
	query.Count(&total)
	
	if err := query.Offset(offset).Limit(limit).Order("created_at DESC").Find(&cards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
		return
	}
	
	// Преобразование в ответы
	var responses []CardResponse
	for _, card := range cards {
		responses = append(responses, CardResponse{
			ID:          card.ID,
			Name:        card.Name,
			Properties:  card.Properties,
			Description: card.Description,
			ImageURL:    card.ImageURL,
			Rarity:      card.Rarity,
			CardNumber:  card.CardNumber,
			CreatedAt:   card.CreatedAt,
			UpdatedAt:   card.UpdatedAt,
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
		ID:          card.ID,
		Name:        card.Name,
		Properties:  card.Properties,
		Description: card.Description,
		ImageURL:    card.ImageURL,
		Rarity:      card.Rarity,
		CardNumber:  card.CardNumber,
		CreatedAt:   card.CreatedAt,
		UpdatedAt:   card.UpdatedAt,
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
	
	// Генерация уникального номера карточки
	cardNumber := generateCardNumber()
	
	card := Card{
		Name:        req.Name,
		Properties:  req.Properties,
		Description: req.Description,
		Rarity:      req.Rarity,
		CardNumber:  cardNumber,
	}
	
	if err := cc.db.Create(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания карточки"})
		return
	}
	
	response := CardResponse{
		ID:          card.ID,
		Name:        card.Name,
		Properties:  card.Properties,
		Description: card.Description,
		ImageURL:    card.ImageURL,
		Rarity:      card.Rarity,
		CardNumber:  card.CardNumber,
		CreatedAt:   card.CreatedAt,
		UpdatedAt:   card.UpdatedAt,
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
	if req.Properties != "" {
		card.Properties = req.Properties
	}
	if req.Description != "" {
		card.Description = req.Description
	}
	if req.Rarity != "" {
		card.Rarity = req.Rarity
	}
	
	if err := cc.db.Save(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления карточки"})
		return
	}
	
	response := CardResponse{
		ID:          card.ID,
		Name:        card.Name,
		Properties:  card.Properties,
		Description: card.Description,
		ImageURL:    card.ImageURL,
		Rarity:      card.Rarity,
		CardNumber:  card.CardNumber,
		CreatedAt:   card.CreatedAt,
		UpdatedAt:   card.UpdatedAt,
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
	
	if err := cc.db.Where("id = ?", id).Delete(&Card{}).Error; err != nil {
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
		prompt = fmt.Sprintf("Фэнтезийное зелье '%s', минималистичный стиль, белый фон, высокое качество", card.Name)
	}
	
	// TODO: Интеграция с OpenAI API для генерации изображения
	// Пока возвращаем заглушку
	imageURL := "https://via.placeholder.com/300x400/FFFFFF/000000?text=" + strings.ReplaceAll(card.Name, " ", "+")
	
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
			ID:          card.ID,
			Name:        card.Name,
			Properties:  card.Properties,
			Description: card.Description,
			ImageURL:    card.ImageURL,
			Rarity:      card.Rarity,
			CardNumber:  card.CardNumber,
			CreatedAt:   card.CreatedAt,
			UpdatedAt:   card.UpdatedAt,
		})
	}
	
	c.JSON(http.StatusOK, gin.H{
		"cards": responses,
		"message": "Карточки готовы для экспорта",
	})
}

// generateCardNumber - генерация уникального номера карточки
func generateCardNumber() string {
	// Простая генерация номера в формате CARD-XXXX
	return fmt.Sprintf("CARD-%04d", len(uuid.New().String()[:4]))
}
