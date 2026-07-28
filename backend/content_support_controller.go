package main

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var contentSupportTables = map[string]string{
	"card":       "cards",
	"action":     "actions",
	"effect":     "effects",
	"spell":      "spells",
	"feat":       "feats",
	"background": "backgrounds",
	"race":       "races",
	"class":      "classes",
}

var validContentSupportStatuses = map[string]bool{
	"verified_mechanical": true,
	"verified_partial":    true,
	"verified_narrative":  true,
	"partial":             true,
	"untested":            true,
	"known_mismatch":      true,
}

type ContentSupportRequest struct {
	Status               string   `json:"status" binding:"required"`
	ContentHash          *string  `json:"content_hash"`
	DependencyHash       *string  `json:"dependency_hash"`
	CertificationVersion *string  `json:"certification_version"`
	CertifiedAt          *string  `json:"certified_at"`
	Limitations          []string `json:"limitations"`
	Note                 *string  `json:"note"`
}

func validateContentSupportRequest(req ContentSupportRequest) []string {
	issues := []string{}
	if !validContentSupportStatuses[req.Status] {
		issues = append(issues, "неизвестный status")
	}
	if strings.HasPrefix(req.Status, "verified_") &&
		(req.CertificationVersion == nil || strings.TrimSpace(*req.CertificationVersion) == "") {
		issues = append(issues, "verified-статус требует certification_version")
	}
	if strings.HasPrefix(req.Status, "verified_") &&
		(req.ContentHash == nil || strings.TrimSpace(*req.ContentHash) == "") {
		issues = append(issues, "verified-статус требует content_hash")
	}
	if strings.HasPrefix(req.Status, "verified_") &&
		(req.DependencyHash == nil || strings.TrimSpace(*req.DependencyHash) == "") {
		issues = append(issues, "verified-статус требует dependency_hash")
	}
	if req.Status == "verified_partial" {
		hasLimitation := false
		for _, limitation := range req.Limitations {
			if strings.TrimSpace(limitation) != "" {
				hasLimitation = true
				break
			}
		}
		if !hasLimitation {
			issues = append(issues, "verified_partial требует limitations")
		}
	}
	return issues
}

type ContentSupportController struct {
	db               *gorm.DB
	certificationKey string
}

func NewContentSupportController(db *gorm.DB) *ContentSupportController {
	return &ContentSupportController{
		db:               db,
		certificationKey: strings.TrimSpace(os.Getenv("CONTENT_CERTIFICATION_KEY")),
	}
}

func isCertificationKeyAuthorized(configured, supplied string) bool {
	configured = strings.TrimSpace(configured)
	supplied = strings.TrimSpace(supplied)
	if configured == "" || supplied == "" || len(configured) != len(supplied) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(configured), []byte(supplied)) == 1
}

func (cc *ContentSupportController) Update(c *gin.Context) {
	if cc.certificationKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "content certification API не настроен",
		})
		return
	}
	if !isCertificationKeyAuthorized(
		cc.certificationKey,
		c.GetHeader("X-Content-Certification-Key"),
	) {
		c.JSON(http.StatusForbidden, gin.H{"error": "нет доступа к сертификации контента"})
		return
	}

	table, ok := contentSupportTables[c.Param("entityType")]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неподдерживаемый тип сущности"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID сущности"})
		return
	}

	var req ContentSupportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные certification"})
		return
	}
	if issues := validateContentSupportRequest(req); len(issues) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидная certification", "issues": issues})
		return
	}

	certifiedAt := time.Now().UTC().Format(time.RFC3339)
	if req.CertifiedAt != nil && strings.TrimSpace(*req.CertifiedAt) != "" {
		certifiedAt = *req.CertifiedAt
	}
	support := JSONMap{
		"status":       req.Status,
		"certified_at": certifiedAt,
	}
	if req.ContentHash != nil {
		support["content_hash"] = *req.ContentHash
	}
	if req.DependencyHash != nil {
		support["dependency_hash"] = *req.DependencyHash
	}
	if req.CertificationVersion != nil {
		support["certification_version"] = *req.CertificationVersion
	}
	if len(req.Limitations) > 0 {
		support["limitations"] = req.Limitations
	}
	if req.Note != nil {
		support["note"] = *req.Note
	}

	result := cc.db.Table(table).Where("id = ?", id).Update("support", support)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить certification"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Сущность не найдена"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"entity_type": c.Param("entityType"),
		"entity_id":   id,
		"support":     support,
	})
}
