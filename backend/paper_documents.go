package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// JSON documents are decoded and stored as one value; keep an operational
// memory/database boundary while allowing large imported character histories.
const maxPaperDocumentBytes = 64_000_000

type paperDocument struct {
	ID        uuid.UUID       `gorm:"type:uuid;primaryKey" json:"id"`
	OwnerID   *uuid.UUID      `gorm:"type:uuid" json:"-"`
	Document  json.RawMessage `gorm:"type:jsonb" json:"document"`
	Revision  int64           `json:"revision"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	DeletedAt gorm.DeletedAt  `gorm:"index" json:"-"`
}

func (paperDocument) TableName() string { return "paper_documents" }

func validPaperDocument(raw json.RawMessage) bool {
	if len(raw) == 0 || len(raw) > maxPaperDocumentBytes {
		return false
	}
	var doc struct {
		Version  int               `json:"version"`
		Fields   map[string]string `json:"fields"`
		Checks   map[string]bool   `json:"checks"`
		Training map[string]int    `json:"training"`
		Sections map[string]struct {
			Text     string `json:"text"`
			FontSize int    `json:"fontSize"`
		} `json:"sections"`
	}
	if json.Unmarshal(raw, &doc) != nil || doc.Version != 1 || doc.Fields == nil {
		return false
	}
	if len(doc.Fields) > 2000 || len(doc.Checks) > 2000 || len(doc.Training) > 2000 || len(doc.Sections) > 2000 {
		return false
	}
	for key, value := range doc.Fields {
		if len(key) > 150 || len(value) > 80_000 {
			return false
		}
	}
	for _, value := range doc.Training {
		if value < 0 || value > 2 {
			return false
		}
	}
	for _, value := range doc.Sections {
		if len(value.Text) > 800_000 || value.FontSize < 6 || value.FontSize > 48 {
			return false
		}
	}
	return true
}

func paperDocumentAccess(db *gorm.DB, c *gin.Context) *gorm.DB {
	userID, _ := GetCurrentUserID(c)
	return db.Where("owner_id IS NULL OR owner_id = ?", userID)
}

func registerPaperDocumentRoutes(r *gin.Engine, auth *AuthService, db *gorm.DB) {
	// Portraits in imported paper documents can be larger than normal entity mutations.
	group := r.Group("/api/paper-sheets")
	group.Use(OptionalAuthMiddleware(auth), JSONBodyLimitMiddleware(maxPaperDocumentBytes+2048),
		RequestBodyLimitMiddleware(maxPaperDocumentBytes+2048), NewFixedWindowRateLimiter(120, time.Minute).AnonymousMutationsOnly())
	group.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	})
	group.GET("", StrictAuthMiddleware(auth), func(c *gin.Context) {
		userID, _ := GetCurrentUserID(c)
		var rows []struct {
			ID        uuid.UUID `json:"id"`
			Name      string    `json:"name"`
			UpdatedAt time.Time `json:"updated_at"`
		}
		query := db.Table("paper_documents").Select("id, COALESCE(NULLIF(document->'fields'->>'name', ''), 'Безымянный персонаж') AS name, updated_at").Where("owner_id = ?", userID)
		if c.Query("deleted") == "true" {
			query = query.Where("deleted_at IS NOT NULL")
		} else {
			query = query.Where("deleted_at IS NULL")
		}
		err := query.Order("updated_at DESC").Scan(&rows).Error
		if err != nil {
			c.JSON(500, gin.H{"error": "Не удалось загрузить листы"})
			return
		}
		if rows == nil {
			c.JSON(200, gin.H{"sheets": []any{}})
			return
		}
		c.JSON(200, gin.H{"sheets": rows})
	})
	// Only an owner may remove/restore a private document. Anonymous edit links
	// do not confer ownership. Keep data intact and invalidate stale editor revisions.
	setDeleted := func(deleted bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			id, err := uuid.Parse(c.Param("id"))
			if err != nil {
				c.JSON(404, gin.H{"error": "Лист не найден"})
				return
			}
			userID, _ := GetCurrentUserID(c)
			query := db.Unscoped().Model(&paperDocument{}).Where("id = ? AND owner_id = ?", id, userID)
			var deletedAt any
			if deleted {
				query = query.Where("deleted_at IS NULL")
				deletedAt = time.Now()
			} else {
				query = query.Where("deleted_at IS NOT NULL")
			}
			result := query.Updates(map[string]any{"deleted_at": deletedAt, "updated_at": time.Now(), "revision": gorm.Expr("revision + 1")})
			if result.Error != nil {
				c.JSON(500, gin.H{"error": "Не удалось изменить состояние листа"})
				return
			}
			if result.RowsAffected == 0 {
				c.JSON(404, gin.H{"error": "Лист не найден, уже перемещён или доступен только владельцу"})
				return
			}
			c.Status(http.StatusNoContent)
		}
	}
	group.DELETE("/:id", StrictAuthMiddleware(auth), setDeleted(true))
	group.POST("/:id/restore", StrictAuthMiddleware(auth), setDeleted(false))
	group.POST("", NewFixedWindowRateLimiter(20, time.Hour).AnonymousOnly(), func(c *gin.Context) {
		var req struct {
			Document  json.RawMessage `json:"document"`
			Anonymous bool            `json:"anonymous"`
		}
		if c.ShouldBindJSON(&req) != nil || !validPaperDocument(req.Document) {
			c.JSON(400, gin.H{"error": "Некорректный документ листа"})
			return
		}
		var owner *uuid.UUID
		if !req.Anonymous {
			userID, err := GetCurrentUserID(c)
			if err != nil {
				c.JSON(401, gin.H{"error": "Войдите или явно выберите анонимный лист"})
				return
			}
			owner = &userID
		}
		row := paperDocument{ID: uuid.New(), OwnerID: owner, Document: req.Document, Revision: 1}
		if err := db.Create(&row).Error; err != nil {
			c.JSON(500, gin.H{"error": "Не удалось создать лист"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"id": row.ID, "document": row.Document, "revision": row.Revision, "anonymous": owner == nil})
	})
	group.GET("/:id", func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(404, gin.H{"error": "Лист не найден"})
			return
		}
		var row paperDocument
		err = paperDocumentAccess(db, c).Where("id = ?", id).First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "Лист не найден или доступен только владельцу"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "Не удалось загрузить лист"})
			return
		}
		c.JSON(200, gin.H{"id": row.ID, "document": row.Document, "revision": row.Revision, "anonymous": row.OwnerID == nil})
	})
	group.PUT("/:id", func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(404, gin.H{"error": "Лист не найден"})
			return
		}
		var req struct {
			Document json.RawMessage `json:"document"`
			Revision int64           `json:"revision"`
		}
		if c.ShouldBindJSON(&req) != nil || req.Revision < 1 || !validPaperDocument(req.Document) {
			c.JSON(400, gin.H{"error": "Некорректный документ листа"})
			return
		}
		result := paperDocumentAccess(db.Model(&paperDocument{}), c).Where("id = ? AND revision = ?", id, req.Revision).Updates(map[string]any{"document": req.Document, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()})
		if result.Error != nil {
			c.JSON(500, gin.H{"error": "Не удалось сохранить лист"})
			return
		}
		if result.RowsAffected == 0 {
			var count int64
			if err := paperDocumentAccess(db.Model(&paperDocument{}), c).Where("id = ?", id).Count(&count).Error; err != nil {
				c.JSON(500, gin.H{"error": "Не удалось проверить версию листа"})
				return
			}
			if count == 0 {
				c.JSON(404, gin.H{"error": "Лист не найден или доступен только владельцу"})
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": "Лист изменён в другой вкладке. Скачайте свои изменения в JSON перед обновлением страницы."})
			return
		}
		c.JSON(200, gin.H{"revision": req.Revision + 1})
	})
}
