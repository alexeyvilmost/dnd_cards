package main

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Review is a human assessment of the current library entry, independent of
// the archived certification evidence and of permission to edit its mechanics.
var contentReviewTables = map[string]string{
	"card": "cards", "action": "actions", "effect": "effects", "spell": "spells",
	"feat": "feats", "background": "backgrounds", "race": "races", "class": "classes",
	"resource": "resources", "variable": "variables", "concept": "concepts", "monster": "monsters",
	"passive": "passive_presentations",
}

var validContentReviewStatuses = map[string]bool{
	"verified": true, "verified_partial": true, "not_verified": true,
	"not_tested": true, "narrative": true,
	"partial_narrative_verified": true, "partial_narrative_not_verified": true,
}

// CRUD owns entity data; review has its own endpoint. Omitting Support avoids
// overwriting a concurrent review with the editor's previously loaded value.
// RETURNING also includes the review reset/default supplied by the DB trigger.
func contentEntityWrite(db *gorm.DB) *gorm.DB {
	return db.Omit("Support").Clauses(clause.Returning{})
}

func ContentReviewMutation(auth *AuthService, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		table, ok := contentReviewTables[c.Param("entityType")]
		if !ok {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Неподдерживаемый тип сущности"})
			return
		}
		if c.Param("entityType") == "passive" {
			ContentAdminAuthMiddleware(auth)(c)
			return
		}
		ContentEntityMutation(auth, db, table, false)(c)
	}
}

// Retain the former handlers and evidence validators for historical tooling,
// but stop their HTTP routes from reintroducing live certification or locks.
func retiredContentCertification(c *gin.Context) {
	c.JSON(http.StatusGone, gin.H{"error": "Сертификация архивирована. Используйте ручной статус проверки.", "code": "content_certification_retired"})
}

func (cc *ContentSupportController) UpdateReview(c *gin.Context) {
	table, ok := contentReviewTables[c.Param("entityType")]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неподдерживаемый тип сущности"})
		return
	}
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if c.ShouldBindJSON(&req) != nil || !validContentReviewStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неизвестный статус проверки"})
		return
	}
	column, lookup, liveFilter := "id", any(c.Param("id")), " AND deleted_at IS NULL"
	selectFields := "id::text AS entity_id, author, support"
	if c.Param("entityType") == "passive" {
		column, liveFilter, selectFields = "key", "", "key AS entity_id, '' AS author, support"
	} else if id, err := uuid.Parse(c.Param("id")); err == nil && id != uuid.Nil {
		lookup = id
	} else {
		column = map[string]string{"resource": "resource_id", "variable": "variable_id", "concept": "concept_id"}[c.Param("entityType")]
		if column == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID сущности"})
			return
		}
	}
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Требуется авторизация"})
		return
	}
	var current struct {
		EntityID string
		Author   string
		Support  *JSONMap `gorm:"type:jsonb;column:support"`
	}
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Table(table).Select(selectFields).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(column+" = ?"+liveFilter, lookup).Take(&current).Error; err != nil {
			return err
		}
		// Recheck under the row lock so a simultaneous authorship change cannot
		// turn the middleware's ownership check into permission for another row.
		if !canManageEntityTags(c) && current.Author != userID.String() {
			return errContentReviewForbidden
		}
		if current.Support != nil && (*current.Support)["status"] == req.Status {
			reviewedBy, _ := (*current.Support)["reviewed_by"].(string)
			reviewedAt, _ := (*current.Support)["reviewed_at"].(string)
			// A migration/default status has not yet been assessed by a person.
			// The first explicit review stamps its audit fields even when the
			// selected status matches that baseline. Subsequent retries are no-ops.
			if reviewedBy != "" && reviewedAt != "" {
				return nil
			}
		}
		support := JSONMap{"status": req.Status, "reviewed_at": time.Now().UTC().Format(time.RFC3339Nano), "reviewed_by": userID.String()}
		if err := tx.Table(table).Where(column+" = ?", lookup).Update("support", support).Error; err != nil {
			return err
		}
		current.Support = &support
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Сущность не найдена"})
		return
	}
	if errors.Is(err, errContentReviewForbidden) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Редактировать может только автор"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить статус проверки"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entity_type": c.Param("entityType"), "entity_id": current.EntityID, "support": current.Support})
}

var errContentReviewForbidden = errors.New("content review requires entity ownership")
