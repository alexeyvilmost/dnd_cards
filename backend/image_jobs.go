package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// Running jobs are never reclaimed for another paid attempt. A lost lease is
// an unknown outcome, even if the process died just before sending the POST.
type ImageJob struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	OwnerID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"-"`
	Fingerprint string     `gorm:"not null" json:"-"`
	Kind        string     `gorm:"not null" json:"-"`
	State       string     `gorm:"not null;index" json:"state"`
	Label       string     `json:"label"`
	EntityType  string     `json:"-"`
	EntityID    string     `json:"-"`
	Prompt      string     `json:"-"`
	Quality     string     `json:"-"`
	Size        string     `json:"-"`
	Folder      string     `json:"-"`
	Result      JSONMap    `gorm:"type:jsonb" json:"result,omitempty"`
	Problem     JSONMap    `gorm:"type:jsonb" json:"problem,omitempty"`
	LeaseUntil  *time.Time `json:"-"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func imageJobsEnabled() bool { return os.Getenv("IMAGE_JOBS_ENABLED") == "1" }

// Disabling the writer must not turn a retry of an existing queued/paid job
// into a new synchronous paid request. Unknown database state fails closed.
func (ic *ImageController) useImageJob(c *gin.Context) bool {
	return imageJobsEnabled() || c.GetBool("image_job_protocol") || c.GetHeader("Idempotency-Key") != ""
}
func imageJobHandler(handler gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) { c.Set("image_job_protocol", true); handler(c) }
}
func (ic *ImageController) GetImageJobCapability(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.JSON(200, gin.H{"protocol_version": 1, "enabled": imageJobsEnabled()})
}
func imageJobLimit(name string, fallback, maximum int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil || value < 1 || value > maximum {
		return fallback
	}
	return value
}
func imageJobLock(tx *gorm.DB) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(1464682601)").Error
}
func imageJobProblem(code, message, outcome string) JSONMap {
	return JSONMap{"code": code, "error": message, "source": "application", "outcome": outcome}
}

func (ic *ImageController) enqueueImageJob(c *gin.Context, kind string, request any, prepare func() (ImageJob, error)) {
	owner, err := GetCurrentUserID(c)
	if err != nil || owner == uuid.Nil {
		c.JSON(401, gin.H{"error": "Требуется авторизация"})
		return
	}
	id, err := uuid.Parse(c.GetHeader("Idempotency-Key"))
	if err != nil || id == uuid.Nil {
		c.JSON(400, gin.H{"error": "Для фоновой генерации требуется устойчивый ключ запроса", "code": "image_job_key_required"})
		return
	}
	raw, err := json.Marshal(request)
	if err != nil || len(raw) > 64<<10 {
		c.JSON(400, gin.H{"error": "Слишком большой запрос генерации"})
		return
	}
	digest := sha256.Sum256(append([]byte(kind+":"), raw...))
	fingerprint := hex.EncodeToString(digest[:])
	var job ImageJob
	err = ic.db.WithContext(c.Request.Context()).Session(&gorm.Session{Logger: ic.db.Logger.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		if err := imageJobLock(tx); err != nil {
			return err
		}
		found := tx.Where("id = ?", id).First(&job).Error
		if found == nil {
			if job.OwnerID != owner || job.Fingerprint != fingerprint {
				return imagePipelineError("image_job_conflict", "Этот запрос уже использован для другой генерации.", "application", "not_started", 409, nil)
			}
			return nil
		}
		if !errors.Is(found, gorm.ErrRecordNotFound) {
			return found
		}
		if !imageJobsEnabled() {
			return imagePipelineError("image_jobs_disabled", "Новые фоновые задания временно выключены. Сохранённые задания доступны в истории.", "application", "not_started", 503, nil)
		}
		var daily, pending int64
		if err := tx.Model(&ImageJob{}).Where("created_at > NOW() - INTERVAL '24 hours'").Count(&daily).Error; err != nil {
			return err
		}
		if err := tx.Model(&ImageJob{}).Where("owner_id=? AND state IN ?", owner, []string{"queued", "running"}).Count(&pending).Error; err != nil {
			return err
		}
		if daily >= int64(imageJobLimit("IMAGE_JOBS_MAX_DAILY_ATTEMPTS", 20, 1000)) || pending >= int64(imageJobLimit("IMAGE_JOBS_MAX_PENDING_PER_USER", 3, 20)) {
			return imagePipelineError("image_job_limit", "Лимит заданий генерации исчерпан. Попробуйте позже.", "application", "not_started", 429, nil)
		}
		job, err = prepare()
		if err != nil {
			return err
		}
		if len(strings.TrimSpace(job.Prompt)) == 0 || len(job.Prompt) > 32<<10 {
			return imagePipelineError("image_prompt_invalid", "Заполните описание изображения длиной до 32 КБ.", "application", "not_started", 400, nil)
		}
		if ic.generation == nil || ic.generation.provider == nil || ic.generation.storage == nil {
			return imagePipelineError("image_provider_not_configured", "Генерация или хранилище не настроены.", "application", "not_started", 503, nil)
		}
		if err := ic.generation.storage.PreflightImageGeneration(c.Request.Context()); err != nil {
			return imagePipelineError("image_storage_not_configured", "Хранилище не настроено.", "storage", "not_started", 503, err)
		}
		job.ID, job.OwnerID, job.Fingerprint, job.Kind, job.State = id, owner, fingerprint, kind, "queued"
		return tx.Create(&job).Error
	})
	if err != nil {
		var known *ImageGenerationError
		if !errors.As(err, &known) {
			err = imagePipelineError("image_job_save_unknown", "Не удалось подтвердить сохранение задания. Повторите тот же запрос, чтобы проверить его статус.", "persistence", "unknown", 503, err)
		}
		writeImageGenerationError(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusAccepted, gin.H{"job": job})
}

func (ic *ImageController) GetImageJob(c *gin.Context) {
	owner, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(401, gin.H{"error": "Требуется авторизация"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(404, gin.H{"error": "Задание не найдено"})
		return
	}
	var job ImageJob
	if err := expireImageJobs(ic.db.WithContext(c.Request.Context()).Where("owner_id=?", owner)); err != nil {
		c.JSON(503, gin.H{"error": "Статус задания недоступен"})
		return
	}
	if err := ic.db.WithContext(c.Request.Context()).Where("id=? AND owner_id=?", id, owner).First(&job).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "Задание не найдено"})
		} else {
			c.JSON(503, gin.H{"error": "Статус задания недоступен"})
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(200, gin.H{"job": job})
}
func (ic *ImageController) ListImageJobs(c *gin.Context) {
	owner, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(401, gin.H{"error": "Требуется авторизация"})
		return
	}
	var jobs []ImageJob
	page, parseErr := strconv.Atoi(c.DefaultQuery("page", "1"))
	if parseErr != nil || page < 1 || page > 100000 {
		c.JSON(400, gin.H{"error": "Некорректная страница истории"})
		return
	}
	if err := expireImageJobs(ic.db.WithContext(c.Request.Context()).Where("owner_id=?", owner)); err != nil {
		c.JSON(503, gin.H{"error": "История генерации недоступна"})
		return
	}
	if err := ic.db.WithContext(c.Request.Context()).Where("owner_id=?", owner).Order("created_at DESC,id DESC").Offset((page - 1) * 20).Limit(21).Find(&jobs).Error; err != nil {
		c.JSON(503, gin.H{"error": "История генерации недоступна"})
		return
	}
	c.Header("Cache-Control", "private, no-store")
	hasMore := len(jobs) > 20
	if hasMore {
		jobs = jobs[:20]
	}
	c.JSON(200, gin.H{"enabled": imageJobsEnabled(), "jobs": jobs, "page": page, "has_more": hasMore})
}

func expireImageJobs(query *gorm.DB) error {
	expired := imageJobProblem("image_job_interrupted", "Связь с исполнителем прервалась. Результат неизвестен; автоматический повтор остановлен.", "unknown")
	return query.Model(&ImageJob{}).Where("state='running' AND lease_until < NOW()").Updates(map[string]any{"state": "unknown", "problem": expired, "updated_at": time.Now()}).Error
}
func (ic *ImageController) claimImageJob(ctx context.Context) (*ImageJob, error) {
	var job ImageJob
	err := ic.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := imageJobLock(tx); err != nil {
			return err
		}
		if err := expireImageJobs(tx); err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&ImageJob{}).Where("state='running'").Count(&active).Error; err != nil {
			return err
		}
		if !imageJobsEnabled() || active >= int64(imageJobLimit("IMAGE_JOBS_MAX_CONCURRENCY", 1, 4)) {
			return nil
		}
		if err := tx.Where("state='queued'").Order("created_at ASC,id ASC").Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).First(&job).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		until := time.Now().Add(5 * time.Minute)
		job.State, job.LeaseUntil = "running", &until
		return tx.Model(&job).Updates(map[string]any{"state": job.State, "lease_until": until}).Error
	})
	if job.ID == uuid.Nil {
		return nil, err
	}
	return &job, err
}

func (ic *ImageController) processImageJob(ctx context.Context, job ImageJob) {
	if job.LeaseUntil == nil {
		return
	}
	ctx, cancel := context.WithDeadline(ctx, *job.LeaseUntil)
	defer cancel()
	// Authorization is rechecked after queueing: a revoked/deleted administrator
	// cannot cause a later paid call from a stale queued request.
	var user User
	err := ic.db.WithContext(ctx).Select("id,is_admin").Where("id=?", job.OwnerID).First(&user).Error
	allowed, _ := parseContentAdminUserIDs(os.Getenv("CONTENT_ADMIN_USER_IDS"))
	_, listed := allowed[job.OwnerID]
	if err != nil || (!user.IsAdmin && !listed) {
		ic.failImageJob(job, imagePipelineError("image_job_access_revoked", "Права на генерацию изменились. Задание остановлено.", "application", "not_started", 403, err))
		return
	}
	// Revalidate entity existence before paying, then update it only together
	// with the durable success result after storage has confirmed the image.
	if job.EntityType != "" {
		if _, err := ic.getEntityInfoContext(ctx, job.EntityType, job.EntityID); err != nil {
			ic.failImageJob(job, imagePipelineError("image_entity_not_found", "Сущность для изображения больше недоступна.", "application", "not_started", 404, err))
			return
		}
	}
	result, err := ic.generation.Generate(ctx, generatedImageInput{Prompt: job.Prompt, Quality: job.Quality, Size: job.Size, Folder: job.Folder, RequestID: job.ID.String()}, func(ctx context.Context, result generatedImageResult) error {
		return ic.db.WithContext(ctx).Session(&gorm.Session{Logger: ic.db.Logger.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
			var current ImageJob
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND state='running' AND lease_until > NOW()", job.ID).First(&current).Error; err != nil {
				return fmt.Errorf("image job lease lost: %w", err)
			}
			response := JSONMap{"success": true, "image_url": result.URL, "cloudinary_id": result.StorageID, "generation_time_ms": result.GenerationTime, "message": "Изображение сохранено"}
			if job.Kind == "standalone" {
				response["prompt"] = job.Prompt
			}
			if job.EntityType != "" {
				controller := *ic
				controller.db = tx
				if err := controller.updateEntityImageContext(ctx, job.EntityType, job.EntityID, result.URL, result.StorageID, true, job.Prompt); err != nil {
					return err
				}
			}
			return tx.Model(&current).Updates(map[string]any{"state": "succeeded", "result": response, "lease_until": nil}).Error
		})
	})
	if err != nil {
		ic.failImageJob(job, err)
		return
	}
	if job.EntityType != "" {
		if info, err := ic.getEntityInfoContext(ctx, job.EntityType, job.EntityID); err == nil {
			ic.recordGeneratedEntity(ctx, job.ID.String(), job.EntityType, job.EntityID, job.Prompt, result, info)
		}
	}
}
func (ic *ImageController) failImageJob(job ImageJob, err error) {
	problem := classifyImageProviderError(err, imageProviderMetadata{})
	state := "failed"
	if problem.Outcome == "unknown" {
		state = "unknown"
	}
	raw, _ := json.Marshal(problem)
	var safe JSONMap
	_ = json.Unmarshal(raw, &safe)
	// If the success transaction committed but its acknowledgement was lost,
	// this condition preserves the committed result instead of overwriting it.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = ic.db.WithContext(ctx).Model(&ImageJob{}).Where("id=? AND state='running'", job.ID).Updates(map[string]any{"state": state, "problem": safe, "lease_until": nil}).Error
}

func (ic *ImageController) runImageJobs(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !imageJobsEnabled() {
				continue
			}
			job, err := ic.claimImageJob(ctx)
			if err != nil || job == nil {
				continue
			}
			go ic.processImageJob(ctx, *job)
		}
	}
}
