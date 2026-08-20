package main

import (
	"crypto/subtle"
	"net/http"
	"os"
	"regexp"
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

var contentSupportSHA256Pattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var contentSupportUTCTimestampPattern = regexp.MustCompile(
	`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$`,
)

func isValidContentSupportUTCTimestamp(value string) bool {
	if !contentSupportUTCTimestampPattern.MatchString(value) {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

type ContentSupportRequest struct {
	Status               string               `json:"status" binding:"required"`
	ContentHash          *string              `json:"content_hash"`
	DependencyHash       *string              `json:"dependency_hash"`
	CertificationVersion *string              `json:"certification_version"`
	CertifiedAt          *string              `json:"certified_at"`
	Limitations          []string             `json:"limitations"`
	Note                 *string              `json:"note"`
	EvidenceID           *string              `json:"evidence_id"`
	EvidenceHash         *string              `json:"evidence_hash"`
	EvidenceCompletedAt  *string              `json:"evidence_completed_at"`
	GateSourceHash       *string              `json:"gate_source_hash"`
	SourceContentHash    *string              `json:"source_content_hash"`
	RulesHash            *string              `json:"rules_hash"`
	ReleaseContentHash   *string              `json:"release_content_hash"`
	ReleaseHash          *string              `json:"release_hash"`
	PatchHash            *string              `json:"patch_hash"`
	CatalogHash          *string              `json:"catalog_hash"`
	TestCoverage         *ContentTestCoverage `json:"test_coverage"`
	MechanicsLocked      *bool                `json:"mechanics_locked"`
}

type ContentTestCoverage struct {
	SchemaVersion int    `json:"schema_version"`
	Scope         string `json:"scope"`
	Required      int    `json:"required"`
	Passed        int    `json:"passed"`
	Percent       int    `json:"percent"`
}

const legacyMicroMVPEvidenceCertificationVersion = "micro-mvp-l1-rules-core-v3"
const microMVPEvidenceCertificationVersion = "micro-mvp-l1-rules-core-v4"
const miniMVPEvidenceCertificationVersion = "mini-mvp-l1-v1"
const basicActionsEvidenceCertificationVersion = "micro-mvp-basic-actions-v2"

func isMicroMVPEvidenceCertificationVersion(value string) bool {
	return value == legacyMicroMVPEvidenceCertificationVersion ||
		value == microMVPEvidenceCertificationVersion
}

func isReleaseEvidenceCertificationVersion(value string) bool {
	return isMicroMVPEvidenceCertificationVersion(value) ||
		value == miniMVPEvidenceCertificationVersion
}

func isMechanicsLockCertificationVersion(value string) bool {
	return value == microMVPEvidenceCertificationVersion ||
		value == miniMVPEvidenceCertificationVersion ||
		value == basicActionsEvidenceCertificationVersion
}

func validateContentTestCoverage(coverage *ContentTestCoverage) []string {
	if coverage == nil {
		return []string{"test_coverage отсутствует"}
	}
	issues := []string{}
	if coverage.SchemaVersion != 1 {
		issues = append(issues, "test_coverage.schema_version должен быть 1")
	}
	if strings.TrimSpace(coverage.Scope) == "" || coverage.Scope != strings.TrimSpace(coverage.Scope) {
		issues = append(issues, "test_coverage.scope должен быть непустым каноническим идентификатором")
	}
	if coverage.Required < 1 {
		issues = append(issues, "test_coverage.required должен быть положительным")
	}
	if coverage.Passed < 0 || coverage.Passed > coverage.Required {
		issues = append(issues, "test_coverage.passed должен находиться между 0 и required")
	}
	expectedPercent := 0
	if coverage.Required > 0 {
		expectedPercent = coverage.Passed * 100 / coverage.Required
	}
	if coverage.Percent != expectedPercent {
		issues = append(issues, "test_coverage.percent должен точно соответствовать passed/required")
	}
	return issues
}

func requiredSupportHash(value *string, field string, issues *[]string) {
	if value == nil || !contentSupportSHA256Pattern.MatchString(*value) {
		*issues = append(*issues, field+" должен иметь формат sha256:<64 lowercase hex>")
	}
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
		(req.ContentHash == nil || !contentSupportSHA256Pattern.MatchString(*req.ContentHash)) {
		issues = append(issues, "verified-статус требует content_hash в формате sha256:<64 lowercase hex>")
	}
	if strings.HasPrefix(req.Status, "verified_") &&
		(req.DependencyHash == nil || !contentSupportSHA256Pattern.MatchString(*req.DependencyHash)) {
		issues = append(issues, "verified-статус требует dependency_hash в формате sha256:<64 lowercase hex>")
	}
	if strings.HasPrefix(req.Status, "verified_") && req.CertifiedAt != nil &&
		!isValidContentSupportUTCTimestamp(*req.CertifiedAt) {
		issues = append(issues, "verified-статус допускает certified_at только в явном UTC RFC3339 формате")
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
	if req.CertificationVersion != nil &&
		isReleaseEvidenceCertificationVersion(strings.TrimSpace(*req.CertificationVersion)) {
		if !isReleaseEvidenceCertificationVersion(*req.CertificationVersion) {
			issues = append(issues, "release evidence требует канонический certification_version без пробелов")
		}
		if req.EvidenceID == nil {
			issues = append(issues, "release evidence требует evidence_id")
		} else if parsed, err := uuid.Parse(*req.EvidenceID); err != nil || parsed == uuid.Nil ||
			strings.TrimSpace(*req.EvidenceID) != *req.EvidenceID {
			issues = append(issues, "release evidence требует evidence_id UUID")
		}
		requiredSupportHash(req.EvidenceHash, "evidence_hash", &issues)
		requiredSupportHash(req.GateSourceHash, "gate_source_hash", &issues)
		requiredSupportHash(req.SourceContentHash, "source_content_hash", &issues)
		requiredSupportHash(req.RulesHash, "rules_hash", &issues)
		requiredSupportHash(req.ReleaseContentHash, "release_content_hash", &issues)
		requiredSupportHash(req.ReleaseHash, "release_hash", &issues)
		requiredSupportHash(req.PatchHash, "patch_hash", &issues)
		requiredSupportHash(req.CatalogHash, "catalog_hash", &issues)
		if req.CertifiedAt == nil || !isValidContentSupportUTCTimestamp(*req.CertifiedAt) {
			issues = append(issues, "release evidence требует явный certified_at UTC RFC3339")
		}
		if req.EvidenceCompletedAt == nil ||
			!isValidContentSupportUTCTimestamp(*req.EvidenceCompletedAt) {
			issues = append(issues, "release evidence требует evidence_completed_at UTC RFC3339")
		}
	}
	if req.CertificationVersion != nil &&
		(*req.CertificationVersion == microMVPEvidenceCertificationVersion ||
			*req.CertificationVersion == miniMVPEvidenceCertificationVersion) {
		issues = append(issues, validateContentTestCoverage(req.TestCoverage)...)
		expectedScope := "micro-mvp-l1"
		if *req.CertificationVersion == miniMVPEvidenceCertificationVersion {
			expectedScope = "mini-mvp-l1"
		}
		if req.TestCoverage != nil && req.TestCoverage.Scope != expectedScope {
			issues = append(issues, "test_coverage.scope должен быть "+expectedScope)
		}
	}
	if req.CertificationVersion != nil &&
		strings.TrimSpace(*req.CertificationVersion) == basicActionsEvidenceCertificationVersion {
		if *req.CertificationVersion != basicActionsEvidenceCertificationVersion {
			issues = append(issues, "basic-actions evidence требует канонический certification_version без пробелов")
		}
		if req.EvidenceID == nil {
			issues = append(issues, "basic-actions evidence требует evidence_id")
		} else if parsed, err := uuid.Parse(*req.EvidenceID); err != nil || parsed == uuid.Nil ||
			strings.TrimSpace(*req.EvidenceID) != *req.EvidenceID {
			issues = append(issues, "basic-actions evidence требует evidence_id UUID")
		}
		requiredSupportHash(req.EvidenceHash, "evidence_hash", &issues)
		if req.CertifiedAt == nil || !isValidContentSupportUTCTimestamp(*req.CertifiedAt) {
			issues = append(issues, "basic-actions evidence требует явный certified_at UTC RFC3339")
		}
		if req.EvidenceCompletedAt == nil ||
			!isValidContentSupportUTCTimestamp(*req.EvidenceCompletedAt) {
			issues = append(issues, "basic-actions evidence требует evidence_completed_at UTC RFC3339")
		}
		issues = append(issues, validateContentTestCoverage(req.TestCoverage)...)
	}
	if req.MechanicsLocked != nil && *req.MechanicsLocked {
		if req.CertificationVersion == nil || !isMechanicsLockCertificationVersion(*req.CertificationVersion) {
			issues = append(issues, "mechanics_locked требует текущую evidence certification")
		}
		if !strings.HasPrefix(req.Status, "verified_") {
			issues = append(issues, "mechanics_locked требует verified-статус")
		}
		if coverageIssues := validateContentTestCoverage(req.TestCoverage); len(coverageIssues) > 0 {
			issues = append(issues, coverageIssues...)
		} else if req.TestCoverage.Passed != req.TestCoverage.Required || req.TestCoverage.Percent != 100 {
			issues = append(issues, "mechanics_locked требует 100% покрытия заявленного scope")
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

func (cc *ContentSupportController) authorizeCertificationKey(c *gin.Context) bool {
	if cc.certificationKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "content certification API не настроен",
		})
		return false
	}
	if !isCertificationKeyAuthorized(
		cc.certificationKey,
		c.GetHeader("X-Content-Certification-Key"),
	) {
		c.JSON(http.StatusForbidden, gin.H{"error": "нет доступа к сертификации контента"})
		return false
	}
	return true
}

func (cc *ContentSupportController) Update(c *gin.Context) {
	if !cc.authorizeCertificationKey(c) {
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
	var current struct {
		Support *JSONMap `gorm:"column:support"`
	}
	if result := cc.db.Table(table).Select("support").Where("id = ?", id).Take(&current); result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Сущность не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось прочитать certification"})
		return
	}
	if isContentMechanicsLocked(current.Support) && (req.MechanicsLocked == nil || !*req.MechanicsLocked) {
		rejectLockedContentMutation(c, current.Support)
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
	if req.TestCoverage != nil {
		support["test_coverage"] = req.TestCoverage
	}
	if req.MechanicsLocked != nil {
		support["mechanics_locked"] = *req.MechanicsLocked
	}
	if req.Note != nil {
		support["note"] = *req.Note
	}
	for key, value := range map[string]*string{
		"evidence_id": req.EvidenceID, "evidence_hash": req.EvidenceHash,
		"evidence_completed_at": req.EvidenceCompletedAt,
		"gate_source_hash":      req.GateSourceHash, "source_content_hash": req.SourceContentHash,
		"rules_hash": req.RulesHash, "release_content_hash": req.ReleaseContentHash,
		"release_hash": req.ReleaseHash, "patch_hash": req.PatchHash,
		"catalog_hash": req.CatalogHash,
	} {
		if value != nil {
			support[key] = *value
		}
	}

	result := cc.db.Table(table).Where("id = ?", id).Update("support", support)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить certification"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Certification не была обновлена"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"entity_type": c.Param("entityType"),
		"entity_id":   id,
		"support":     support,
	})
}
