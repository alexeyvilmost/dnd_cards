package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const imageGenerationRequestBudget = 175 * time.Second

// ImageController контроллер для работы с изображениями
type ImageController struct {
	db            *gorm.DB
	yandexStorage *YandexStorageService
	generation    *generatedImageService
}

// NewImageController создает новый экземпляр контроллера
func NewImageController(db *gorm.DB, yandexStorage *YandexStorageService, openAIService *OpenAIService) *ImageController {
	return &ImageController{
		db:            db,
		yandexStorage: yandexStorage,
		generation:    newGeneratedImageService(openAIService, yandexStorage),
	}
}

// UploadImage загружает изображение для сущности библиотеки.
func (ic *ImageController) UploadImage(c *gin.Context) {
	// Получаем параметры из формы
	entityType := c.PostForm("entity_type")
	entityID := c.PostForm("entity_id")

	if entityType == "" || entityID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "необходимо указать entity_type и entity_id"})
		return
	}
	folder, supported := map[string]string{
		"card": "cards", "monster": "monster_tokens",
		"spell": "spell_icons", "action": "action_icons",
		"effect": "effect_icons", "feat": "feat_icons",
	}[entityType]
	if !supported {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неподдерживаемый тип сущности"})
		return
	}
	if _, err := uuid.Parse(entityID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID сущности"})
		return
	}
	if ic.yandexStorage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "хранилище изображений не настроено"})
		return
	}

	// Получаем файл из формы
	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "файл изображения не найден"})
		return
	}

	// Проверяем тип файла
	if !isValidImageType(file.Header.Get("Content-Type")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неподдерживаемый тип файла"})
		return
	}

	// Загружаем изображение в Yandex Cloud Storage
	ctx := context.Background()
	imageURL, cloudinaryID, err := ic.yandexStorage.UploadImage(ctx, file, folder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка загрузки изображения: %v", err)})
		return
	}

	// Обновляем запись в базе данных
	if err := ic.updateEntityImage(entityType, entityID, imageURL, cloudinaryID, false, ""); err != nil {
		// Если не удалось обновить БД, удаляем загруженный файл
		ic.yandexStorage.DeleteImage(ctx, cloudinaryID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка обновления базы данных: %v", err)})
		return
	}

	// Автоматически добавляем в библиотеку изображений (для загруженных изображений)
	ic.addUploadedImageToLibrary(entityType, entityID, cloudinaryID, imageURL, file.Filename, file.Size)

	c.JSON(http.StatusOK, ImageUploadResponse{
		Success:      true,
		ImageURL:     imageURL,
		CloudinaryID: cloudinaryID,
		Message:      "Изображение успешно загружено",
	})
}

// UploadCharacterAvatar stores a player-owned CharacterV3 token. Unlike the
// content image endpoint this route is available to every authenticated owner,
// but it never accepts an entity type from the client and always scopes the
// database update by both character and user id.
func (ic *ImageController) UploadCharacterAvatar(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id персонажа"})
		return
	}

	var character CharacterV3
	if err := characterV3OwnerScope(ic.db.Select("id", "user_id"), c, userID).
		Where("id = ?", characterID).First(&character).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка проверки персонажа"})
		}
		return
	}
	if ic.yandexStorage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "хранилище изображений не настроено"})
		return
	}

	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "файл изображения не найден"})
		return
	}
	if !isValidImageType(file.Header.Get("Content-Type")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неподдерживаемый тип файла"})
		return
	}

	ctx := c.Request.Context()
	imageURL, storageID, err := ic.yandexStorage.UploadImage(ctx, file, "character_tokens")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка загрузки изображения: %v", err)})
		return
	}
	result := characterV3OwnerScope(ic.db.Model(&CharacterV3{}), c, userID).
		Where("id = ?", characterID).
		Update("avatar_url", imageURL)
	if result.Error != nil || result.RowsAffected != 1 {
		_ = ic.yandexStorage.DeleteImage(ctx, storageID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось сохранить токен персонажа"})
		return
	}

	c.JSON(http.StatusOK, ImageUploadResponse{
		Success:      true,
		ImageURL:     imageURL,
		CloudinaryID: storageID,
		Message:      "Токен персонажа загружен",
	})
}

// GenerateImage генерирует изображение с помощью ИИ
func (ic *ImageController) GenerateImage(c *gin.Context) {
	var req ImageGenerationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат запроса"})
		return
	}

	ic.generateEntityImage(c, req, false)
}

// Legacy cards and current entity routes use the same persistence path. The
// adapter changes only the response DTO, not paid calls or storage semantics.
func (ic *ImageController) generateEntityImage(c *gin.Context, req ImageGenerationRequest, legacy bool) {
	folder, supported := map[string]string{"card": "cards", "monster": "monster_tokens", "spell": "spell_icons", "action": "action_icons", "effect": "effect_icons", "feat": "feat_icons"}[req.EntityType]
	if _, err := uuid.Parse(req.EntityID); err != nil || !supported {
		writeImageGenerationError(c, imagePipelineError("image_entity_invalid", "Сначала сохраните поддерживаемую сущность, затем генерируйте изображение.", "application", "not_started", http.StatusBadRequest, nil))
		return
	}
	if ic.useImageJob(c) {
		if c.Writer.Written() {
			return
		}
		kind := "entity"
		if legacy {
			kind = "card"
		}
		ic.enqueueImageJob(c, kind, req, func() (ImageJob, error) {
			info, err := ic.getEntityInfoContext(c.Request.Context(), req.EntityType, req.EntityID)
			if err != nil {
				return ImageJob{}, imagePipelineError("image_entity_not_found", "Сущность для изображения не найдена.", "application", "not_started", 404, err)
			}
			info = mergeEntityInfo(info, req.EntityData)
			prompt, size := ic.createImagePrompt(req.Prompt, req.Style, info)
			return ImageJob{EntityType: req.EntityType, EntityID: req.EntityID, Label: "Изображение сущности", Prompt: prompt, Size: size, Quality: normalizeImageQuality(req.Quality), Folder: folder}, nil
		})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), imageGenerationRequestBudget)
	defer cancel()
	// Always verify the existing entity, even when prompt data is supplied.
	entityInfo, err := ic.getEntityInfoContext(ctx, req.EntityType, req.EntityID)
	if err != nil {
		if ctx.Err() != nil {
			writeImageGenerationError(c, imagePipelineContextError(ctx.Err(), "not_started"))
			return
		}
		problem := imagePipelineError("image_entity_unavailable", "Не удалось проверить сущность. Генерация не запущена.", "persistence", "not_started", http.StatusServiceUnavailable, err)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			problem = imagePipelineError("image_entity_not_found", "Сущность не найдена. Генерация не запущена.", "application", "not_started", http.StatusNotFound, err)
		}
		writeImageGenerationError(c, problem)
		return
	}
	entityInfo = mergeEntityInfo(entityInfo, req.EntityData)
	prompt, imageSize := ic.createImagePrompt(req.Prompt, req.Style, entityInfo)
	result, err := ic.generation.Generate(ctx, generatedImageInput{Prompt: prompt, Quality: req.Quality, Size: imageSize, Folder: folder, RequestID: c.GetString(requestIDContextKey)}, func(ctx context.Context, image generatedImageResult) error {
		return ic.updateEntityImageContext(ctx, req.EntityType, req.EntityID, image.URL, image.StorageID, true, prompt)
	})
	if err != nil {
		writeImageGenerationError(c, err)
		return
	}
	ic.recordGeneratedEntity(ctx, c.GetString(requestIDContextKey), req.EntityType, req.EntityID, prompt, result, entityInfo)
	if legacy {
		c.JSON(http.StatusOK, gin.H{"image_url": result.URL, "message": "Изображение сгенерировано"})
		return
	}
	c.JSON(http.StatusOK, ImageGenerationResponse{
		Success: true, ImageURL: result.URL, CloudinaryID: result.StorageID, GenerationTime: result.GenerationTime,
		Message: "Изображение успешно сгенерировано",
	})
}

// StandaloneImageRequest — запрос на генерацию изображения без привязки к сущности
type StandaloneImageRequest struct {
	Subject string `json:"subject"` // Концепт/название заклинания
	Element string `json:"element"` // Тип энергии (fire/cold/...) для цвета
	Extra   string `json:"extra"`   // Доп. детали к промпту
	Prompt  string `json:"prompt"`  // Готовый промпт (перебивает остальное)
	Style   string `json:"style"`   // spell_icon (по умолчанию) / fantasy / game
	Quality string `json:"quality"` // low/medium/high
}

// StandaloneImageResponse — ответ standalone-генерации
type StandaloneImageResponse struct {
	Success        bool   `json:"success"`
	ImageURL       string `json:"image_url"`
	Prompt         string `json:"prompt"`
	GenerationTime int    `json:"generation_time_ms"`
}

// GenerateStandaloneImage генерирует изображение без привязки к карточке/заклинанию.
// Используется вкладкой «Генерация изображений» для подбора иконок заклинаний.
func (ic *ImageController) GenerateStandaloneImage(c *gin.Context) {
	var req StandaloneImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат запроса"})
		return
	}

	// Строим промпт
	var prompt string
	if strings.TrimSpace(req.Prompt) != "" {
		prompt = req.Prompt
	} else if req.Style == ImageStyleFantasy || req.Style == ImageStyleGame {
		prompt = GenerateImagePrompt(req.Subject, req.Extra, "", req.Style)
	} else {
		prompt = generateSpellIconPrompt(req.Subject, req.Element, req.Extra)
	}
	if ic.useImageJob(c) {
		if c.Writer.Written() {
			return
		}
		ic.enqueueImageJob(c, "standalone", req, func() (ImageJob, error) {
			return ImageJob{Label: "Изображение", Prompt: prompt, Size: "1024x1024", Quality: normalizeImageQuality(req.Quality), Folder: "spell_icons"}, nil
		})
		return
	}

	result, err := ic.generation.Generate(c.Request.Context(), generatedImageInput{Prompt: prompt, Quality: req.Quality, Size: "1024x1024", Folder: "spell_icons", RequestID: c.GetString(requestIDContextKey)}, nil)
	if err != nil {
		writeImageGenerationError(c, err)
		return
	}
	c.JSON(http.StatusOK, StandaloneImageResponse{
		Success: true, ImageURL: result.URL, Prompt: prompt, GenerationTime: result.GenerationTime,
	})
}

// DeleteImage удаляет изображение
func (ic *ImageController) DeleteImage(c *gin.Context) {
	entityType := c.Param("entity_type")
	entityID := c.Param("entity_id")

	// Получаем информацию об изображении
	cloudinaryID, err := ic.getEntityImageID(entityType, entityID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "изображение не найдено"})
		return
	}

	// Удаляем изображение из Yandex Cloud Storage
	ctx := context.Background()
	if err := ic.yandexStorage.DeleteImage(ctx, cloudinaryID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка удаления изображения: %v", err)})
		return
	}

	// Обновляем запись в базе данных
	if err := ic.updateEntityImage(entityType, entityID, "", "", false, ""); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка обновления базы данных: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Изображение успешно удалено",
	})
}

// SetupCORS настраивает CORS для бакета Yandex Cloud Storage
func (ic *ImageController) SetupCORS(c *gin.Context) {
	if ic.yandexStorage == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Yandex Storage недоступен"})
		return
	}

	ctx := context.Background()
	if err := ic.yandexStorage.SetupCORS(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка настройки CORS: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "CORS успешно настроен для бакета",
	})
}

// GetStatus возвращает статус Yandex Storage
func (ic *ImageController) GetStatus(c *gin.Context) {
	if ic.yandexStorage == nil {
		c.JSON(http.StatusOK, gin.H{
			"yandex_storage": "недоступен",
			"message":        "Yandex Storage не настроен. Проверьте переменные окружения.",
		})
		return
	}

	// Проверяем доступность бакета
	ctx := context.Background()
	_, err := ic.yandexStorage.s3Client.HeadBucketWithContext(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(ic.yandexStorage.bucket),
	})

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"yandex_storage": "ошибка подключения",
			"message":        fmt.Sprintf("Не удается подключиться к бакету: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"yandex_storage": "доступен",
		"bucket":         ic.yandexStorage.bucket,
		"region":         ic.yandexStorage.region,
		"message":        "Yandex Storage подключен успешно",
	})
}

// updateEntityImage обновляет информацию об изображении в базе данных
func (ic *ImageController) updateEntityImage(entityType, entityID, imageURL, cloudinaryID string, isGenerated bool, prompt string) error {
	return ic.updateEntityImageContext(context.Background(), entityType, entityID, imageURL, cloudinaryID, isGenerated, prompt)
}

func (ic *ImageController) imageDB(ctx context.Context) *gorm.DB {
	// Generated prompts are persisted metadata, not SQL log parameters.
	return ic.db.WithContext(ctx).Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
}

func (ic *ImageController) updateEntityImageContext(ctx context.Context, entityType, entityID, imageURL, storageID string, isGenerated bool, prompt string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	id, err := uuid.Parse(entityID)
	if err != nil {
		return err
	}
	if ic.db == nil {
		return fmt.Errorf("image persistence unavailable")
	}
	models := map[string]interface{}{"card": &Card{}, "monster": &Monster{}, "spell": &Spell{}, "action": &Action{}, "effect": &Effect{}, "feat": &Feat{}}
	model, supported := models[entityType]
	if !supported {
		return fmt.Errorf("unsupported image entity")
	}
	updates := map[string]interface{}{"image_url": imageURL, "image_cloudinary_url": imageURL, "image_cloudinary_id": storageID, "image_generated": isGenerated}
	if isGenerated {
		updates["image_generation_prompt"] = prompt
	}
	if entityType == "monster" {
		updates = map[string]interface{}{"token_url": imageURL, "token_storage_id": storageID}
	}
	result := ic.imageDB(ctx).Model(model).Where("id = ? AND deleted_at IS NULL", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("unexpected image update row count")
	}
	return nil
}

// getEntityImageID получает ID изображения сущности
func (ic *ImageController) getEntityImageID(entityType, entityID string) (string, error) {
	switch entityType {
	case "card":
		cardID, err := uuid.Parse(entityID)
		if err != nil {
			return "", fmt.Errorf("неверный ID карты: %v", err)
		}

		var card Card
		if err := ic.db.Where("id = ?", cardID).First(&card).Error; err != nil {
			return "", err
		}

		return card.ImageCloudinaryID, nil
	case "monster":
		monsterID, err := uuid.Parse(entityID)
		if err != nil {
			return "", fmt.Errorf("неверный ID монстра: %v", err)
		}
		var monster Monster
		if err := ic.db.Where("id = ?", monsterID).First(&monster).Error; err != nil {
			return "", err
		}
		return monster.TokenStorageID, nil

	default:
		return "", fmt.Errorf("неподдерживаемый тип сущности: %s", entityType)
	}
}

// getEntityInfo получает информацию о сущности для создания промпта
func (ic *ImageController) getEntityInfo(entityType, entityID string) (map[string]interface{}, error) {
	return ic.getEntityInfoContext(context.Background(), entityType, entityID)
}

func (ic *ImageController) getEntityInfoContext(ctx context.Context, entityType, entityID string) (map[string]interface{}, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if ic.db == nil {
		return nil, fmt.Errorf("image entity store unavailable")
	}
	db := ic.imageDB(ctx)
	switch entityType {
	case "card":
		cardID, err := uuid.Parse(entityID)
		if err != nil {
			return nil, fmt.Errorf("неверный ID карты: %v", err)
		}

		var card Card
		if err := db.Where("id = ? AND deleted_at IS NULL", cardID).First(&card).Error; err != nil {
			return nil, err
		}

		return cardToEntityInfo(card), nil
	case "monster":
		monsterID, err := uuid.Parse(entityID)
		if err != nil {
			return nil, fmt.Errorf("неверный ID монстра: %v", err)
		}
		var monster Monster
		if err := db.Where("id = ? AND deleted_at IS NULL", monsterID).First(&monster).Error; err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"name": monster.Name, "description": monster.Description,
			"type": monster.CreatureType, "rarity": "common",
		}, nil
	case "spell", "action", "effect", "feat":
		id, err := uuid.Parse(entityID)
		if err != nil {
			return nil, err
		}
		var info struct{ Name, Rarity string }
		if err := db.Table(entityType+"s").Select("name, rarity").Where("id = ? AND deleted_at IS NULL", id).Take(&info).Error; err != nil {
			return nil, err
		}
		return map[string]interface{}{"name": info.Name, "rarity": info.Rarity}, nil

	default:
		return nil, fmt.Errorf("неподдерживаемый тип сущности: %s", entityType)
	}
}

// createImagePrompt создаёт промпт для генерации изображения и возвращает
// его вместе с подобранным размером холста (size).
// Для ручного промпта размер не подбирается (пустая строка → квадрат по умолчанию).
func (ic *ImageController) createImagePrompt(userPrompt, style string, entityInfo map[string]interface{}) (string, string) {
	if userPrompt != "" {
		return userPrompt, ""
	}

	// Извлекаем данные о сущности
	var name, description, rarity, itemType, imagePromptExtra string

	if nameVal, ok := entityInfo["name"].(string); ok {
		name = nameVal
	}

	if descVal, ok := entityInfo["description"].(string); ok {
		description = descVal
	}

	if rarityVal, ok := entityInfo["rarity"].(string); ok {
		rarity = rarityVal
	}

	if typeVal, ok := entityInfo["type"].(string); ok {
		itemType = typeVal
	}

	if extraVal, ok := entityInfo["image_prompt_extra"].(string); ok {
		imagePromptExtra = extraVal
	}

	prompt := GenerateImagePrompt(name, description, rarity, style, ImagePromptOptions{
		ItemType:         itemType,
		ImagePromptExtra: imagePromptExtra,
	})
	size := GenerateImageSize(itemType, name, description)
	return prompt, size
}

// isValidImageType проверяет, является ли файл изображением
func isValidImageType(contentType string) bool {
	validTypes := []string{
		"image/jpeg",
		"image/jpg",
		"image/png",
		"image/gif",
		"image/webp",
	}

	for _, validType := range validTypes {
		if contentType == validType {
			return true
		}
	}

	return false
}

// Kept for existing callers/tests; the generator owns the bounded downloader.
func (ic *ImageController) downloadImage(ctx context.Context, source string) ([]byte, error) {
	return downloadGeneratedImage(ctx, source)
}

// The entity URL is already committed. Ancillary library/history metadata must
// not turn that known success into a failed generation or delete its image.
func (ic *ImageController) recordGeneratedEntity(ctx context.Context, requestID, entityType, entityID, prompt string, result generatedImageResult, info map[string]interface{}) {
	id, err := uuid.Parse(entityID)
	if err != nil {
		return
	}
	tags := extractLibraryTags(info)
	row := ImageGenerationLog{EntityType: entityType, EntityID: id, CloudinaryID: result.StorageID, CloudinaryURL: result.URL,
		GenerationPrompt: prompt, GenerationModel: result.Model, GenerationTimeMs: result.GenerationTime}
	image := ImageLibrary{CloudinaryID: result.StorageID, CloudinaryURL: result.URL, FileSize: &result.Bytes,
		CardName: tags.CardName, CardRarity: tags.CardRarity, ItemType: tags.ItemType, WeaponType: tags.WeaponType,
		ArmorType: tags.ArmorType, Slot: tags.Slot, GenerationPrompt: &prompt, GenerationModel: &result.Model, GenerationTimeMs: &result.GenerationTime}
	err = ic.imageDB(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "cloudinary_id"}}, DoNothing: true}).Create(&image).Error
	})
	if err != nil {
		log.Printf("[image] request_id=%s code=image_metadata_not_recorded source=persistence", requestID)
	}
}

// addUploadedImageToLibrary автоматически добавляет загруженное изображение в библиотеку
func (ic *ImageController) addUploadedImageToLibrary(entityType, entityID, cloudinaryID, imageURL, filename string, fileSize int64) {
	entityInfo, err := ic.getEntityInfo(entityType, entityID)
	if err != nil {
		log.Printf("Предупреждение: не удалось получить данные сущности для библиотеки: %v", err)
		entityInfo = map[string]interface{}{}
	}

	tags := extractLibraryTags(entityInfo)
	fileSizeInt := int(fileSize)
	image := ImageLibrary{
		CloudinaryID:     cloudinaryID,
		CloudinaryURL:    imageURL,
		OriginalName:     &filename,
		FileSize:         &fileSizeInt,
		CardName:         tags.CardName,
		CardRarity:       tags.CardRarity,
		ItemType:         tags.ItemType,
		WeaponType:       tags.WeaponType,
		ArmorType:        tags.ArmorType,
		Slot:             tags.Slot,
		GenerationPrompt: nil,
		GenerationModel:  nil,
		GenerationTimeMs: nil,
	}

	if upsertImageLibraryEntryToDB(ic.db, image) {
		log.Printf("Загруженное изображение %s автоматически добавлено в библиотеку с тегами: name=%s, rarity=%s",
			cloudinaryID,
			getStringValue(tags.CardName),
			getStringValue(tags.CardRarity))
	}
}

// getStringValue безопасно получает строку из указателя
func getStringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
