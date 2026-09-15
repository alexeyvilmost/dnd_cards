package main

import (
	"dnd-cards-backend/passivepresentation"
	"encoding/base64"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/url"
	"os"
	"strings"
)

func registerPassivePresentationRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	routes := api.Group("/passive-presentations", StrictAuthMiddleware(auth))
	routes.GET("", func(c *gin.Context) {
		var rows []passivepresentation.Presentation
		if err := db.Order("key").Find(&rows).Error; err != nil {
			c.JSON(500, gin.H{"error": "Не удалось загрузить пассивы"})
			return
		}
		userID, _ := GetCurrentUserID(c)
		admins, _ := parseContentAdminUserIDs(os.Getenv("CONTENT_ADMIN_USER_IDS"))
		_, canManage := admins[userID]
		c.JSON(200, gin.H{"passives": rows, "can_manage": canManage})
	})
	routes.PUT("/:key", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(2<<20), func(c *gin.Context) {
		var request struct {
			Name                string `json:"name"`
			Description         string `json:"description"`
			ImageURL            string `json:"image_url"`
			EnabledDescription  string `json:"enabled_description"`
			DisabledDescription string `json:"disabled_description"`
			Version             int    `json:"version"`
		}
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || strings.TrimSpace(request.Name) == "" || len([]rune(request.Name)) > 200 || request.Version < 1 {
			c.JSON(400, gin.H{"error": "Некорректное оформление пассива. Механика недоступна для изменения."})
			return
		}
		image := strings.TrimSpace(request.ImageURL)
		if image != "" {
			parsed, err := url.Parse(image)
			inlinePNG := strings.HasPrefix(image, "data:image/png;base64,")
			if inlinePNG {
				decoded, decodeErr := base64.StdEncoding.DecodeString(strings.TrimPrefix(image, "data:image/png;base64,"))
				inlinePNG = decodeErr == nil && len(decoded) >= 8 && string(decoded[:8]) == "\x89PNG\r\n\x1a\n"
			}
			if err != nil || (!inlinePNG && parsed.Scheme != "https" && parsed.Scheme != "http" && !(strings.HasPrefix(image, "/") && !strings.HasPrefix(image, "//"))) {
				c.JSON(400, gin.H{"error": "Укажите относительный путь или HTTP(S) адрес изображения"})
				return
			}
		}
		var row passivepresentation.Presentation
		if db.First(&row, "key = ?", c.Param("key")).Error != nil {
			c.JSON(404, gin.H{"error": "Пассив не найден"})
			return
		}
		result := db.Model(&row).Where("version = ?", request.Version).Updates(map[string]any{
			"name": strings.TrimSpace(request.Name), "description": request.Description, "image_url": image,
			"enabled_description": request.EnabledDescription, "disabled_description": request.DisabledDescription, "version": request.Version + 1,
		})
		if result.Error != nil {
			c.JSON(500, gin.H{"error": "Не удалось сохранить пассив"})
			return
		}
		if result.RowsAffected != 1 {
			c.JSON(409, gin.H{"error": "Оформление изменено в другой вкладке. Откройте его заново."})
			return
		}
		db.First(&row, "key = ?", c.Param("key"))
		c.JSON(200, row)
	})
}
