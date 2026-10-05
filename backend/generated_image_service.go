package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
)

const generatedImageModel = "gpt-image-1"
const maxGeneratedImageBytes = 32 << 20
const generatedImageCleanupBudget = 5 * time.Second

type generatedImageProvider interface {
	GenerateImageContext(context.Context, string, string, string) (string, error)
}

type generatedImageStorage interface {
	PreflightImageGeneration(context.Context) error
	UploadImageFromBytes(context.Context, []byte, string, string, string) (string, string, error)
	DeleteImage(context.Context, string) error
}

type generatedImageResult struct {
	URL, StorageID, Model string
	GenerationTime, Bytes int
}

type generatedImageInput struct {
	Prompt, Quality, Size, Folder, RequestID string
}

// All paid routes share one provider -> storage -> optional entity writer.
// The provider is invoked at most once. An uncertain database result retains
// the new blob: deleting it could break a write that committed before timeout.
type generatedImageService struct {
	provider generatedImageProvider
	storage  generatedImageStorage
	download func(context.Context, string) ([]byte, error)
}

func newGeneratedImageService(provider *OpenAIService, storage *YandexStorageService) *generatedImageService {
	service := &generatedImageService{download: downloadGeneratedImage}
	if provider != nil {
		service.provider = provider
	}
	if storage != nil {
		service.storage = storage
	}
	return service
}

func imagePipelineError(code, message, source, outcome string, status int, cause error) *ImageGenerationError {
	return &ImageGenerationError{Code: code, Message: message, Source: source, Outcome: outcome, Status: status, cause: cause}
}

func imagePipelineContextError(err error, outcome string) *ImageGenerationError {
	problem := classifyImageProviderError(err, imageProviderMetadata{})
	problem.Outcome = outcome
	return problem
}

func (service *generatedImageService) Generate(parent context.Context, input generatedImageInput, persist func(context.Context, generatedImageResult) error) (generatedImageResult, error) {
	var result generatedImageResult
	ctx, cancel := context.WithTimeout(parent, imageGenerationRequestBudget)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return result, imagePipelineContextError(err, "not_started")
	}
	if service == nil || service.storage == nil {
		return result, imagePipelineError("image_storage_not_configured", "Хранилище изображений не настроено. Генерация не запущена.", "storage", "not_started", http.StatusServiceUnavailable, nil)
	}
	// Local configuration validation only: HeadBucket would introduce a new
	// ListBucket permission for existing keys that can already Put/DeleteObject.
	if err := service.storage.PreflightImageGeneration(ctx); err != nil {
		if ctx.Err() != nil {
			return result, imagePipelineContextError(ctx.Err(), "not_started")
		}
		return result, imagePipelineError("image_storage_not_configured", "Хранилище изображений не настроено. Генерация не запущена.", "storage", "not_started", http.StatusServiceUnavailable, err)
	}
	if err := ctx.Err(); err != nil {
		return result, imagePipelineContextError(err, "not_started")
	}
	if service.provider == nil {
		return result, imagePipelineError("image_provider_not_configured", "Сервис генерации не настроен.", "application", "not_started", http.StatusServiceUnavailable, nil)
	}
	started := time.Now()
	source, err := service.provider.GenerateImageContext(ctx, input.Prompt, input.Quality, input.Size)
	if err != nil {
		return result, err
	}
	result.Model, result.GenerationTime = generatedImageModel, int(time.Since(started).Milliseconds())
	if err := ctx.Err(); err != nil {
		return result, imagePipelineContextError(err, "not_saved")
	}
	download := service.download
	if download == nil {
		download = downloadGeneratedImage
	}
	data, err := download(ctx, source)
	if err != nil {
		if ctx.Err() != nil {
			return result, imagePipelineContextError(ctx.Err(), "not_saved")
		}
		return result, imagePipelineError("image_download_failed", "Изображение создано, но не удалось получить его для сохранения. Повторная генерация оплачивается отдельно.", "storage", "not_saved", http.StatusBadGateway, err)
	}
	contentType := http.DetectContentType(data)
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}[contentType]
	if len(data) == 0 || len(data) > maxGeneratedImageBytes || ext == "" {
		return result, imagePipelineError("image_download_failed", "Сервис генерации вернул некорректное изображение для сохранения.", "storage", "not_saved", http.StatusBadGateway, nil)
	}
	if err := ctx.Err(); err != nil {
		return result, imagePipelineContextError(err, "not_saved")
	}
	result.Bytes = len(data)
	result.URL, result.StorageID, err = service.storage.UploadImageFromBytes(ctx, data, "generated"+ext, contentType, input.Folder)
	if err != nil {
		// No entity write has started. A returned ID identifies only this newly
		// allocated object; old images are never cleanup candidates.
		service.cleanup(result.StorageID, input.RequestID)
		if ctx.Err() != nil {
			return result, imagePipelineContextError(ctx.Err(), "not_saved")
		}
		return result, imagePipelineError("image_storage_failed", "Изображение создано, но не сохранено в хранилище. Повторная генерация оплачивается отдельно.", "storage", "not_saved", http.StatusBadGateway, err)
	}
	if !permanentGeneratedImageURL(result.URL) || result.StorageID == "" {
		service.cleanup(result.StorageID, input.RequestID)
		return result, imagePipelineError("image_storage_failed", "Хранилище не подтвердило постоянную ссылку на изображение.", "storage", "not_saved", http.StatusBadGateway, nil)
	}
	if err := ctx.Err(); err != nil {
		service.cleanup(result.StorageID, input.RequestID)
		return result, imagePipelineContextError(err, "not_saved")
	}
	if persist != nil {
		if err := persist(ctx, result); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				service.cleanup(result.StorageID, input.RequestID)
				return result, imagePipelineError("image_entity_not_found", "Сущность уже недоступна. Изображение не привязано.", "persistence", "not_saved", http.StatusNotFound, err)
			}
			// Cancellation, timeout or transport errors after UPDATE may follow
			// a commit. Keep the blob and tell the caller to inspect saved state.
			return result, imagePipelineError("image_persistence_unknown", "Не удалось подтвердить сохранение изображения. Обновите сущность и проверьте результат перед повтором.", "persistence", "unknown", http.StatusServiceUnavailable, err)
		}
	}
	log.Printf("[image] request_id=%s model=%s image_bytes=%d generation_ms=%d total_ms=%d", input.RequestID, result.Model, result.Bytes, result.GenerationTime, time.Since(started).Milliseconds())
	return result, nil
}

func (service *generatedImageService) cleanup(id, requestID string) {
	if id == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), generatedImageCleanupBudget)
	defer cancel()
	if err := service.storage.DeleteImage(ctx, id); err != nil {
		log.Printf("[image] request_id=%s code=image_cleanup_failed source=storage", requestID)
	}
}

func permanentGeneratedImageURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "" && parsed.User == nil
}

func downloadGeneratedImage(ctx context.Context, source string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.HasPrefix(source, "data:image/") {
		metadata, encoded, ok := strings.Cut(source, ",")
		if !ok || !strings.HasSuffix(metadata, ";base64") || len(encoded) > base64.StdEncoding.EncodedLen(maxGeneratedImageBytes) {
			return nil, fmt.Errorf("invalid generated image encoding or size")
		}
		return base64.StdEncoding.DecodeString(encoded)
	}
	return nil, fmt.Errorf("generated image must be an inline base64 image")
}
