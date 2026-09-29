package main

import (
	"dnd-cards-backend/animationpresentation"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func registerAnimationRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	routes := api.Group("/animations", StrictAuthMiddleware(auth))
	routes.GET("", func(c *gin.Context) {
		profiles := []animationpresentation.Profile{}
		bindings := []animationpresentation.Binding{}
		if db.Order("key").Find(&profiles).Error != nil || db.Order("entity_type, entity_id").Find(&bindings).Error != nil {
			c.JSON(500, gin.H{"error": "Не удалось загрузить анимации"})
			return
		}
		defaults, err := animationpresentation.Defaults()
		if err != nil {
			c.JSON(500, gin.H{"error": "Не удалось загрузить анимации"})
			return
		}
		definitions := make([]json.RawMessage, 0, len(profiles))
		for _, profile := range profiles {
			definitions = append(definitions, profile.Definition)
		}
		c.JSON(200, gin.H{"version": defaults.Version, "profiles": definitions, "bindings": bindings, "defaults": defaults.Defaults, "can_manage": canManageEntityTags(c)})
	})
	routes.PUT("/entities/:type/:id", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(4096), func(c *gin.Context) {
		kind, id := c.Param("type"), c.Param("id")
		if kind != "spell" && kind != "action" && kind != "card" && kind != "effect" {
			c.JSON(400, gin.H{"error": "Неизвестный тип сущности"})
			return
		}
		var input struct {
			ProfileKey string `json:"profile_key"`
		}
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil {
			c.JSON(400, gin.H{"error": "Некорректная привязка анимации"})
			return
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := validateTaggedEntity(tx, kind, id, true); err != nil {
				return err
			}
			if input.ProfileKey == "" {
				return tx.Where("entity_type=? AND entity_id=?", kind, id).Delete(&animationpresentation.Binding{}).Error
			}
			var profile animationpresentation.Profile
			if err := tx.First(&profile, "key = ?", input.ProfileKey).Error; err != nil {
				return err
			}
			return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "entity_type"}, {Name: "entity_id"}}, DoUpdates: clause.AssignmentColumns([]string{"profile_key"})}).Create(&animationpresentation.Binding{EntityType: kind, EntityID: id, ProfileKey: input.ProfileKey}).Error
		})
		if err != nil {
			c.JSON(400, gin.H{"error": "Не удалось сохранить анимацию сущности"})
			return
		}
		c.JSON(200, gin.H{"saved": true})
	})
}
