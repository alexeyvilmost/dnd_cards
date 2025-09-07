package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
)

// YandexStorageService сервис для работы с Yandex Cloud Object Storage
type YandexStorageService struct {
	s3Client *s3.S3
	bucket   string
	region   string
}

// NewYandexStorageService создает новый экземпляр сервиса
func NewYandexStorageService() (*YandexStorageService, error) {
	accessKeyID := os.Getenv("YANDEX_CLOUD_ACCESS_KEY_ID")
	secretAccessKey := os.Getenv("YANDEX_CLOUD_SECRET_ACCESS_KEY")
	bucketName := os.Getenv("YANDEX_CLOUD_BUCKET_NAME")
	region := os.Getenv("YANDEX_CLOUD_REGION")
	endpoint := os.Getenv("YANDEX_CLOUD_ENDPOINT")

	if accessKeyID == "" || secretAccessKey == "" || bucketName == "" {
		return nil, fmt.Errorf("необходимо указать переменные окружения для Yandex Cloud")
	}

	if region == "" {
		region = "ru-central1"
	}

	if endpoint == "" {
		endpoint = "https://storage.yandexcloud.net"
	}

	// Создаем конфигурацию для Yandex Cloud
	config := &aws.Config{
		Region:           aws.String(region),
		Endpoint:         aws.String(endpoint),
		Credentials:      credentials.NewStaticCredentials(accessKeyID, secretAccessKey, ""),
		S3ForcePathStyle: aws.Bool(true),
	}

	sess, err := session.NewSession(config)
	if err != nil {
		return nil, fmt.Errorf("ошибка создания сессии: %v", err)
	}

	s3Client := s3.New(sess)

	return &YandexStorageService{
		s3Client: s3Client,
		bucket:   bucketName,
		region:   region,
	}, nil
}

// UploadImage загружает изображение в Yandex Cloud Storage
func (s *YandexStorageService) UploadImage(ctx context.Context, file *multipart.FileHeader, folder string) (string, string, error) {
	// Открываем файл
	src, err := file.Open()
	if err != nil {
		return "", "", fmt.Errorf("ошибка открытия файла: %v", err)
	}
	defer src.Close()

	// Читаем содержимое файла
	buf := bytes.NewBuffer(nil)
	if _, err := io.Copy(buf, src); err != nil {
		return "", "", fmt.Errorf("ошибка чтения файла: %v", err)
	}

	// Генерируем уникальное имя файла
	ext := filepath.Ext(file.Filename)
	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("%s/%d_%s%s", folder, timestamp, generateRandomString(8), ext)

	// Загружаем файл в Yandex Cloud Storage
	_, err = s.s3Client.PutObjectWithContext(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(filename),
		Body:        bytes.NewReader(buf.Bytes()),
		ContentType: aws.String(file.Header.Get("Content-Type")),
		ACL:         aws.String("public-read"),
	})

	if err != nil {
		return "", "", fmt.Errorf("ошибка загрузки файла: %v", err)
	}

	// Формируем URL для доступа к файлу
	url := fmt.Sprintf("https://%s.storage.yandexcloud.net/%s", s.bucket, filename)
	cloudinaryID := filename

	return url, cloudinaryID, nil
}

// UploadImageFromBytes загружает изображение из байтов
func (s *YandexStorageService) UploadImageFromBytes(ctx context.Context, data []byte, filename, contentType, folder string) (string, string, error) {
	// Генерируем уникальное имя файла
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".png"
	}
	timestamp := time.Now().Unix()
	uniqueFilename := fmt.Sprintf("%s/%d_%s%s", folder, timestamp, generateRandomString(8), ext)

	// Загружаем файл в Yandex Cloud Storage
	_, err := s.s3Client.PutObjectWithContext(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(uniqueFilename),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
		ACL:         aws.String("public-read"),
	})

	if err != nil {
		return "", "", fmt.Errorf("ошибка загрузки файла: %v", err)
	}

	// Формируем URL для доступа к файлу
	url := fmt.Sprintf("https://%s.storage.yandexcloud.net/%s", s.bucket, uniqueFilename)
	cloudinaryID := uniqueFilename

	return url, cloudinaryID, nil
}

// DeleteImage удаляет изображение из Yandex Cloud Storage
func (s *YandexStorageService) DeleteImage(ctx context.Context, cloudinaryID string) error {
	_, err := s.s3Client.DeleteObjectWithContext(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(cloudinaryID),
	})

	if err != nil {
		return fmt.Errorf("ошибка удаления файла: %v", err)
	}

	return nil
}

// GetImageURL возвращает URL изображения
func (s *YandexStorageService) GetImageURL(cloudinaryID string) string {
	if cloudinaryID == "" {
		return ""
	}
	return fmt.Sprintf("https://storage.yandexcloud.net/%s/cards/%s", s.bucket, cloudinaryID)
}

// SetupCORS настраивает CORS для бакета
func (s *YandexStorageService) SetupCORS(ctx context.Context) error {
	corsConfig := &s3.CORSConfiguration{
		CORSRules: []*s3.CORSRule{
			{
				AllowedOrigins: []*string{aws.String("*")},
				AllowedMethods: []*string{
					aws.String("GET"),
					aws.String("POST"),
					aws.String("PUT"),
					aws.String("DELETE"),
					aws.String("HEAD"),
				},
				AllowedHeaders: []*string{aws.String("*")},
				ExposeHeaders:  []*string{aws.String("ETag")},
				MaxAgeSeconds:  aws.Int64(3000),
			},
		},
	}

	_, err := s.s3Client.PutBucketCorsWithContext(ctx, &s3.PutBucketCorsInput{
		Bucket:            aws.String(s.bucket),
		CORSConfiguration: corsConfig,
	})

	if err != nil {
		return fmt.Errorf("ошибка настройки CORS: %v", err)
	}

	return nil
}

// generateRandomString генерирует случайную строку
func generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
	}
	return string(b)
}

// ImageUploadRequest структура для запроса загрузки изображения
type ImageUploadRequest struct {
	EntityType string `json:"entity_type" binding:"required"` // "card" или "weapon_template"
	EntityID   string `json:"entity_id" binding:"required"`   // ID карты или шаблона оружия
}

// ImageUploadResponse структура для ответа загрузки изображения
type ImageUploadResponse struct {
	Success      bool   `json:"success"`
	ImageURL     string `json:"image_url"`
	CloudinaryID string `json:"cloudinary_id"`
	Message      string `json:"message"`
}

// ImageGenerationRequest структура для запроса генерации изображения
type ImageGenerationRequest struct {
	EntityType string                 `json:"entity_type" binding:"required"` // "card" или "weapon_template"
	EntityID   string                 `json:"entity_id" binding:"required"`   // ID карты или шаблона оружия
	Prompt     string                 `json:"prompt"`                         // Промпт для генерации (опционально)
	EntityData map[string]interface{} `json:"entity_data"`                    // Данные сущности (название, описание, редкость)
}

// ImageGenerationResponse структура для ответа генерации изображения
type ImageGenerationResponse struct {
	Success        bool   `json:"success"`
	ImageURL       string `json:"image_url"`
	CloudinaryID   string `json:"cloudinary_id"`
	GenerationTime int    `json:"generation_time_ms"`
	Message        string `json:"message"`
}
