package main

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ImageLibraryController struct {
	db *gorm.DB
}

func NewImageLibraryController(db *gorm.DB) *ImageLibraryController {
	return &ImageLibraryController{db: db}
}

// GetImageLibrary возвращает список изображений из библиотеки
func (c *ImageLibraryController) GetImageLibrary(ctx *gin.Context) {
	// Параметры пагинации
	page, _ := strconv.Atoi(ctx.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(ctx.DefaultQuery("limit", "30"))
	offset := (page - 1) * limit

	// Параметры фильтрации
	search := ctx.Query("search")
	rarity := ctx.Query("rarity")
	itemType := ctx.Query("item_type")
	weaponType := ctx.Query("weapon_type")
	armorType := ctx.Query("armor_type")
	slot := ctx.Query("slot")

	// Строим запрос
	query := c.db.Model(&ImageLibrary{}).Where("deleted_at IS NULL")

	// Поиск по названию карты
	if search != "" {
		query = query.Where("card_name ILIKE ?", "%"+search+"%")
	}

	// Фильтр по редкости
	if rarity != "" {
		query = query.Where("card_rarity = ?", rarity)
	}

	// Фильтр по типу предмета
	if itemType != "" {
		query = query.Where("item_type = ?", itemType)
	}

	// Фильтр по типу оружия
	if weaponType != "" {
		query = query.Where("weapon_type = ?", weaponType)
	}

	// Фильтр по типу брони
	if armorType != "" {
		query = query.Where("armor_type = ?", armorType)
	}

	// Фильтр по слоту экипировки
	if slot != "" {
		query = query.Where("slot = ?", slot)
	}

	// Получаем общее количество
	var total int64
	query.Count(&total)

	// Получаем изображения
	var images []ImageLibrary
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&images).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения изображений"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"images": images,
		"pagination": gin.H{
			"page":  page,
			"limit": limit,
			"total": total,
		},
	})
}

// AddToLibrary добавляет изображение в библиотеку
func (c *ImageLibraryController) AddToLibrary(ctx *gin.Context) {
	var req struct {
		CloudinaryID     string         `json:"cloudinary_id" binding:"required"`
		CloudinaryURL    string         `json:"cloudinary_url" binding:"required"`
		OriginalName     *string        `json:"original_name"`
		FileSize         *int           `json:"file_size"`
		CardName         *string        `json:"card_name"`
		CardRarity       *string        `json:"card_rarity"`
		ItemType         *string        `json:"item_type"`
		WeaponType       *string        `json:"weapon_type"`
		ArmorType        *string        `json:"armor_type"`
		Slot             *EquipmentSlot `json:"slot"`
		GenerationPrompt *string        `json:"generation_prompt"`
		GenerationModel  *string        `json:"generation_model"`
		GenerationTimeMs *int           `json:"generation_time_ms"`
	}

	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	// Проверяем, не существует ли уже такое изображение
	var existing ImageLibrary
	if err := c.db.Where("cloudinary_id = ?", req.CloudinaryID).First(&existing).Error; err == nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": "Изображение уже существует в библиотеке"})
		return
	}

	// Создаем новую запись
	image := ImageLibrary{
		CloudinaryID:     req.CloudinaryID,
		CloudinaryURL:    req.CloudinaryURL,
		OriginalName:     req.OriginalName,
		FileSize:         req.FileSize,
		CardName:         req.CardName,
		CardRarity:       req.CardRarity,
		ItemType:         req.ItemType,
		WeaponType:       req.WeaponType,
		ArmorType:        req.ArmorType,
		Slot:             req.Slot,
		GenerationPrompt: req.GenerationPrompt,
		GenerationModel:  req.GenerationModel,
		GenerationTimeMs: req.GenerationTimeMs,
	}

	if err := c.db.Create(&image).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка добавления изображения"})
		return
	}

	ctx.JSON(http.StatusCreated, gin.H{
		"message": "Изображение добавлено в библиотеку",
		"image":   image,
	})
}

// UpdateImageLibrary обновляет метаданные изображения в библиотеке
func (c *ImageLibraryController) UpdateImageLibrary(ctx *gin.Context) {
	idStr := ctx.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID изображения"})
		return
	}

	var req struct {
		CardName   *string `json:"card_name"`
		CardRarity *string `json:"card_rarity"`
	}

	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	// Находим изображение
	var image ImageLibrary
	if err := c.db.Where("id = ? AND deleted_at IS NULL", id).First(&image).Error; err != nil {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "Изображение не найдено"})
		return
	}

	// Обновляем поля
	updates := make(map[string]interface{})
	if req.CardName != nil {
		updates["card_name"] = *req.CardName
	}
	if req.CardRarity != nil {
		updates["card_rarity"] = *req.CardRarity
	}

	if err := c.db.Model(&image).Updates(updates).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления изображения"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"message": "Изображение обновлено",
		"image":   image,
	})
}

// DeleteFromLibrary удаляет изображение из библиотеки (мягкое удаление)
func (c *ImageLibraryController) DeleteFromLibrary(ctx *gin.Context) {
	idStr := ctx.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID изображения"})
		return
	}

	// Находим изображение
	var image ImageLibrary
	if err := c.db.Where("id = ? AND deleted_at IS NULL", id).First(&image).Error; err != nil {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "Изображение не найдено"})
		return
	}

	// Мягкое удаление
	if err := c.db.Delete(&image).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления изображения"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"message": "Изображение удалено из библиотеки"})
}

// GetRarities возвращает список доступных редкостей
func (c *ImageLibraryController) GetRarities(ctx *gin.Context) {
	var rarities []string
	if err := c.db.Model(&ImageLibrary{}).
		Where("deleted_at IS NULL AND card_rarity IS NOT NULL").
		Distinct("card_rarity").
		Pluck("card_rarity", &rarities).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения редкостей"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"rarities": rarities})
}

// UpdateImageLibraryFromCards обновляет записи в библиотеке изображений на основе данных из таблицы cards
func (c *ImageLibraryController) UpdateImageLibraryFromCards(ctx *gin.Context) {
	// Обновляем item_type, weapon_type, slot из карт
	if err := c.db.Exec(`
		UPDATE image_library il
		SET 
			item_type = c.type,
			weapon_type = c.weapon_type,
			slot = c.slot,
			updated_at = CURRENT_TIMESTAMP
		FROM cards c
		WHERE il.cloudinary_id = c.image_cloudinary_id
		  AND c.deleted_at IS NULL
		  AND il.deleted_at IS NULL
		  AND (
			c.type IS NOT NULL 
			OR c.weapon_type IS NOT NULL 
			OR c.slot IS NOT NULL
		  )
	`).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка обновления типов: %v", err)})
		return
	}

	// Обновляем armor_type из properties карт
	// Используем функцию check_property_contains для безопасной проверки
	armorTypes := []struct {
		prop      string
		armorType string
	}{
		{"cloth", "cloth"},
		{"light_armor", "light_armor"},
		{"medium_armor", "medium_armor"},
		{"heavy_armor", "heavy_armor"},
	}

	for _, at := range armorTypes {
		// Используем безопасный подход с проверкой JSON и массива
		if err := c.db.Exec(fmt.Sprintf(`
			UPDATE image_library il
			SET 
				armor_type = '%s',
				updated_at = CURRENT_TIMESTAMP
			FROM cards c
			WHERE il.cloudinary_id = c.image_cloudinary_id
			  AND c.deleted_at IS NULL
			  AND il.deleted_at IS NULL
			  AND c.properties IS NOT NULL
			  AND (
				(c.properties::text LIKE '[%%' AND c.properties::jsonb @> '["%s"]'::jsonb)
				OR
				(c.properties::text LIKE '{%%' AND ARRAY['%s']::text[] <@ c.properties::text[])
				OR
				(c.properties::text LIKE '%%"%s"%%')
			  )
		`, at.armorType, at.prop, at.prop, at.prop)).Error; err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка обновления типа брони %s: %v", at.armorType, err)})
			return
		}
	}

	ctx.JSON(http.StatusOK, gin.H{
		"message": "Библиотека изображений успешно обновлена",
		"updated": true,
	})
}
