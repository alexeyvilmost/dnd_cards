package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Templates are global content, not characters with a shared/fake owner.
type CharacterTemplate struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	PresetKey   *string   `json:"preset_key"`
	Character   JSONMap   `json:"character" gorm:"type:jsonb"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (CharacterTemplate) TableName() string { return "character_templates" }

func templateSnapshot(character CharacterV3) (JSONMap, error) {
	character.CharacterType = DefaultCharacterType
	character.CurrentHP = character.MaxHP
	character.Resources = character.MaxResources
	character.ActiveEffects = nil
	character.TurnState = nil
	raw, err := json.Marshal(character)
	if err != nil {
		return nil, err
	}
	var snapshot JSONMap
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	for _, key := range []string{"id", "user_id", "user", "group_id", "group", "source_template_id", "current_encounter_id", "runtime_revision", "access_mode", "created_at", "updated_at"} {
		delete(snapshot, key)
	}
	return snapshot, nil
}

func characterFromTemplate(t CharacterTemplate, userID uuid.UUID, name string) (CharacterV3, error) {
	var character CharacterV3
	raw, err := json.Marshal(t.Character)
	if err != nil {
		return character, err
	}
	if err = json.Unmarshal(raw, &character); err != nil {
		return character, err
	}
	// Even a malformed catalog entry must never carry ownership or combat state.
	character.ID = uuid.New()
	character.SourceTemplateID = &t.ID
	character.UserID = userID
	character.User = User{}
	character.GroupID, character.Group, character.CurrentEncounterID = nil, nil, nil
	character.RuntimeRevision = 0
	character.CreatedAt, character.UpdatedAt = time.Time{}, time.Time{}
	character.Name = name
	character.CharacterType = DefaultCharacterType
	character.AccessMode = characterV3AccessOwner
	character.CurrentHP = character.MaxHP
	character.Resources = character.MaxResources
	character.ActiveEffects, character.TurnState = nil, nil
	applyCharacterV3Defaults(&character)
	return character, validateCharacterClassLevels(character)
}

func registerCharacterTemplateRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	routes := api.Group("/character-templates", StrictAuthMiddleware(auth))
	routes.GET("", func(c *gin.Context) {
		var templates []CharacterTemplate
		if err := db.Order("created_at, name").Find(&templates).Error; err != nil {
			c.JSON(500, gin.H{"error": "не удалось загрузить шаблоны"})
			return
		}
		userID, _ := GetCurrentUserID(c)
		admins, _ := parseContentAdminUserIDs(os.Getenv("CONTENT_ADMIN_USER_IDS"))
		_, canManage := admins[userID]
		c.JSON(200, gin.H{"templates": templates, "can_manage": canManage})
	})
	routes.POST("/:id/copies", func(c *gin.Context) {
		userID, ok := requireCharacterV3UserID(c)
		if !ok {
			return
		}
		var request struct {
			Name string `json:"name"`
		}
		if c.ShouldBindJSON(&request) != nil || strings.TrimSpace(request.Name) == "" || len([]rune(strings.TrimSpace(request.Name))) > 100 {
			c.JSON(400, gin.H{"error": "введите имя от 1 до 100 символов"})
			return
		}
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "неверный ID шаблона"})
			return
		}
		var template CharacterTemplate
		if err = db.First(&template, "id = ?", id).Error; err != nil {
			c.JSON(404, gin.H{"error": "шаблон не найден"})
			return
		}
		character, err := characterFromTemplate(template, userID, strings.TrimSpace(request.Name))
		if err != nil {
			c.JSON(409, gin.H{"error": "шаблон содержит неверные уровни классов"})
			return
		}
		if err = validateCharacterSubclassOwnership(db, character); err != nil {
			c.JSON(409, gin.H{"error": "шаблон содержит неверный подкласс"})
			return
		}
		if err = db.Omit("User", "Group").Create(&character).Error; err != nil {
			c.JSON(500, gin.H{"error": "не удалось скопировать шаблон"})
			return
		}
		c.JSON(http.StatusCreated, character)
	})
	// Same fail-closed admin boundary as all other global library content.
	admin := routes.Group("", ContentAdminAuthMiddleware(auth))
	save := func(c *gin.Context) {
		var request struct {
			Name              string     `json:"name"`
			Description       string     `json:"description"`
			SourceCharacterID *uuid.UUID `json:"source_character_id"`
			Version           int        `json:"version"`
		}
		if c.ShouldBindJSON(&request) != nil || strings.TrimSpace(request.Name) == "" || len([]rune(request.Name)) > 100 || len([]rune(request.Description)) > 2000 {
			c.JSON(400, gin.H{"error": "неверные данные шаблона"})
			return
		}
		var template CharacterTemplate
		creating := c.Param("id") == ""
		if creating {
			template.ID = uuid.New()
			template.Version = 1
		} else {
			id, err := uuid.Parse(c.Param("id"))
			if err != nil {
				c.JSON(400, gin.H{"error": "неверный ID шаблона"})
				return
			}
			if db.First(&template, "id = ?", id).Error != nil {
				c.JSON(404, gin.H{"error": "шаблон не найден"})
				return
			}
		}
		if request.SourceCharacterID != nil {
			userID, _ := GetCurrentUserID(c)
			var source CharacterV3
			// Publishing requires an explicit, administrator-owned source sheet.
			if db.Where("id = ? AND user_id = ?", *request.SourceCharacterID, userID).First(&source).Error != nil {
				c.JSON(404, gin.H{"error": "собственный лист-источник не найден"})
				return
			}
			if source.CharacterType == "dungeon_crawl" || source.CurrentEncounterID != nil {
				c.JSON(409, gin.H{"error": "нужен обычный лист вне боя, не персонаж забега"})
				return
			}
			var err error
			template.Character, err = templateSnapshot(source)
			if err != nil {
				c.JSON(500, gin.H{"error": "не удалось подготовить шаблон"})
				return
			}
		} else if creating {
			c.JSON(400, gin.H{"error": "выберите лист-источник"})
			return
		}
		template.Name, template.Description = strings.TrimSpace(request.Name), strings.TrimSpace(request.Description)
		if creating {
			if db.Create(&template).Error != nil {
				c.JSON(500, gin.H{"error": "не удалось создать шаблон"})
				return
			}
			c.JSON(201, template)
			return
		}
		result := db.Model(&CharacterTemplate{}).Where("id = ? AND version = ?", template.ID, request.Version).
			Updates(map[string]any{"name": template.Name, "description": template.Description, "character": template.Character,
				"version": gorm.Expr("version + 1"), "updated_at": time.Now()})
		if result.Error != nil {
			c.JSON(500, gin.H{"error": "не удалось сохранить шаблон"})
			return
		}
		if result.RowsAffected != 1 {
			c.JSON(409, gin.H{"error": "шаблон уже изменён; обновите библиотеку"})
			return
		}
		template.Version = request.Version + 1
		c.JSON(200, template)
	}
	admin.POST("", JSONBodyLimitMiddleware(32768), save)
	admin.PUT("/:id", JSONBodyLimitMiddleware(32768), save)
}
