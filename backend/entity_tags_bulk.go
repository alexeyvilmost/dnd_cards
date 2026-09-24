package main

import (
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type bulkEntityTagsRequest struct {
	EntityType string   `json:"entity_type"`
	EntityIDs  []string `json:"entity_ids"`
	TagIDs     []string `json:"tag_ids"`
	Operation  string   `json:"operation"`
}

func (req *bulkEntityTagsRequest) normalize() error {
	if _, ok := taggedEntityTables[req.EntityType]; !ok {
		return roguelikeError(400, "invalid_entity_type", "Неизвестный тип сущности")
	}
	if req.Operation != "add" && req.Operation != "remove" {
		return roguelikeError(400, "invalid_operation", "Выберите добавление или снятие тегов")
	}
	if len(req.EntityIDs) == 0 || len(req.EntityIDs) > 500 || len(req.TagIDs) == 0 || len(req.TagIDs) > 64 {
		return roguelikeError(400, "invalid_bulk_size", "Выберите от 1 до 500 сущностей и от 1 до 64 тегов")
	}
	for _, field := range []*[]string{&req.EntityIDs, &req.TagIDs} {
		seen := map[string]bool{}
		ids := []string{}
		for _, id := range *field {
			if field == &req.TagIDs || req.EntityType != "passive" {
				parsed, err := uuid.Parse(id)
				if err != nil || parsed == uuid.Nil {
					return roguelikeError(400, "invalid_id", "Некорректный ID сущности или тега")
				}
				id = parsed.String()
			} else if strings.TrimSpace(id) == "" || len(id) > 255 {
				return roguelikeError(400, "invalid_id", "Некорректный ID сущности")
			}
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		sort.Strings(ids) // Consistent row lock order for concurrent bulk edits.
		*field = ids
	}
	return nil
}

func applyBulkEntityTags(db *gorm.DB, req bulkEntityTagsRequest) error {
	if err := req.normalize(); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, id := range req.EntityIDs {
			if err := validateTaggedEntity(tx, req.EntityType, id, true); err != nil {
				return err
			}
		}
		var count int64
		if err := tx.Model(&EntityTag{}).Where("id IN ?", req.TagIDs).Count(&count).Error; err != nil {
			return err
		}
		if int(count) != len(req.TagIDs) {
			return roguelikeError(400, "unknown_tag", "Тег не найден")
		}
		if req.Operation == "remove" {
			return tx.Where("entity_type = ? AND entity_id IN ? AND tag_id IN ?", req.EntityType, req.EntityIDs, req.TagIDs).Delete(&EntityTagAssignment{}).Error
		}
		for _, id := range req.EntityIDs {
			// Preserve unrelated tags; enforce the same per-entity cap as single edits.
			if err := tx.Model(&EntityTagAssignment{}).Where("entity_type = ? AND entity_id = ? AND tag_id NOT IN ?", req.EntityType, id, req.TagIDs).Count(&count).Error; err != nil {
				return err
			}
			if count+int64(len(req.TagIDs)) > 64 {
				return roguelikeError(400, "too_many_tags", "На одной сущности не может быть больше 64 тегов")
			}
			rows := make([]EntityTagAssignment, 0, len(req.TagIDs))
			for _, tag := range req.TagIDs {
				rows = append(rows, EntityTagAssignment{req.EntityType, id, tag})
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func bulkEntityTagsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Defense in depth, including if a caller registers the handler incorrectly.
		if !canManageEntityTags(c) {
			c.JSON(403, gin.H{"error": "Нет прав администратора контента"})
			return
		}
		var req bulkEntityTagsRequest
		if c.ShouldBindJSON(&req) != nil {
			c.JSON(400, gin.H{"error": "Некорректный запрос тегов"})
			return
		}
		if err := applyBulkEntityTags(db, req); err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	}
}

// Registered by the existing entity-tag registrar; no additional main route.
func registerBulkEntityTagRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	api.POST("/entity-tags/bulk", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(64<<10), bulkEntityTagsHandler(db))
}
