package main

import (
	"context"
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

// maxListLimit — верхняя граница параметра limit в списковых эндпоинтах
// справочников, чтобы ?limit=100000 не мог выкачать всю таблицу разом.
const maxListLimit = 500

// Catalog pagination is an interactive/export boundary, not an arbitrary SQL
// offset API. Bounding page also prevents integer overflow in offset math.
const maxListPage = 1_000_000

// parseListPagination читает page/limit из query с дефолтами и клампит их
// в разумные границы. Общий помощник для всех списковых хендлеров справочников.
func parseListPagination(c *gin.Context) (page, limit, offset int) {
	return parseListPaginationWithDefault(c, 20)
}

// parseListPaginationWithDefault preserves endpoints that historically returned
// a complete small reference catalog while still enforcing the global limit cap.
func parseListPaginationWithDefault(c *gin.Context, defaultLimit int) (page, limit, offset int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	if page > maxListPage {
		page = maxListPage
	}
	if defaultLimit < 1 || defaultLimit > maxListLimit {
		defaultLimit = 20
	}
	limit, _ = strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(defaultLimit)))
	if limit < 1 {
		limit = defaultLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	offset = (page - 1) * limit
	return
}

// wantsListView сообщает, что клиент просит облегчённую проекцию (?fields=list):
// без тяжёлых полей (detailed_description, mechanics, script, condition_description),
// нужных только в детальном превью/движке, но не в списках и автодополнении.
func wantsListView(c *gin.Context) bool {
	return c.Query("fields") == "list"
}

// listImageURL never ships embedded base64 originals in catalog projections.
// Crucially, a row without either stored source projects an empty URL instead
// of a route that is guaranteed to return 404.
func listImageURL(entityType string, entityID uuid.UUID, cloudinaryURL string, hasLegacyImage bool) string {
	cloudinaryURL = strings.TrimSpace(cloudinaryURL)
	if strings.HasPrefix(cloudinaryURL, "https://") {
		return cloudinaryURL
	}
	cloudSourceCanUseMediaRoute := contentImageSourceUsable(cloudinaryURL)
	if !cloudSourceCanUseMediaRoute && !hasLegacyImage {
		return ""
	}
	return "/api/content-images/" + entityType + "/" + entityID.String()
}

// listLegacyImageIDs checks only image presence, never reading a potentially
// multi-megabyte embedded data URI into a catalog response or application row.
func listLegacyImageIDs(db *gorm.DB, entityType string, entityIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	table, allowed := contentImageTables[entityType]
	if !allowed {
		return nil, fmt.Errorf("unsupported content image type %q", entityType)
	}
	result := make(map[uuid.UUID]bool)
	if len(entityIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	if err := db.Table(table).
		Select("id").
		Where(`id IN ? AND deleted_at IS NULL AND (
			BTRIM(image_url) LIKE 'https://%'
			OR (
				LEFT(BTRIM(image_url), 1) = '/'
				AND LEFT(BTRIM(image_url), 2) <> '//'
				AND STRPOS(BTRIM(image_url), CHR(92)) = 0
			)
			OR BTRIM(image_url) ~ '^data:image/(avif|gif|jpeg|png|webp)(;[^,]*)?;base64,.+$'
		)`, entityIDs).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ID] = true
	}
	return result, nil
}

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
	light := wantsListView(c)
	if light {
		query = query.Omit("ImageURL", "DetailedDescription", "ImageGenerationPrompt", "Mechanics")
	}

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
	page, limit, offset := parseListPagination(c)

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
	legacyImageIDs := map[uuid.UUID]bool{}
	if light {
		ids := make([]uuid.UUID, 0, len(cards))
		for _, card := range cards {
			if !contentImageSourceUsable(card.ImageCloudinaryURL) {
				ids = append(ids, card.ID)
			}
		}
		var imageErr error
		legacyImageIDs, imageErr = listLegacyImageIDs(cc.db, "cards", ids)
		if imageErr != nil {
			log.Printf("Ошибка проверки изображений карточек: %v", imageErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
			return
		}
	}

	// Преобразование в ответы
	responses := make([]CardResponse, 0, len(cards))
	for _, card := range cards {
		r := card.ToCardResponse()
		if light {
			r.DetailedDescription = nil
			r.Mechanics = nil
			r.ImageURL = listImageURL("cards", card.ID, card.ImageCloudinaryURL, legacyImageIDs[card.ID])
		}
		responses = append(responses, r)
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

	c.JSON(http.StatusOK, card.ToCardResponse())
}

// GetCardBattleStats - нормализация карточки к боевому профилю для сервиса battle
func (cc *CardController) GetCardBattleStats(c *gin.Context) {
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

	c.JSON(http.StatusOK, cc.buildBattleStats(card))
}

type BatchBattleStatsRequest struct {
	CardIDs []uuid.UUID `json:"card_ids" binding:"required"`
}

// GetBatchCardBattleStats - батч нормализация карточек в боевые профили
func (cc *CardController) GetBatchCardBattleStats(c *gin.Context) {
	var req BatchBattleStatsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	var cards []Card
	if err := cc.db.Where("id IN ?", req.CardIDs).Find(&cards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения карточек"})
		return
	}
	stats := make([]gin.H, 0, len(cards))
	for _, card := range cards {
		stats = append(stats, cc.buildBattleStats(card))
	}
	c.JSON(http.StatusOK, gin.H{"items": stats, "count": len(stats)})
}

func (cc *CardController) buildBattleStats(card Card) gin.H {
	profile := map[string]interface{}{}
	if card.BattleProfile != nil {
		for k, v := range *card.BattleProfile {
			profile[k] = v
		}
	}

	kind := getString(profile, "kind")
	if kind == "" {
		kind = cc.deriveBattleKind(card)
	}
	ready := getBool(profile, "ready")
	if _, ok := profile["ready"]; !ok {
		ready = kind != "none"
	}
	damageDice := getString(profile, "damage_dice")
	if damageDice == "" && card.BonusType != nil && *card.BonusType == BonusDamage && card.BonusValue != nil {
		damageDice = *card.BonusValue
	}
	damageType := getString(profile, "damage_type")
	if damageType == "" && card.DamageType != nil {
		damageType = *card.DamageType
	}
	acBonus := getIntPtr(profile, "ac_bonus")
	if acBonus == nil && card.BonusType != nil && *card.BonusType == BonusDefense && card.BonusValue != nil {
		if parsed, ok := parseSignedInt(*card.BonusValue); ok {
			acBonus = &parsed
		}
	}
	toHitBonus := getIntPtr(profile, "to_hit_bonus")
	if toHitBonus == nil && card.BonusType != nil && *card.BonusType == BonusDamage && card.BonusValue != nil {
		if parsed, ok := parseSignedInt(*card.BonusValue); ok {
			toHitBonus = &parsed
		}
	}

	return gin.H{
		"card_id":        card.ID,
		"name":           card.Name,
		"ready":          ready,
		"kind":           kind,
		"slot":           card.Slot,
		"weapon_type":    card.WeaponType,
		"mastery":        card.Mastery,
		"damage_dice":    emptyToNil(damageDice),
		"damage_type":    emptyToNil(damageType),
		"to_hit_bonus":   toHitBonus,
		"ac_bonus":       acBonus,
		"effects":        card.Effects,
		"battle_profile": profile,
	}
}

func (cc *CardController) deriveBattleKind(card Card) string {
	if card.BonusType != nil {
		if *card.BonusType == BonusDamage {
			return "weapon"
		}
		if *card.BonusType == BonusDefense {
			return "armor"
		}
	}
	if card.Type != nil {
		switch *card.Type {
		case "weapon", "ammunition":
			return "weapon"
		case "shield", "helmet", "chest", "gloves", "cloak", "boots", "ring", "necklace":
			return "armor"
		case "potion", "scroll":
			return "consumable"
		}
	}
	return "none"
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func getIntPtr(m map[string]interface{}, key string) *int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			x := int(n)
			return &x
		case int:
			x := n
			return &x
		case string:
			if parsed, ok := parseSignedInt(n); ok {
				return &parsed
			}
		}
	}
	return nil
}

func parseSignedInt(s string) (int, bool) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(s, "+"))
	n, err := strconv.Atoi(trimmed)
	return n, err == nil
}

func emptyToNil(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// CreateCard - создание новой карточки
func normalizeCreateCardTemplateType(value TemplateType) (TemplateType, bool) {
	if value == "" {
		return TemplateFalse, true
	}
	return value, IsValidTemplateType(value)
}

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

	customRarityColor, colorErr := ResolveCustomRarityColor(req.Rarity, req.CustomRarityColor, nil)
	if colorErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": colorErr.Error()})
		return
	}

	if req.BonusType != nil && !IsValidBonusType(*req.BonusType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип бонуса"})
		return
	}

	if req.ElementalDamageType != nil && *req.ElementalDamageType != "" && !IsValidElementalDamageType(*req.ElementalDamageType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип стихийного урона"})
		return
	}

	if req.DamageType != nil && *req.DamageType != "" && !IsValidDamageType(*req.DamageType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип урона"})
		return
	}

	if !ValidateProperties(req.Properties) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимые свойства"})
		return
	}

	if !ValidateCardPrice(req.Price) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая цена"})
		return
	}
	if !ValidateCurrency(req.PriceCurrency) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая валюта"})
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

	templateType, validTemplateType := normalizeCreateCardTemplateType(req.IsTemplate)
	if !validTemplateType {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип шаблона"})
		return
	}
	req.IsTemplate = templateType

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
		NameEn:                       req.NameEn,
		Properties:                   NormalizeProperties(req.Properties),
		Description:                  req.Description,
		DetailedDescription:          req.DetailedDescription,
		Rarity:                       req.Rarity,
		CustomRarityColor:            customRarityColor,
		ImageURL:                     req.ImageURL,
		Price:                        req.Price,
		PriceCurrency:                req.PriceCurrency,
		PriceAbbreviated:             req.PriceAbbreviated,
		Weight:                       req.Weight,
		BonusType:                    req.BonusType,
		BonusValue:                   req.BonusValue,
		DamageType:                   req.DamageType,
		ElementalDamageValue:         req.ElementalDamageValue,
		ElementalDamageType:          req.ElementalDamageType,
		EnchantBonus:                 req.EnchantBonus,
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
		Mastery:                      req.Mastery,
		RelatedCards:                 NormalizeProperties(req.RelatedCards),
		RelatedActions:               NormalizeProperties(req.RelatedActions),
		RelatedEffects:               NormalizeProperties(req.RelatedEffects),
		Attunement:                   req.Attunement,
		RequiresAttunement:           req.RequiresAttunement,
		Range:                        req.Range,
		Tags:                         NormalizeProperties(req.Tags),
		IsTemplate:                   req.IsTemplate,
		Slot:                         req.Slot,
		Effects:                      req.Effects,
		Mechanics:                    req.Mechanics,
		BattleProfile:                req.BattleProfile,
		ContainerMode:                req.ContainerMode,
		Contents:                     req.Contents,
		CardNumber:                   cardNumber,
	}

	if err := cc.db.Create(&card).Error; err != nil {
		fmt.Printf("❌ [CREATE CARD] Ошибка БД: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания карточки"})
		return
	}

	c.JSON(http.StatusCreated, card.ToCardResponse())
}

// applyNullableStringUpdate applies the PATCH-style transport contract used by
// UpdateCard for nullable string fields: nil omits the field, an empty string
// clears it back to SQL NULL, and every other value replaces it.
func applyNullableStringUpdate(field **string, requested *string) {
	if requested == nil {
		return
	}
	if *requested == "" {
		*field = nil
		return
	}
	value := *requested
	*field = &value
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

	if req.ElementalDamageType != nil && *req.ElementalDamageType != "" && !IsValidElementalDamageType(*req.ElementalDamageType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип стихийного урона"})
		return
	}

	if req.DamageType != nil && *req.DamageType != "" && !IsValidDamageType(*req.DamageType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип урона"})
		return
	}

	if req.Properties != nil && !ValidateProperties(req.Properties) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимые свойства"})
		return
	}

	if req.Price != nil && !ValidateCardPrice(req.Price) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая цена"})
		return
	}
	if !ValidateCurrency(req.PriceCurrency) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимая валюта"})
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

	if req.IsTemplate != "" && !IsValidTemplateType(req.IsTemplate) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый тип шаблона"})
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
	// Без гварда: nil здесь законно значит «оригинального названия нет», иначе его было бы не стереть.
	card.NameEn = req.NameEn
	if req.Properties != nil {
		card.Properties = NormalizeProperties(req.Properties)
	}
	if req.Description != nil {
		card.Description = *req.Description
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
	if req.PriceCurrency != nil {
		card.PriceCurrency = req.PriceCurrency
	}
	if req.PriceAbbreviated != nil {
		card.PriceAbbreviated = req.PriceAbbreviated
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
	if req.ElementalDamageValue != nil {
		card.ElementalDamageValue = req.ElementalDamageValue
	}
	if req.ElementalDamageType != nil {
		card.ElementalDamageType = req.ElementalDamageType
	}
	if req.EnchantBonus != nil {
		card.EnchantBonus = req.EnchantBonus
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
	applyNullableStringUpdate(&card.Mastery, req.Mastery)
	if req.RelatedCards != nil {
		card.RelatedCards = NormalizeProperties(req.RelatedCards)
	}
	if req.RelatedActions != nil {
		card.RelatedActions = NormalizeProperties(req.RelatedActions)
	}
	if req.RelatedEffects != nil {
		card.RelatedEffects = NormalizeProperties(req.RelatedEffects)
	}
	if req.Attunement != nil {
		card.Attunement = req.Attunement
	}
	if req.RequiresAttunement != nil {
		card.RequiresAttunement = req.RequiresAttunement
	}
	if req.Mechanics != nil {
		// Пустой объект {} — явный сброс механики.
		if len(*req.Mechanics) == 0 {
			card.Mechanics = nil
		} else {
			card.Mechanics = req.Mechanics
		}
	}
	applyNullableStringUpdate(&card.Range, req.Range)
	if req.Tags != nil {
		card.Tags = NormalizeProperties(req.Tags)
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
	if req.BattleProfile != nil {
		card.BattleProfile = req.BattleProfile
	}
	if req.ContainerMode != nil {
		card.ContainerMode = req.ContainerMode
	}
	if req.Contents != nil {
		card.Contents = req.Contents
	}

	customRarityColor, colorErr := ResolveCustomRarityColor(card.Rarity, req.CustomRarityColor, card.CustomRarityColor)
	if colorErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": colorErr.Error()})
		return
	}
	card.CustomRarityColor = customRarityColor

	if err := cc.db.Save(&card).Error; err != nil {
		log.Printf("Ошибка обновления карточки %s: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления карточки"})
		return
	}

	c.JSON(http.StatusOK, card.ToCardResponse())
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
	imageSize := "" // пустой размер → квадрат по умолчанию (для ручного промпта)
	if prompt == "" {
		itemType := ""
		if card.Type != nil {
			itemType = *card.Type
		}
		prompt = GenerateImagePrompt(card.Name, card.Description, string(card.Rarity), ImageStyleFantasy, ImagePromptOptions{
			ItemType: itemType,
		})
		imageSize = GenerateImageSize(itemType, card.Name, card.Description)
	}

	// Генерация изображения через OpenAI API
	var imageURL string
	if cc.openaiService != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), imageGenerationRequestBudget)
		defer cancel()
		generatedURL, err := cc.openaiService.GenerateImageContext(ctx, prompt, "high", imageSize)
		if err != nil {
			if writeImageContextError(c, err) {
				return
			}
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
		responses = append(responses, card.ToCardResponse())
	}

	c.JSON(http.StatusOK, gin.H{
		"cards":   responses,
		"message": "Карточки готовы для экспорта",
	})
}

// generateCardNumber - генерация уникального номера карточки
func generateCardNumber(db *gorm.DB) string {
	var maxCard Card
	// Только CARD-*: иначе MVP-* и другие префиксы ломают счётчик и дают коллизию CARD-0001.
	db.Unscoped().Where("card_number LIKE ?", "CARD-%").Order("card_number DESC").First(&maxCard)

	nextNum := 1
	if strings.HasPrefix(maxCard.CardNumber, "CARD-") {
		if num, err := strconv.Atoi(strings.TrimPrefix(maxCard.CardNumber, "CARD-")); err == nil {
			nextNum = num + 1
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
	light := wantsListView(c)
	if light {
		query = query.Omit("ImageURL", "DetailedDescription", "ImageGenerationPrompt", "Mechanics", "Script")
	}

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

	// Фильтрация по пользовательскому типу (поле type — «basic» для базовых действий и т.п.)
	if typ := c.Query("type"); typ != "" {
		query = query.Where("type = ?", typ)
	}

	// Поиск по названию или card_number
	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ? OR card_number = ?", "%"+search+"%", search)
	}

	// Пагинация
	page, limit, offset := parseListPagination(c)

	// Подсчет общего количества
	var total int64
	query.Count(&total)

	// Получение действий
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&actions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения действий"})
		return
	}
	legacyImageIDs := map[uuid.UUID]bool{}
	if light {
		ids := make([]uuid.UUID, 0, len(actions))
		for _, action := range actions {
			if !contentImageSourceUsable(action.ImageCloudinaryURL) {
				ids = append(ids, action.ID)
			}
		}
		var imageErr error
		legacyImageIDs, imageErr = listLegacyImageIDs(ac.db, "actions", ids)
		if imageErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения действий"})
			return
		}
	}

	// Преобразование в ответы
	responses := make([]ActionResponse, 0, len(actions))
	for _, action := range actions {
		// Конвертируем ActionResources в []ActionResource для ответа
		r := action.ToActionResponse()
		if light {
			r.DetailedDescription = nil
			r.Mechanics = nil
			r.Script = nil
			r.ImageURL = listImageURL("actions", action.ID, action.ImageCloudinaryURL, legacyImageIDs[action.ID])
		}
		responses = append(responses, r)
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

	c.JSON(http.StatusOK, action.ToActionResponse())
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
		NameEn:                       req.NameEn,
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
		Mechanics:                    req.Mechanics,
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

	c.JSON(http.StatusCreated, action.ToActionResponse())
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
	if rejectLockedMechanicsMutation(c, action.Support, action.Mechanics, req.Mechanics) {
		return
	}

	// Обновление полей
	if req.Name != "" {
		action.Name = req.Name
	}
	action.NameEn = req.NameEn
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
	if req.Mechanics != nil {
		if len(*req.Mechanics) == 0 {
			action.Mechanics = nil
		} else {
			action.Mechanics = req.Mechanics
		}
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

	c.JSON(http.StatusOK, action.ToActionResponse())
}

// DeleteAction - удаление действия
func (ac *ActionController) DeleteAction(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID действия"})
		return
	}

	var action Action
	if err := ac.db.Select("id", "support").Where("id = ?", id).First(&action).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Действие не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения действия"})
		return
	}
	if rejectLockedContentMutation(c, action.Support) {
		return
	}

	if err := ac.db.Delete(&action).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления действия"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Действие удалено"})
}

// generateActionNumber - генерация номера действия
func (ac *ActionController) generateActionNumber() string {
	var maxAction Action
	// Фильтруем по префиксу, иначе чужой card_number (без ACTION-) ломает счётчик и даёт коллизию.
	ac.db.Unscoped().Where("card_number LIKE ?", "ACTION-%").Order("card_number DESC").First(&maxAction)

	nextNum := 1
	if strings.HasPrefix(maxAction.CardNumber, "ACTION-") {
		if num, err := strconv.Atoi(strings.TrimPrefix(maxAction.CardNumber, "ACTION-")); err == nil {
			nextNum = num + 1
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
	light := wantsListView(c)
	if light {
		query = query.Omit("ImageURL", "DetailedDescription", "ImageGenerationPrompt", "Mechanics", "Script", "ConditionDescription")
	}

	// Фильтрация по редкости
	if rarity := c.Query("rarity"); rarity != "" {
		query = query.Where("rarity = ?", rarity)
	}

	// Фильтрация по типу эффекта (enum effect_type)
	if effectType := c.Query("effect_type"); effectType != "" {
		query = query.Where("effect_type = ?", effectType)
	}

	// Фильтрация по пользовательскому типу (поле type — «Дар договора» и т.п.)
	if typ := c.Query("type"); typ != "" {
		query = query.Where("type = ?", typ)
	}

	// Поиск по названию или card_number
	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ? OR card_number = ?", "%"+search+"%", search)
	}

	// Пагинация
	page, limit, offset := parseListPagination(c)

	// Подсчет общего количества
	var total int64
	query.Count(&total)

	// Получение эффектов
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&effects).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффектов"})
		return
	}
	legacyImageIDs := map[uuid.UUID]bool{}
	if light {
		ids := make([]uuid.UUID, 0, len(effects))
		for _, effect := range effects {
			if !contentImageSourceUsable(effect.ImageCloudinaryURL) {
				ids = append(ids, effect.ID)
			}
		}
		var imageErr error
		legacyImageIDs, imageErr = listLegacyImageIDs(ec.db, "effects", ids)
		if imageErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффектов"})
			return
		}
	}

	// Преобразование в ответы
	references := make([]string, 0, len(effects))
	for _, effect := range effects {
		references = append(references, effect.CardNumber)
	}
	recommendations, recommendationErr := loadChoiceRecommendations(ec.db, "effect", references)
	if recommendationErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения рекомендаций эффектов"})
		return
	}
	responses := make([]EffectResponse, 0, len(effects))
	for _, effect := range effects {
		r := effect.ToEffectResponse()
		r.ChoiceRecommendations = recommendations[effect.CardNumber]
		if light {
			r.DetailedDescription = nil
			r.Mechanics = nil
			r.Script = nil
			r.ConditionDescription = nil
			r.ImageURL = listImageURL("effects", effect.ID, effect.ImageCloudinaryURL, legacyImageIDs[effect.ID])
		}
		responses = append(responses, r)
	}

	c.JSON(http.StatusOK, gin.H{
		"effects": responses,
		"total":   total,
		"page":    page,
		"limit":   limit,
	})
}

// GetEffect - получение эффекта по ID (UUID) или card_number
func (ec *EffectController) GetEffect(c *gin.Context) {
	idParam := c.Param("id")

	var effect Effect
	var err error
	if id, uuidErr := uuid.Parse(idParam); uuidErr == nil {
		err = ec.db.Where("id = ?", id).First(&effect).Error
	} else {
		err = ec.db.Where("card_number = ?", idParam).First(&effect).Error
	}

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Эффект не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффекта"})
		return
	}

	recommendations, recommendationErr := loadChoiceRecommendations(ec.db, "effect", []string{effect.CardNumber})
	if recommendationErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения рекомендаций эффекта"})
		return
	}
	response := effect.ToEffectResponse()
	response.ChoiceRecommendations = recommendations[effect.CardNumber]
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
		NameEn:                       req.NameEn,
		Description:                  req.Description,
		DetailedDescription:          req.DetailedDescription,
		ImageURL:                     req.ImageURL,
		Rarity:                       req.Rarity,
		CardNumber:                   cardNumber,
		EffectType:                   req.EffectType,
		ConditionDescription:         req.ConditionDescription,
		Script:                       req.Script,
		Mechanics:                    req.Mechanics,
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
		Repeatable:                   req.Repeatable,
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

	c.JSON(http.StatusCreated, effect.ToEffectResponse())
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
	if rejectLockedMechanicsMutation(c, effect.Support, effect.Mechanics, req.Mechanics) {
		return
	}

	// Обновление полей
	if req.Name != "" {
		effect.Name = req.Name
	}
	effect.NameEn = req.NameEn
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
	if req.Mechanics != nil {
		if len(*req.Mechanics) == 0 {
			effect.Mechanics = nil
		} else {
			effect.Mechanics = req.Mechanics
		}
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
	if req.Repeatable != nil {
		effect.Repeatable = *req.Repeatable
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

	c.JSON(http.StatusOK, effect.ToEffectResponse())
}

// DeleteEffect - удаление эффекта
func (ec *EffectController) DeleteEffect(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID эффекта"})
		return
	}

	var effect Effect
	if err := ec.db.Select("id", "support").Where("id = ?", id).First(&effect).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Эффект не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения эффекта"})
		return
	}
	if rejectLockedContentMutation(c, effect.Support) {
		return
	}

	if err := ec.db.Delete(&effect).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления эффекта"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Эффект удален"})
}

// generateEffectNumber - генерация номера эффекта
func (ec *EffectController) generateEffectNumber() string {
	var maxEffect Effect
	// Фильтруем по префиксу, иначе чужой card_number (без EFFECT-) ломает счётчик и даёт коллизию.
	ec.db.Unscoped().Where("card_number LIKE ?", "EFFECT-%").Order("card_number DESC").First(&maxEffect)

	nextNum := 1
	if strings.HasPrefix(maxEffect.CardNumber, "EFFECT-") {
		if num, err := strconv.Atoi(strings.TrimPrefix(maxEffect.CardNumber, "EFFECT-")); err == nil {
			nextNum = num + 1
		}
	}

	return fmt.Sprintf("EFFECT-%04d", nextNum)
}
