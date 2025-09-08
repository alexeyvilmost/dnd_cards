package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ImageController контроллер для работы с изображениями
type ImageController struct {
	db            *gorm.DB
	yandexStorage *YandexStorageService
	openAIService *OpenAIService
	imageLibrary  *ImageLibraryController
}

// NewImageController создает новый экземпляр контроллера
func NewImageController(db *gorm.DB, yandexStorage *YandexStorageService, openAIService *OpenAIService) *ImageController {
	return &ImageController{
		db:            db,
		yandexStorage: yandexStorage,
		openAIService: openAIService,
		imageLibrary:  NewImageLibraryController(db),
	}
}

// UploadImage загружает изображение для карты или шаблона оружия
func (ic *ImageController) UploadImage(c *gin.Context) {
	// Получаем параметры из формы
	entityType := c.PostForm("entity_type")
	entityID := c.PostForm("entity_id")

	if entityType == "" || entityID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "необходимо указать entity_type и entity_id"})
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

	// Определяем папку для загрузки
	folder := "cards"
	if entityType == "weapon_template" {
		folder = "weapon_templates"
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

// GenerateImage генерирует изображение с помощью ИИ
func (ic *ImageController) GenerateImage(c *gin.Context) {
	var req ImageGenerationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный формат запроса"})
		return
	}

	// Получаем информацию о сущности для создания промпта
	var entityInfo map[string]interface{}
	var err error

	// Если переданы данные сущности, используем их, иначе получаем из базы
	if req.EntityData != nil && len(req.EntityData) > 0 {
		entityInfo = req.EntityData
	} else {
		entityInfo, err = ic.getEntityInfo(req.EntityType, req.EntityID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "сущность не найдена"})
			return
		}
	}

	// Создаем промпт для генерации изображения
	prompt := ic.createImagePrompt(req.Prompt, entityInfo)

	// Генерируем изображение с помощью OpenAI
	log.Printf("Отправляем промпт в OpenAI DALL-E: %s", prompt)
	startTime := time.Now()
	generatedImageURL, err := ic.openAIService.GenerateImage(prompt)
	if err != nil {
		log.Printf("Ошибка генерации изображения: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка генерации изображения: %v", err)})
		return
	}
	log.Printf("Получен URL изображения от OpenAI: %s", generatedImageURL)
	generationTime := int(time.Since(startTime).Milliseconds())

	// Скачиваем сгенерированное изображение
	ctx := context.Background()
	imageData, err := ic.downloadImage(generatedImageURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка скачивания сгенерированного изображения: %v", err)})
		return
	}

	// Определяем папку для загрузки
	folder := "cards"
	if req.EntityType == "weapon_template" {
		folder = "weapon_templates"
	}

	// Загружаем сгенерированное изображение в Yandex Cloud Storage
	imageURL, cloudinaryID, err := ic.yandexStorage.UploadImageFromBytes(ctx, imageData, "generated.png", "image/png", folder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка загрузки сгенерированного изображения: %v", err)})
		return
	}

	// Обновляем запись в базе данных
	if err := ic.updateEntityImage(req.EntityType, req.EntityID, imageURL, cloudinaryID, true, prompt); err != nil {
		// Если не удалось обновить БД, удаляем загруженный файл
		ic.yandexStorage.DeleteImage(ctx, cloudinaryID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ошибка обновления базы данных: %v", err)})
		return
	}

	// Логируем генерацию изображения
	ic.logImageGeneration(req.EntityType, req.EntityID, cloudinaryID, imageURL, prompt, "openai-dall-e", generationTime)

	// Автоматически добавляем в библиотеку изображений
	ic.addToImageLibrary(req.EntityType, req.EntityID, cloudinaryID, imageURL, prompt, "openai-dall-e", generationTime)

	c.JSON(http.StatusOK, ImageGenerationResponse{
		Success:        true,
		ImageURL:       imageURL,
		CloudinaryID:   cloudinaryID,
		GenerationTime: generationTime,
		Message:        "Изображение успешно сгенерировано",
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
	switch entityType {
	case "card":
		cardID, err := uuid.Parse(entityID)
		if err != nil {
			return fmt.Errorf("неверный ID карты: %v", err)
		}

		updates := map[string]interface{}{
			"image_url":           imageURL,
			"image_cloudinary_id": cloudinaryID,
			"image_generated":     isGenerated,
		}

		if isGenerated {
			updates["image_generation_prompt"] = prompt
		}

		return ic.db.Model(&Card{}).Where("id = ?", cardID).Updates(updates).Error

	default:
		return fmt.Errorf("неподдерживаемый тип сущности: %s", entityType)
	}
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

	default:
		return "", fmt.Errorf("неподдерживаемый тип сущности: %s", entityType)
	}
}

// getEntityInfo получает информацию о сущности для создания промпта
func (ic *ImageController) getEntityInfo(entityType, entityID string) (map[string]interface{}, error) {
	switch entityType {
	case "card":
		cardID, err := uuid.Parse(entityID)
		if err != nil {
			return nil, fmt.Errorf("неверный ID карты: %v", err)
		}

		var card Card
		if err := ic.db.Where("id = ?", cardID).First(&card).Error; err != nil {
			return nil, err
		}

		return map[string]interface{}{
			"name":        card.Name,
			"description": card.Description,
			"rarity":      string(card.Rarity),
			"properties":  card.Properties,
		}, nil

	default:
		return nil, fmt.Errorf("неподдерживаемый тип сущности: %s", entityType)
	}
}

// createImagePrompt создает промпт для генерации изображения
func (ic *ImageController) createImagePrompt(userPrompt string, entityInfo map[string]interface{}) string {
	if userPrompt != "" {
		return userPrompt
	}

	// Извлекаем данные о сущности
	var name, description, rarity string

	if nameVal, ok := entityInfo["name"].(string); ok {
		name = nameVal
	}

	if descVal, ok := entityInfo["description"].(string); ok {
		description = descVal
	}

	if rarityVal, ok := entityInfo["rarity"].(string); ok {
		rarity = rarityVal
	}

	// Используем новую функцию генерации промпта
	prompt := GenerateImagePrompt(name, description, rarity)
	log.Printf("Сгенерированный промпт: %s", prompt)
	return prompt
}

// logImageGeneration логирует генерацию изображения
func (ic *ImageController) logImageGeneration(entityType, entityID, cloudinaryID, imageURL, prompt, model string, generationTime int) {
	entityUUID, _ := uuid.Parse(entityID)

	log := ImageGenerationLog{
		EntityType:       entityType,
		EntityID:         entityUUID,
		CloudinaryID:     cloudinaryID,
		CloudinaryURL:    imageURL,
		GenerationPrompt: prompt,
		GenerationModel:  model,
		GenerationTimeMs: generationTime,
	}

	ic.db.Create(&log)
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

// downloadImage скачивает изображение по URL или обрабатывает data URL
func (ic *ImageController) downloadImage(url string) ([]byte, error) {
	// Проверяем, является ли это data URL
	if strings.HasPrefix(url, "data:image/") {
		// Извлекаем base64 данные из data URL
		parts := strings.Split(url, ",")
		if len(parts) != 2 {
			return nil, fmt.Errorf("неверный формат data URL")
		}

		// Декодируем base64
		data, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, fmt.Errorf("ошибка декодирования base64: %v", err)
		}

		return data, nil
	}

	// Обычный HTTP URL
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("ошибка скачивания изображения: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ошибка HTTP: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("ошибка чтения данных изображения: %v", err)
	}

	return data, nil
}

// addToImageLibrary автоматически добавляет изображение в библиотеку
func (ic *ImageController) addToImageLibrary(entityType, entityID, cloudinaryID, imageURL, prompt, model string, generationTime int) {
	// Получаем информацию о сущности для тегов
	entityInfo, err := ic.getEntityInfo(entityType, entityID)
	if err != nil {
		log.Printf("Ошибка получения информации о сущности для библиотеки: %v", err)
		return
	}

	// Извлекаем данные для тегов
	var cardName, cardRarity *string
	if nameVal, ok := entityInfo["name"].(string); ok && nameVal != "" {
		cardName = &nameVal
	}
	if rarityVal, ok := entityInfo["rarity"].(string); ok && rarityVal != "" {
		cardRarity = &rarityVal
	}

	// Создаем запись для библиотеки
	image := ImageLibrary{
		CloudinaryID:     cloudinaryID,
		CloudinaryURL:    imageURL,
		OriginalName:     nil, // Для сгенерированных изображений
		FileSize:         nil, // Размер файла не известен
		CardName:         cardName,
		CardRarity:       cardRarity,
		GenerationPrompt: &prompt,
		GenerationModel:  &model,
		GenerationTimeMs: &generationTime,
	}

	// Проверяем, не существует ли уже такое изображение
	var existing ImageLibrary
	if err := ic.db.Where("cloudinary_id = ?", cloudinaryID).First(&existing).Error; err == nil {
		log.Printf("Изображение %s уже существует в библиотеке", cloudinaryID)
		return
	}

	// Добавляем в библиотеку
	if err := ic.db.Create(&image).Error; err != nil {
		log.Printf("Ошибка добавления изображения в библиотеку: %v", err)
		return
	}

	log.Printf("Изображение %s автоматически добавлено в библиотеку с тегами: name=%s, rarity=%s",
		cloudinaryID,
		getStringValue(cardName),
		getStringValue(cardRarity))
}

// addUploadedImageToLibrary автоматически добавляет загруженное изображение в библиотеку
func (ic *ImageController) addUploadedImageToLibrary(entityType, entityID, cloudinaryID, imageURL, filename string, fileSize int64) {
	// Получаем информацию о сущности для тегов
	entityInfo, err := ic.getEntityInfo(entityType, entityID)
	if err != nil {
		log.Printf("Ошибка получения информации о сущности для библиотеки: %v", err)
		return
	}

	// Извлекаем данные для тегов
	var cardName, cardRarity *string
	if nameVal, ok := entityInfo["name"].(string); ok && nameVal != "" {
		cardName = &nameVal
	}
	if rarityVal, ok := entityInfo["rarity"].(string); ok && rarityVal != "" {
		cardRarity = &rarityVal
	}

	// Создаем запись для библиотеки
	fileSizeInt := int(fileSize)
	image := ImageLibrary{
		CloudinaryID:     cloudinaryID,
		CloudinaryURL:    imageURL,
		OriginalName:     &filename,
		FileSize:         &fileSizeInt,
		CardName:         cardName,
		CardRarity:       cardRarity,
		GenerationPrompt: nil, // Для загруженных изображений
		GenerationModel:  nil, // Для загруженных изображений
		GenerationTimeMs: nil, // Для загруженных изображений
	}

	// Проверяем, не существует ли уже такое изображение
	var existing ImageLibrary
	if err := ic.db.Where("cloudinary_id = ?", cloudinaryID).First(&existing).Error; err == nil {
		log.Printf("Изображение %s уже существует в библиотеке", cloudinaryID)
		return
	}

	// Добавляем в библиотеку
	if err := ic.db.Create(&image).Error; err != nil {
		log.Printf("Ошибка добавления загруженного изображения в библиотеку: %v", err)
		return
	}

	log.Printf("Загруженное изображение %s автоматически добавлено в библиотеку с тегами: name=%s, rarity=%s",
		cloudinaryID,
		getStringValue(cardName),
		getStringValue(cardRarity))
}

// getStringValue безопасно получает строку из указателя
func getStringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
