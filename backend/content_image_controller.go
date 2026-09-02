package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ContentImageController keeps catalog list payloads small while preserving
// images whose legacy source is an embedded data URI. Lists expose this stable
// URL; the image bytes are fetched independently and cached by the browser.
type ContentImageController struct {
	db *gorm.DB
}

func NewContentImageController(db *gorm.DB) *ContentImageController {
	return &ContentImageController{db: db}
}

var contentImageTables = map[string]string{
	"cards":       "cards",
	"actions":     "actions",
	"effects":     "effects",
	"spells":      "spells",
	"races":       "races",
	"classes":     "classes",
	"feats":       "feats",
	"backgrounds": "backgrounds",
	"resources":   "resources",
}

type contentImageRow struct {
	ImageURL           string `gorm:"column:image_url"`
	ImageCloudinaryURL string `gorm:"column:image_cloudinary_url"`
}

var contentImageRasterTypes = map[string]struct{}{
	"image/avif": {},
	"image/gif":  {},
	"image/jpeg": {},
	"image/png":  {},
	"image/webp": {},
}

func contentImageETag(source string) string {
	digest := sha256.Sum256([]byte(source))
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func storedContentImageSource(row contentImageRow) string {
	if source := strings.TrimSpace(row.ImageCloudinaryURL); source != "" {
		if contentImageSourceUsable(source) {
			return source
		}
	}
	return strings.TrimSpace(row.ImageURL)
}

func contentImageSourceUsable(source string) bool {
	source = strings.TrimSpace(source)
	if source == "" {
		return false
	}
	if contentImageRedirectSource(source) {
		return true
	}
	_, _, ok := decodeContentImageDataURI(source)
	return ok
}

func decodeContentImageDataURI(source string) (contentType string, body []byte, ok bool) {
	if !strings.HasPrefix(source, "data:") {
		return "", nil, false
	}
	header, payload, found := strings.Cut(strings.TrimPrefix(source, "data:"), ",")
	if !found || !strings.HasSuffix(header, ";base64") {
		return "", nil, false
	}
	declaredType := strings.TrimSuffix(header, ";base64")
	contentType, _, err := mime.ParseMediaType(declaredType)
	if _, allowed := contentImageRasterTypes[contentType]; err != nil || !allowed {
		return "", nil, false
	}
	body, err = base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil || len(body) == 0 {
		return "", nil, false
	}
	return contentType, body, true
}

func contentImageRedirectSource(source string) bool {
	if strings.HasPrefix(source, "https://") {
		return true
	}
	return strings.HasPrefix(source, "/") &&
		!strings.HasPrefix(source, "//") &&
		!strings.Contains(source, `\`)
}

func (cc *ContentImageController) Get(c *gin.Context) {
	table, allowed := contentImageTables[c.Param("entityType")]
	if !allowed {
		c.Status(http.StatusNotFound)
		return
	}
	entityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	var row contentImageRow
	imageSelect := "image_url, image_cloudinary_url"
	if c.Param("entityType") == "resources" {
		imageSelect = "image_url, '' AS image_cloudinary_url"
	}
	result := cc.db.Table(table).
		Select(imageSelect).
		Where("id = ? AND deleted_at IS NULL", entityID).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if result.Error != nil {
		c.Status(http.StatusInternalServerError)
		return
	}

	source := storedContentImageSource(row)
	if source == "" {
		c.Status(http.StatusNotFound)
		return
	}

	c.Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
	if contentImageRedirectSource(source) {
		c.Redirect(http.StatusFound, source)
		return
	}

	contentType, body, ok := decodeContentImageDataURI(source)
	if !ok {
		c.Status(http.StatusUnsupportedMediaType)
		return
	}
	etag := contentImageETag(source)
	c.Header("ETag", etag)
	c.Header("X-Content-Type-Options", "nosniff")
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Data(http.StatusOK, contentType, body)
}
