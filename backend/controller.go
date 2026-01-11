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

	// Фильтрация по слоту экипировки
	if slot := c.Query("slot"); slot != "" {
		query = query.Where("slot = ?", slot)
	}

	// Фильтрация по типу брони
	if armorType := c.Query("armor_type"); armorType != "" {
		query = query.Where("properties LIKE ?", "%"+armorType+"%")
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

	// Сортировка
	orderBy := "created_at DESC" // По умолчанию
	if sortBy := c.Query("sort_by"); sortBy != "" {
		switch sortBy {
		case "created_asc":
			orderBy = "created_at ASC"
		case "created_desc":
			orderBy = "created_at DESC"
		case "updated_asc":
			orderBy = "updated_at ASC"
		case "updated_desc":
			orderBy = "updated_at DESC"
		case "rarity_asc":
			orderBy = "rarity ASC"
		case "rarity_desc":
			orderBy = "rarity DESC"
		case "price_asc":
			orderBy = "price ASC"
		case "price_desc":
			orderBy = "price DESC"
		}
	}

	if err := query.Offset(offset).Limit(limit).Order(orderBy).Find(&cards).Error; err != nil {
		log.Printf("Ошибка получения карточек: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
		return
	}
	log.Printf("Загружено карточек: %d", len(cards))

	// Преобразование в ответы
	responses := make([]CardResponse, 0)
	for _, card := range cards {
		responses = append(responses, CardResponse{
			ID:                           card.ID,
			Name:                         card.Name,
			Properties:                   card.Properties,
			Description:                  card.Description,
			DetailedDescription:          card.DetailedDescription,
			ImageURL:                     card.ImageURL,
			Rarity:                       card.Rarity,
			CardNumber:                   card.CardNumber,
			Price:                        card.Price,
			Weight:                       card.Weight,
			BonusType:                    card.BonusType,
			BonusValue:                   card.BonusValue,
			DamageType:                   card.DamageType,
			DefenseType:                  card.DefenseType,
			Type:                         card.Type,
			WeaponType:                   card.WeaponType,
			DescriptionFontSize:          card.DescriptionFontSize,
			TextAlignment:                card.TextAlignment,
			TextFontSize:                 card.TextFontSize,
			ShowDetailedDescription:      card.ShowDetailedDescription,
			DetailedDescriptionAlignment: card.DetailedDescriptionAlignment,
			DetailedDescriptionFontSize:  card.DetailedDescriptionFontSize,
			IsExtended:                   card.IsExtended,
			Tags:                         card.Tags,
			IsTemplate:                   card.IsTemplate,
			Slot:                         card.Slot,
			Effects:                      card.Effects,
			CreatedAt:                    card.CreatedAt,
			UpdatedAt:                    card.UpdatedAt,
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
		ID:                           card.ID,
		Name:                         card.Name,
		Properties:                   card.Properties,
		Description:                  card.Description,
		DetailedDescription:          card.DetailedDescription,
		ImageURL:                     card.ImageURL,
		Rarity:                       card.Rarity,
		CardNumber:                   card.CardNumber,
		Price:                        card.Price,
		Weight:                       card.Weight,
		BonusType:                    card.BonusType,
		BonusValue:                   card.BonusValue,
		DamageType:                   card.DamageType,
		DefenseType:                  card.DefenseType,
		Type:                         card.Type,
		WeaponType:                   card.WeaponType,
		DescriptionFontSize:          card.DescriptionFontSize,
		TextAlignment:                card.TextAlignment,
		TextFontSize:                 card.TextFontSize,
		ShowDetailedDescription:      card.ShowDetailedDescription,
		DetailedDescriptionAlignment: card.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  card.DetailedDescriptionFontSize,
		IsExtended:                   card.IsExtended,
		Tags:                         card.Tags,
		IsTemplate:                   card.IsTemplate,
		Slot:                         card.Slot,
		Effects:                      card.Effects,
		CreatedAt:                    card.CreatedAt,
		UpdatedAt:                    card.UpdatedAt,
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

	if req.Slot != nil && !IsValidEquipmentSlot(*req.Slot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый слот экипировки"})
		return
	}

	// Валидация эффектов
	if req.Effects != nil {
		fmt.Printf("🔍 [CREATE CARD] Валидируем эффекты: %+v\n", req.Effects)
		if err := ValidateEffects(req.Effects); err != nil {
			fmt.Printf("❌ [CREATE CARD] Ошибка валидации эффектов: %v\n", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Ошибка валидации эффектов: %v", err)})
			return
		}
		fmt.Printf("✅ [CREATE CARD] Эффекты прошли валидацию\n")
	}

	// Генерация уникального номера карточки
	cardNumber := generateCardNumber(cc.db)

	card := Card{
		Name:                         req.Name,
		Properties:                   req.Properties, // Теперь это указатель, GORM сам обработает nil
		Description:                  req.Description,
		DetailedDescription:          req.DetailedDescription,
		Rarity:                       req.Rarity,
		ImageURL:                     req.ImageURL,
		Price:                        req.Price,
		Weight:                       req.Weight,
		BonusType:                    req.BonusType,
		BonusValue:                   req.BonusValue,
		DamageType:                   req.DamageType,
		DefenseType:                  req.DefenseType,
		DescriptionFontSize:          req.DescriptionFontSize,
		TextAlignment:                req.TextAlignment,
		TextFontSize:                 req.TextFontSize,
		ShowDetailedDescription:      req.ShowDetailedDescription,
		DetailedDescriptionAlignment: req.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  req.DetailedDescriptionFontSize,
		IsExtended:                   req.IsExtended,
		Author:                       req.Author,
		Source:                       req.Source,
		Type:                         req.Type,
		WeaponType:                   req.WeaponType,
		RelatedCards:                 req.RelatedCards,
		RelatedActions:               req.RelatedActions,
		RelatedEffects:               req.RelatedEffects,
		Attunement:                   req.Attunement,
		Tags:                         req.Tags,
		IsTemplate:                   req.IsTemplate,
		Slot:                         req.Slot,
		Effects:                      req.Effects,
		CardNumber:                   cardNumber,
	}

	if err := cc.db.Create(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания карточки"})
		return
	}

	response := CardResponse{
		ID:                           card.ID,
		Name:                         card.Name,
		Properties:                   card.Properties,
		Description:                  card.Description,
		DetailedDescription:          card.DetailedDescription,
		ImageURL:                     card.ImageURL,
		Rarity:                       card.Rarity,
		CardNumber:                   card.CardNumber,
		Price:                        card.Price,
		Weight:                       card.Weight,
		BonusType:                    card.BonusType,
		BonusValue:                   card.BonusValue,
		DamageType:                   card.DamageType,
		DefenseType:                  card.DefenseType,
		Type:                         card.Type,
		WeaponType:                   card.WeaponType,
		DescriptionFontSize:          card.DescriptionFontSize,
		TextAlignment:                card.TextAlignment,
		TextFontSize:                 card.TextFontSize,
		ShowDetailedDescription:      card.ShowDetailedDescription,
		DetailedDescriptionAlignment: card.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  card.DetailedDescriptionFontSize,
		IsExtended:                   card.IsExtended,
		Slot:                         card.Slot,
		Effects:                      card.Effects,
		CreatedAt:                    card.CreatedAt,
		UpdatedAt:                    card.UpdatedAt,
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

	if req.Slot != nil && !IsValidEquipmentSlot(*req.Slot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый слот экипировки"})
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
	if req.DetailedDescription != nil {
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
	if req.TextAlignment != nil {
		card.TextAlignment = req.TextAlignment
	}
	if req.TextFontSize != nil {
		card.TextFontSize = req.TextFontSize
	}
	if req.ShowDetailedDescription != nil {
		card.ShowDetailedDescription = req.ShowDetailedDescription
	}
	if req.DetailedDescriptionAlignment != nil {
		card.DetailedDescriptionAlignment = req.DetailedDescriptionAlignment
	}
	if req.DetailedDescriptionFontSize != nil {
		card.DetailedDescriptionFontSize = req.DetailedDescriptionFontSize
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
	if req.WeaponType != nil {
		card.WeaponType = req.WeaponType
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
	if req.Slot != nil {
		card.Slot = req.Slot
	}
	if req.Effects != nil {
		// Валидируем эффекты перед сохранением
		fmt.Printf("🔍 [UPDATE CARD] Валидируем эффекты: %+v\n", req.Effects)
		if err := ValidateEffects(req.Effects); err != nil {
			fmt.Printf("❌ [UPDATE CARD] Ошибка валидации эффектов: %v\n", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Ошибка валидации эффектов: %v", err)})
			return
		}
		fmt.Printf("✅ [UPDATE CARD] Эффекты прошли валидацию\n")
		card.Effects = req.Effects
	}

	if err := cc.db.Save(&card).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления карточки"})
		return
	}

	response := CardResponse{
		ID:                           card.ID,
		Name:                         card.Name,
		Properties:                   card.Properties,
		Description:                  card.Description,
		DetailedDescription:          card.DetailedDescription,
		ImageURL:                     card.ImageURL,
		Rarity:                       card.Rarity,
		CardNumber:                   card.CardNumber,
		Price:                        card.Price,
		Weight:                       card.Weight,
		BonusType:                    card.BonusType,
		BonusValue:                   card.BonusValue,
		DamageType:                   card.DamageType,
		DefenseType:                  card.DefenseType,
		Type:                         card.Type,
		WeaponType:                   card.WeaponType,
		DescriptionFontSize:          card.DescriptionFontSize,
		TextAlignment:                card.TextAlignment,
		TextFontSize:                 card.TextFontSize,
		ShowDetailedDescription:      card.ShowDetailedDescription,
		DetailedDescriptionAlignment: card.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  card.DetailedDescriptionFontSize,
		IsExtended:                   card.IsExtended,
		Slot:                         card.Slot,
		Effects:                      card.Effects,
		CreatedAt:                    card.CreatedAt,
		UpdatedAt:                    card.UpdatedAt,
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
			Type:                card.Type,
			WeaponType:          card.WeaponType,
			Slot:                card.Slot,
			Effects:             card.Effects,
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

// ActionController - контроллер для работы с действиями
type ActionController struct {
	db            *gorm.DB
	openaiService *OpenAIService
}

// NewActionController - создание нового контроллера действий
func NewActionController(db *gorm.DB) *ActionController {
	return &ActionController{
		db:            db,
		openaiService: NewOpenAIService(),
	}
}

// GetActions - получение списка действий с фильтрацией
func (ac *ActionController) GetActions(c *gin.Context) {
	var actions []Action

	query := ac.db.Model(&Action{})

	// Фильтрация по редкости
	if rarity := c.Query("rarity"); rarity != "" {
		query = query.Where("rarity = ?", rarity)
	}

	// Фильтрация по ресурсу (ищем в строке через запятую)
	if resource := c.Query("resource"); resource != "" {
		query = query.Where("resource LIKE ? OR resource = ?", "%"+resource+"%", resource)
	}

	// Фильтрация по типу действия
	if actionType := c.Query("action_type"); actionType != "" {
		query = query.Where("action_type = ?", actionType)
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

	// Получение действий
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&actions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения действий"})
		return
	}

	// Преобразование в ответы
	responses := make([]ActionResponse, 0)
	for _, action := range actions {
		// Конвертируем ActionResources в []ActionResource для ответа
		resources := make([]ActionResource, 0)
		if action.Resource != nil && len(action.Resource) > 0 {
			resources = make([]ActionResource, len(action.Resource))
			for i, r := range action.Resource {
				resources[i] = r
			}
		}

		responses = append(responses, ActionResponse{
			ID:                           action.ID,
			Name:                         action.Name,
			Description:                  action.Description,
			DetailedDescription:          action.DetailedDescription,
			ImageURL:                     action.ImageURL,
			Rarity:                       action.Rarity,
			CardNumber:                   action.CardNumber,
			Resources:                    resources,
			Distance:                     action.Distance,
			Recharge:                     action.Recharge,
			RechargeCustom:               action.RechargeCustom,
			Script:                       action.Script,
			ActionType:                   action.ActionType,
			Type:                         action.Type,
			Tags:                         action.Tags,
			Price:                        action.Price,
			Weight:                       action.Weight,
			Properties:                   action.Properties,
			IsExtended:                   action.IsExtended,
			DescriptionFontSize:          action.DescriptionFontSize,
			TextAlignment:                action.TextAlignment,
			TextFontSize:                 action.TextFontSize,
			ShowDetailedDescription:      action.ShowDetailedDescription,
			DetailedDescriptionAlignment: action.DetailedDescriptionAlignment,
			DetailedDescriptionFontSize:  action.DetailedDescriptionFontSize,
			CreatedAt:                    action.CreatedAt,
			UpdatedAt:                    action.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"actions": responses,
		"total":   total,
		"page":    page,
		"limit":   limit,
	})
}

// GetAction - получение действия по ID (UUID) или card_number
func (ac *ActionController) GetAction(c *gin.Context) {
	idParam := c.Param("id")

	var action Action
	var err error

	// Пытаемся сначала найти по UUID
	if id, uuidErr := uuid.Parse(idParam); uuidErr == nil {
		err = ac.db.Where("id = ?", id).First(&action).Error
	} else {
		// Если не UUID, ищем по card_number
		err = ac.db.Where("card_number = ?", idParam).First(&action).Error
	}

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Действие не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения действия"})
		return
	}

	// Конвертируем ActionResources в []ActionResource для ответа
	resources := make([]ActionResource, 0)
	if action.Resource != nil && len(action.Resource) > 0 {
		resources = make([]ActionResource, len(action.Resource))
		for i, r := range action.Resource {
			resources[i] = r
		}
	}

	response := ActionResponse{
		ID:                           action.ID,
		Name:                         action.Name,
		Description:                  action.Description,
		DetailedDescription:          action.DetailedDescription,
		ImageURL:                     action.ImageURL,
		Rarity:                       action.Rarity,
		CardNumber:                   action.CardNumber,
		Resources:                    resources,
		Distance:                     action.Distance,
		Recharge:                     action.Recharge,
		RechargeCustom:               action.RechargeCustom,
		Script:                       action.Script,
		ActionType:                   action.ActionType,
		Type:                         action.Type,
		Tags:                         action.Tags,
		Price:                        action.Price,
		Weight:                       action.Weight,
		Properties:                   action.Properties,
		IsExtended:                   action.IsExtended,
		DescriptionFontSize:          action.DescriptionFontSize,
		TextAlignment:                action.TextAlignment,
		TextFontSize:                 action.TextFontSize,
		ShowDetailedDescription:      action.ShowDetailedDescription,
		DetailedDescriptionAlignment: action.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  action.DetailedDescriptionFontSize,
		CreatedAt:                    action.CreatedAt,
		UpdatedAt:                    action.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}

// CreateAction - создание нового действия
func (ac *ActionController) CreateAction(c *gin.Context) {
	log.Printf("🎯 [CREATE_ACTION] Начало создания действия")

	var req CreateActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("❌ [CREATE_ACTION] Ошибка парсинга JSON: %v", err)
		log.Printf("❌ [CREATE_ACTION] Тело запроса: %s", c.GetString("request_body"))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}

	log.Printf("🔍 [CREATE_ACTION] Получен запрос: Name=%s, Rarity=%s, ActionType=%s, Resources=%v",
		req.Name, req.Rarity, req.ActionType, req.Resources)
	log.Printf("🔍 [CREATE_ACTION] Детали запроса: CardNumber=%s, Price=%v, Weight=%v, Properties=%v",
		req.CardNumber, req.Price, req.Weight, req.Properties)

	// Валидация данных
	log.Printf("🔍 [CREATE_ACTION] Проверка редкости: %s", req.Rarity)
	if !IsValidRarity(req.Rarity) {
		log.Printf("❌ [CREATE_ACTION] Недопустимая редкость: %s", req.Rarity)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая редкость", "rarity": req.Rarity})
		return
	}
	log.Printf("✅ [CREATE_ACTION] Редкость валидна: %s", req.Rarity)

	log.Printf("🔍 [CREATE_ACTION] Проверка свойств: %v", req.Properties)
	if !ValidateProperties(req.Properties) {
		log.Printf("❌ [CREATE_ACTION] Недопустимые свойства: %v", req.Properties)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимые свойства", "properties": req.Properties})
		return
	}
	log.Printf("✅ [CREATE_ACTION] Свойства валидны")

	log.Printf("🔍 [CREATE_ACTION] Проверка цены: %v", req.Price)
	if !ValidatePrice(req.Price) {
		log.Printf("❌ [CREATE_ACTION] Недопустимая цена: %v", req.Price)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая цена (должна быть от 1 до 50000)", "price": req.Price})
		return
	}
	log.Printf("✅ [CREATE_ACTION] Цена валидна: %v", req.Price)

	log.Printf("🔍 [CREATE_ACTION] Проверка веса: %v", req.Weight)
	if !ValidateWeight(req.Weight) {
		log.Printf("❌ [CREATE_ACTION] Недопустимый вес: %v", req.Weight)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый вес (должен быть от 0.01 до 1000)", "weight": req.Weight})
		return
	}
	log.Printf("✅ [CREATE_ACTION] Вес валиден: %v", req.Weight)

	// Проверка уникальности card_number (ID действия)
	log.Printf("🔍 [CREATE_ACTION] Проверка card_number: %s", req.CardNumber)
	cardNumber := req.CardNumber
	if cardNumber == "" {
		// Если ID не указан, генерируем автоматически
		cardNumber = ac.generateActionNumber()
		log.Printf("🔍 [CREATE_ACTION] CardNumber не указан, сгенерирован автоматически: %s", cardNumber)
	} else {
		log.Printf("🔍 [CREATE_ACTION] Проверка уникальности card_number: %s", cardNumber)
		// Проверяем уникальность указанного ID
		var existingAction Action
		if err := ac.db.Where("card_number = ?", cardNumber).First(&existingAction).Error; err == nil {
			log.Printf("❌ [CREATE_ACTION] Действие с таким ID уже существует: %s", cardNumber)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Действие с таким ID уже существует", "card_number": cardNumber})
			return
		}
		log.Printf("✅ [CREATE_ACTION] CardNumber уникален")

		// Проверяем формат ID (латинские буквы, цифры, дефисы и подчеркивания, до 30 символов)
		log.Printf("🔍 [CREATE_ACTION] Проверка формата card_number: %s", cardNumber)
		matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,30}$", cardNumber)
		if !matched {
			log.Printf("❌ [CREATE_ACTION] Неверный формат card_number: %s (длина: %d)", cardNumber, len(cardNumber))
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов", "card_number": cardNumber})
			return
		}
		log.Printf("✅ [CREATE_ACTION] Формат card_number валиден")
	}

	// Проверка обязательных полей
	log.Printf("🔍 [CREATE_ACTION] Проверка обязательных полей")
	if req.Name == "" {
		log.Printf("❌ [CREATE_ACTION] Отсутствует обязательное поле: Name")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поле 'name' обязательно для заполнения"})
		return
	}
	if req.Description == "" {
		log.Printf("❌ [CREATE_ACTION] Отсутствует обязательное поле: Description")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поле 'description' обязательно для заполнения"})
		return
	}
	if len(req.Resources) == 0 {
		log.Printf("❌ [CREATE_ACTION] Отсутствует обязательное поле: Resources")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поле 'resources' обязательно для заполнения (должен содержать хотя бы один ресурс)"})
		return
	}
	if req.ActionType == "" {
		log.Printf("❌ [CREATE_ACTION] Отсутствует обязательное поле: ActionType")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поле 'action_type' обязательно для заполнения"})
		return
	}
	log.Printf("✅ [CREATE_ACTION] Все обязательные поля присутствуют")

	// Конвертируем []ActionResource в ActionResources для сохранения в БД
	resources := make(ActionResources, len(req.Resources))
	for i, r := range req.Resources {
		resources[i] = r
	}

	// Создание действия
	log.Printf("🔍 [CREATE_ACTION] Создание объекта Action")
	action := Action{
		Name:                         req.Name,
		Description:                  req.Description,
		DetailedDescription:          req.DetailedDescription,
		ImageURL:                     req.ImageURL,
		Rarity:                       req.Rarity,
		CardNumber:                   cardNumber,
		Resource:                     resources,
		Distance:                     req.Distance,
		Recharge:                     req.Recharge,
		RechargeCustom:               req.RechargeCustom,
		Script:                       req.Script,
		ActionType:                   req.ActionType,
		Type:                         req.Type,
		Author:                       req.Author,
		Source:                       req.Source,
		Tags:                         req.Tags,
		Price:                        req.Price,
		Weight:                       req.Weight,
		Properties:                   req.Properties,
		RelatedCards:                 req.RelatedCards,
		RelatedActions:               req.RelatedActions,
		IsExtended:                   req.IsExtended,
		DescriptionFontSize:          req.DescriptionFontSize,
		TextAlignment:                req.TextAlignment,
		TextFontSize:                 req.TextFontSize,
		ShowDetailedDescription:      req.ShowDetailedDescription,
		DetailedDescriptionAlignment: req.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  req.DetailedDescriptionFontSize,
	}

	if req.Author == "" {
		action.Author = "Admin"
		log.Printf("🔍 [CREATE_ACTION] Author не указан, установлен по умолчанию: Admin")
	}

	log.Printf("🔍 [CREATE_ACTION] Сохранение действия в БД: Name=%s, CardNumber=%s", action.Name, action.CardNumber)
	if err := ac.db.Create(&action).Error; err != nil {
		log.Printf("❌ [CREATE_ACTION] Ошибка создания действия в БД: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания действия", "details": err.Error()})
		return
	}
	log.Printf("✅ [CREATE_ACTION] Действие успешно создано: ID=%s, CardNumber=%s", action.ID, action.CardNumber)

	response := ActionResponse{
		ID:                           action.ID,
		Name:                         action.Name,
		Description:                  action.Description,
		DetailedDescription:          action.DetailedDescription,
		ImageURL:                     action.ImageURL,
		Rarity:                       action.Rarity,
		CardNumber:                   action.CardNumber,
		Resources:                    resources,
		Distance:                     action.Distance,
		Recharge:                     action.Recharge,
		RechargeCustom:               action.RechargeCustom,
		Script:                       action.Script,
		ActionType:                   action.ActionType,
		Type:                         action.Type,
		Tags:                         action.Tags,
		Price:                        action.Price,
		Weight:                       action.Weight,
		Properties:                   action.Properties,
		IsExtended:                   action.IsExtended,
		DescriptionFontSize:          action.DescriptionFontSize,
		TextAlignment:                action.TextAlignment,
		TextFontSize:                 action.TextFontSize,
		ShowDetailedDescription:      action.ShowDetailedDescription,
		DetailedDescriptionAlignment: action.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  action.DetailedDescriptionFontSize,
		CreatedAt:                    action.CreatedAt,
		UpdatedAt:                    action.UpdatedAt,
	}

	c.JSON(http.StatusCreated, response)
}

// UpdateAction - обновление действия
func (ac *ActionController) UpdateAction(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID действия"})
		return
	}

	var req UpdateActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	var action Action
	if err := ac.db.Where("id = ?", id).First(&action).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Действие не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения действия"})
		return
	}

	// Обновление полей
	if req.Name != "" {
		action.Name = req.Name
	}
	if req.Description != "" {
		action.Description = req.Description
	}
	if req.DetailedDescription != nil {
		action.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		action.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		action.Rarity = req.Rarity
	}
	if len(req.Resources) > 0 {
		resources := make(ActionResources, len(req.Resources))
		for i, r := range req.Resources {
			resources[i] = r
		}
		action.Resource = resources
	}
	if req.Distance != nil {
		action.Distance = req.Distance
	}
	if req.Recharge != nil {
		action.Recharge = req.Recharge
	}
	if req.RechargeCustom != nil {
		action.RechargeCustom = req.RechargeCustom
	}
	if req.Script != nil {
		action.Script = req.Script
	}
	if req.ActionType != "" {
		action.ActionType = req.ActionType
	}
	if req.Type != nil {
		action.Type = req.Type
	}
	if req.Author != "" {
		action.Author = req.Author
	}
	if req.Source != nil {
		action.Source = req.Source
	}
	if req.Tags != nil {
		if ValidateProperties(req.Tags) {
			action.Tags = req.Tags
		}
	}
	if req.Price != nil {
		if ValidatePrice(req.Price) {
			action.Price = req.Price
		}
	}
	if req.Weight != nil {
		if ValidateWeight(req.Weight) {
			action.Weight = req.Weight
		}
	}
	if req.Properties != nil {
		if ValidateProperties(req.Properties) {
			action.Properties = req.Properties
		}
	}
	if req.RelatedCards != nil {
		action.RelatedCards = req.RelatedCards
	}
	if req.RelatedActions != nil {
		action.RelatedActions = req.RelatedActions
	}
	if req.IsExtended != nil {
		action.IsExtended = req.IsExtended
	}
	if req.DescriptionFontSize != nil {
		action.DescriptionFontSize = req.DescriptionFontSize
	}
	if req.TextAlignment != nil {
		action.TextAlignment = req.TextAlignment
	}
	if req.TextFontSize != nil {
		action.TextFontSize = req.TextFontSize
	}
	if req.ShowDetailedDescription != nil {
		action.ShowDetailedDescription = req.ShowDetailedDescription
	}
	if req.DetailedDescriptionAlignment != nil {
		action.DetailedDescriptionAlignment = req.DetailedDescriptionAlignment
	}
	if req.DetailedDescriptionFontSize != nil {
		action.DetailedDescriptionFontSize = req.DetailedDescriptionFontSize
	}

	if err := ac.db.Save(&action).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления действия"})
		return
	}

	// Конвертируем ActionResources в []ActionResource для ответа
	responseResources := make([]ActionResource, len(action.Resource))
	for i, r := range action.Resource {
		responseResources[i] = r
	}

	response := ActionResponse{
		ID:                           action.ID,
		Name:                         action.Name,
		Description:                  action.Description,
		DetailedDescription:          action.DetailedDescription,
		ImageURL:                     action.ImageURL,
		Rarity:                       action.Rarity,
		CardNumber:                   action.CardNumber,
		Resources:                    responseResources,
		Distance:                     action.Distance,
		Recharge:                     action.Recharge,
		RechargeCustom:               action.RechargeCustom,
		Script:                       action.Script,
		ActionType:                   action.ActionType,
		Type:                         action.Type,
		Tags:                         action.Tags,
		Price:                        action.Price,
		Weight:                       action.Weight,
		Properties:                   action.Properties,
		IsExtended:                   action.IsExtended,
		DescriptionFontSize:          action.DescriptionFontSize,
		TextAlignment:                action.TextAlignment,
		TextFontSize:                 action.TextFontSize,
		ShowDetailedDescription:      action.ShowDetailedDescription,
		DetailedDescriptionAlignment: action.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  action.DetailedDescriptionFontSize,
		CreatedAt:                    action.CreatedAt,
		UpdatedAt:                    action.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}

// DeleteAction - удаление действия
func (ac *ActionController) DeleteAction(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID действия"})
		return
	}

	if err := ac.db.Delete(&Action{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления действия"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Действие удалено"})
}

// generateActionNumber - генерация номера действия
func (ac *ActionController) generateActionNumber() string {
	var maxAction Action
	ac.db.Unscoped().Order("card_number DESC").First(&maxAction)

	// Извлекаем номер из строки ACTION-XXXX
	var nextNum int = 1
	if maxAction.CardNumber != "" {
		if len(maxAction.CardNumber) >= 11 { // ACTION-XXXX
			numStr := maxAction.CardNumber[7:11]
			if num, err := strconv.Atoi(numStr); err == nil {
				nextNum = num + 1
			}
		}
	}

	return fmt.Sprintf("ACTION-%04d", nextNum)
}

// EffectController - контроллер для работы с эффектами
type EffectController struct {
	db            *gorm.DB
	openaiService *OpenAIService
}

// NewEffectController - создание нового контроллера эффектов
func NewEffectController(db *gorm.DB) *EffectController {
	return &EffectController{
		db:            db,
		openaiService: NewOpenAIService(),
	}
}

// GetEffects - получение списка эффектов с фильтрацией
func (ec *EffectController) GetEffects(c *gin.Context) {
	var effects []Effect

	query := ec.db.Model(&Effect{})

	// Фильтрация по редкости
	if rarity := c.Query("rarity"); rarity != "" {
		query = query.Where("rarity = ?", rarity)
	}

	// Фильтрация по типу эффекта
	if effectType := c.Query("effect_type"); effectType != "" {
		query = query.Where("effect_type = ?", effectType)
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

	// Получение эффектов
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&effects).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффектов"})
		return
	}

	// Преобразование в ответы
	responses := make([]EffectResponse, 0)
	for _, effect := range effects {
		responses = append(responses, EffectResponse{
			ID:                           effect.ID,
			Name:                         effect.Name,
			Description:                  effect.Description,
			DetailedDescription:          effect.DetailedDescription,
			ImageURL:                     effect.ImageURL,
			Rarity:                       effect.Rarity,
			CardNumber:                   effect.CardNumber,
			EffectType:                   effect.EffectType,
			ConditionDescription:         effect.ConditionDescription,
			Script:                       effect.Script,
			Type:                         effect.Type,
			Tags:                         effect.Tags,
			Price:                        effect.Price,
			Weight:                       effect.Weight,
			Properties:                   effect.Properties,
			IsExtended:                   effect.IsExtended,
			DescriptionFontSize:          effect.DescriptionFontSize,
			TextAlignment:                effect.TextAlignment,
			TextFontSize:                 effect.TextFontSize,
			ShowDetailedDescription:      effect.ShowDetailedDescription,
			DetailedDescriptionAlignment: effect.DetailedDescriptionAlignment,
			DetailedDescriptionFontSize:  effect.DetailedDescriptionFontSize,
			CreatedAt:                    effect.CreatedAt,
			UpdatedAt:                    effect.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"effects": responses,
		"total":   total,
		"page":    page,
		"limit":   limit,
	})
}

// GetEffect - получение эффекта по ID
func (ec *EffectController) GetEffect(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID эффекта"})
		return
	}

	var effect Effect
	if err := ec.db.Where("id = ?", id).First(&effect).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Эффект не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффекта"})
		return
	}

	response := EffectResponse{
		ID:                           effect.ID,
		Name:                         effect.Name,
		Description:                  effect.Description,
		DetailedDescription:          effect.DetailedDescription,
		ImageURL:                     effect.ImageURL,
		Rarity:                       effect.Rarity,
		CardNumber:                   effect.CardNumber,
		EffectType:                   effect.EffectType,
		ConditionDescription:         effect.ConditionDescription,
		Script:                       effect.Script,
		Type:                         effect.Type,
		Tags:                         effect.Tags,
		Price:                        effect.Price,
		Weight:                       effect.Weight,
		Properties:                   effect.Properties,
		IsExtended:                   effect.IsExtended,
		DescriptionFontSize:          effect.DescriptionFontSize,
		TextAlignment:                effect.TextAlignment,
		TextFontSize:                 effect.TextFontSize,
		ShowDetailedDescription:      effect.ShowDetailedDescription,
		DetailedDescriptionAlignment: effect.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  effect.DetailedDescriptionFontSize,
		CreatedAt:                    effect.CreatedAt,
		UpdatedAt:                    effect.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}

// CreateEffect - создание нового эффекта
func (ec *EffectController) CreateEffect(c *gin.Context) {
	var req CreateEffectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	// Валидация данных
	if !IsValidRarity(req.Rarity) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая редкость"})
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

	// Проверка уникальности card_number (ID эффекта)
	cardNumber := req.CardNumber
	if cardNumber == "" {
		// Если ID не указан, генерируем автоматически
		cardNumber = ec.generateEffectNumber()
	} else {
		// Проверяем уникальность указанного ID
		var existingEffect Effect
		if err := ec.db.Where("card_number = ?", cardNumber).First(&existingEffect).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Эффект с таким ID уже существует"})
			return
		}
		// Проверяем формат ID (латинские буквы, цифры, дефисы и подчеркивания, до 30 символов)
		matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,30}$", cardNumber)
		if !matched {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов"})
			return
		}
	}

	// Создание эффекта
	effect := Effect{
		Name:                         req.Name,
		Description:                  req.Description,
		DetailedDescription:          req.DetailedDescription,
		ImageURL:                     req.ImageURL,
		Rarity:                       req.Rarity,
		CardNumber:                   cardNumber,
		EffectType:                   req.EffectType,
		ConditionDescription:         req.ConditionDescription,
		Script:                       req.Script,
		Type:                         req.Type,
		Author:                       req.Author,
		Source:                       req.Source,
		Tags:                         req.Tags,
		Price:                        req.Price,
		Weight:                       req.Weight,
		Properties:                   req.Properties,
		RelatedCards:                 req.RelatedCards,
		RelatedActions:               req.RelatedActions,
		RelatedEffects:               req.RelatedEffects,
		IsExtended:                   req.IsExtended,
		DescriptionFontSize:          req.DescriptionFontSize,
		TextAlignment:                req.TextAlignment,
		TextFontSize:                 req.TextFontSize,
		ShowDetailedDescription:      req.ShowDetailedDescription,
		DetailedDescriptionAlignment: req.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  req.DetailedDescriptionFontSize,
	}

	if req.Author == "" {
		effect.Author = "Admin"
	}

	if err := ec.db.Create(&effect).Error; err != nil {
		// Проверяем, является ли ошибка нарушением уникальности
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "UNIQUE constraint") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Эффект с таким ID уже существует"})
			return
		}
		log.Printf("Ошибка создания эффекта: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка создания эффекта: %v", err)})
		return
	}

	response := EffectResponse{
		ID:                           effect.ID,
		Name:                         effect.Name,
		Description:                  effect.Description,
		DetailedDescription:          effect.DetailedDescription,
		ImageURL:                     effect.ImageURL,
		Rarity:                       effect.Rarity,
		CardNumber:                   effect.CardNumber,
		EffectType:                   effect.EffectType,
		ConditionDescription:         effect.ConditionDescription,
		Script:                       effect.Script,
		Type:                         effect.Type,
		Tags:                         effect.Tags,
		Price:                        effect.Price,
		Weight:                       effect.Weight,
		Properties:                   effect.Properties,
		IsExtended:                   effect.IsExtended,
		DescriptionFontSize:          effect.DescriptionFontSize,
		TextAlignment:                effect.TextAlignment,
		TextFontSize:                 effect.TextFontSize,
		ShowDetailedDescription:      effect.ShowDetailedDescription,
		DetailedDescriptionAlignment: effect.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  effect.DetailedDescriptionFontSize,
		CreatedAt:                    effect.CreatedAt,
		UpdatedAt:                    effect.UpdatedAt,
	}

	c.JSON(http.StatusCreated, response)
}

// UpdateEffect - обновление эффекта
func (ec *EffectController) UpdateEffect(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID эффекта"})
		return
	}

	var req UpdateEffectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}

	var effect Effect
	if err := ec.db.Where("id = ?", id).First(&effect).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Эффект не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффекта"})
		return
	}

	// Обновление полей
	if req.Name != "" {
		effect.Name = req.Name
	}
	if req.Description != "" {
		effect.Description = req.Description
	}
	if req.DetailedDescription != nil {
		effect.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		effect.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		effect.Rarity = req.Rarity
	}
	if req.EffectType != "" {
		effect.EffectType = req.EffectType
	}
	if req.ConditionDescription != nil {
		effect.ConditionDescription = req.ConditionDescription
	}
	if req.Script != nil {
		effect.Script = req.Script
	}
	if req.Type != nil {
		effect.Type = req.Type
	}
	if req.Author != "" {
		effect.Author = req.Author
	}
	if req.Source != nil {
		effect.Source = req.Source
	}
	if req.Tags != nil {
		if ValidateProperties(req.Tags) {
			effect.Tags = req.Tags
		}
	}
	if req.Price != nil {
		if ValidatePrice(req.Price) {
			effect.Price = req.Price
		}
	}
	if req.Weight != nil {
		if ValidateWeight(req.Weight) {
			effect.Weight = req.Weight
		}
	}
	if req.Properties != nil {
		if ValidateProperties(req.Properties) {
			effect.Properties = req.Properties
		}
	}
	if req.RelatedCards != nil {
		effect.RelatedCards = req.RelatedCards
	}
	if req.RelatedActions != nil {
		effect.RelatedActions = req.RelatedActions
	}
	if req.RelatedEffects != nil {
		effect.RelatedEffects = req.RelatedEffects
	}
	if req.IsExtended != nil {
		effect.IsExtended = req.IsExtended
	}
	if req.DescriptionFontSize != nil {
		effect.DescriptionFontSize = req.DescriptionFontSize
	}
	if req.TextAlignment != nil {
		effect.TextAlignment = req.TextAlignment
	}
	if req.TextFontSize != nil {
		effect.TextFontSize = req.TextFontSize
	}
	if req.ShowDetailedDescription != nil {
		effect.ShowDetailedDescription = req.ShowDetailedDescription
	}
	if req.DetailedDescriptionAlignment != nil {
		effect.DetailedDescriptionAlignment = req.DetailedDescriptionAlignment
	}
	if req.DetailedDescriptionFontSize != nil {
		effect.DetailedDescriptionFontSize = req.DetailedDescriptionFontSize
	}

	if err := ec.db.Save(&effect).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления эффекта"})
		return
	}

	response := EffectResponse{
		ID:                           effect.ID,
		Name:                         effect.Name,
		Description:                  effect.Description,
		DetailedDescription:          effect.DetailedDescription,
		ImageURL:                     effect.ImageURL,
		Rarity:                       effect.Rarity,
		CardNumber:                   effect.CardNumber,
		EffectType:                   effect.EffectType,
		ConditionDescription:         effect.ConditionDescription,
		Script:                       effect.Script,
		Type:                         effect.Type,
		Tags:                         effect.Tags,
		Price:                        effect.Price,
		Weight:                       effect.Weight,
		Properties:                   effect.Properties,
		IsExtended:                   effect.IsExtended,
		DescriptionFontSize:          effect.DescriptionFontSize,
		TextAlignment:                effect.TextAlignment,
		TextFontSize:                 effect.TextFontSize,
		ShowDetailedDescription:      effect.ShowDetailedDescription,
		DetailedDescriptionAlignment: effect.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  effect.DetailedDescriptionFontSize,
		CreatedAt:                    effect.CreatedAt,
		UpdatedAt:                    effect.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}

// DeleteEffect - удаление эффекта
func (ec *EffectController) DeleteEffect(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID эффекта"})
		return
	}

	if err := ec.db.Delete(&Effect{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления эффекта"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Эффект удален"})
}

// generateEffectNumber - генерация номера эффекта
func (ec *EffectController) generateEffectNumber() string {
	var maxEffect Effect
	ec.db.Unscoped().Order("card_number DESC").First(&maxEffect)

	// Извлекаем номер из строки EFFECT-XXXX
	var nextNum int = 1
	if maxEffect.CardNumber != "" {
		if len(maxEffect.CardNumber) >= 11 { // EFFECT-XXXX
			numStr := maxEffect.CardNumber[7:11]
			if num, err := strconv.Atoi(numStr); err == nil {
				nextNum = num + 1
			}
		}
	}

	return fmt.Sprintf("EFFECT-%04d", nextNum)
}
