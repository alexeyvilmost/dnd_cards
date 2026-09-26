package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Library tags are content metadata, not runtime mechanic/weapon tags.
var taggedEntityTables = map[string]string{
	"card": "cards", "action": "actions", "effect": "effects", "spell": "spells",
	"feat": "feats", "background": "backgrounds", "race": "races", "class": "classes",
	"resource": "resources", "variable": "variables", "concept": "concepts", "monster": "monsters",
	"passive": "passive_presentations",
}

type EntityTag struct {
	ID          string `json:"id" gorm:"type:uuid;primaryKey"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (EntityTag) TableName() string { return "entity_tag_definitions" }

type EntityTagAssignment struct {
	EntityType string `json:"entity_type" gorm:"primaryKey"`
	EntityID   string `json:"entity_id" gorm:"primaryKey"`
	TagID      string `json:"tag_id" gorm:"type:uuid;primaryKey"`
}

func (EntityTagAssignment) TableName() string { return "entity_tag_assignments" }
func canManageEntityTags(c *gin.Context) bool {
	if c.GetBool("is_admin") {
		return true
	}
	id, _ := GetCurrentUserID(c)
	admins, _ := parseContentAdminUserIDs(os.Getenv("CONTENT_ADMIN_USER_IDS"))
	_, ok := admins[id]
	return ok
}
func entityTagFilter(query *gorm.DB, c *gin.Context, kind, table string) *gorm.DB {
	if tag := c.Query("tag"); tag != "" {
		query = query.Where("EXISTS (SELECT 1 FROM entity_tag_assignments eta JOIN entity_tag_definitions etd ON etd.id=eta.tag_id WHERE eta.entity_type=? AND eta.entity_id="+table+".id::text AND (etd.id::text=? OR lower(etd.name)=lower(?)))", kind, tag, tag)
	}
	return query
}
func validateTaggedEntity(db *gorm.DB, kind, id string, lock bool) error {
	table, ok := taggedEntityTables[kind]
	if !ok {
		return roguelikeError(400, "invalid_entity_type", "Неизвестный тип сущности")
	}
	column := "id"
	where := " AND deleted_at IS NULL"
	if kind == "passive" {
		column = "key"
		where = ""
	}
	query := db.Table(table).Select(column).Where(column+"::text = ?"+where, id)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var row map[string]any
	if err := query.Take(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return roguelikeError(404, "entity_not_found", "Сущность не найдена")
		}
		return err
	}
	return nil
}
func registerEntityTagRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	registerBulkEntityTagRoutes(api, auth, db)
	api.GET("/entity-tag-members/:id", OptionalAuthMiddleware(auth), func(c *gin.Context) {
		rows := []string{}
		q := db.Model(&EntityTagAssignment{}).Where("tag_id::text=?", c.Param("id"))
		q = q.Where("entity_type <> 'card' OR entity_id IN (?)", itemLibraryQuery(db, c).Select("cards.id::text"))
		if kind := c.Query("type"); kind != "" {
			q = q.Where("entity_type=?", kind)
		}
		if err := q.Pluck("entity_id", &rows).Error; err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, gin.H{"ids": rows})
	})
	api.GET("/entity-tags", AuthMiddleware(auth), func(c *gin.Context) {
		rows := []EntityTag{}
		q := db.Model(&EntityTag{})
		if s := strings.TrimSpace(c.Query("q")); s != "" {
			q = q.Where("name ILIKE ?", "%"+s+"%")
		}
		if err := q.Order("name,id").Find(&rows).Error; err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, gin.H{"tags": rows, "can_manage": canManageEntityTags(c)})
	})
	api.POST("/entity-tags", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(16<<10), func(c *gin.Context) {
		var row EntityTag
		if c.ShouldBindJSON(&row) != nil {
			c.JSON(400, gin.H{"error": "Некорректный тег"})
			return
		}
		row.Name = strings.Join(strings.Fields(row.Name), " ")
		row.Description = strings.TrimSpace(row.Description)
		if utf8.RuneCountInString(row.Name) < 1 || utf8.RuneCountInString(row.Name) > 80 || utf8.RuneCountInString(row.Description) > 1000 {
			c.JSON(400, gin.H{"error": "Название: 1–80 символов; описание: до 1000"})
			return
		}
		row.ID = uuid.NewString()
		err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		var saved EntityTag
		if err = db.Where("lower(name)=lower(?)", row.Name).First(&saved).Error; err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, saved)
	})
	api.GET("/entity-tags/:type/:id", OptionalAuthMiddleware(auth), func(c *gin.Context) {
		kind, id := c.Param("type"), c.Param("id")
		if kind == "card" {
			var count int64
			if err := itemLibraryQuery(db, c).Where("cards.id::text = ?", id).Count(&count).Error; err != nil {
				writeRoguelikeError(c, err)
				return
			}
			if count == 0 {
				c.JSON(404, gin.H{"error": "Сущность не найдена"})
				return
			}
		}
		if err := validateTaggedEntity(db, kind, id, false); err != nil {
			writeRoguelikeError(c, err)
			return
		}
		rows := []EntityTag{}
		err := db.Model(&EntityTag{}).Joins("JOIN entity_tag_assignments a ON a.tag_id=entity_tag_definitions.id").Where("a.entity_type=? AND a.entity_id=?", kind, id).Order("name").Find(&rows).Error
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, gin.H{"tags": rows})
	})
	api.PUT("/entity-tags/:type/:id", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(16<<10), func(c *gin.Context) {
		var req struct {
			TagIDs []string `json:"tag_ids"`
		}
		if c.ShouldBindJSON(&req) != nil || len(req.TagIDs) > 64 {
			c.JSON(400, gin.H{"error": "Не более 64 тегов"})
			return
		}
		kind, id := c.Param("type"), c.Param("id")
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := validateTaggedEntity(tx, kind, id, true); err != nil {
				return err
			}
			seen := map[string]bool{}
			for _, tag := range req.TagIDs {
				if _, err := uuid.Parse(tag); err != nil {
					return roguelikeError(400, "invalid_tag", "Некорректный тег")
				}
				seen[tag] = true
			}
			ids := []string{}
			for id := range seen {
				ids = append(ids, id)
			}
			var count int64
			if err := tx.Model(&EntityTag{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
				return err
			}
			if int(count) != len(ids) {
				return roguelikeError(400, "unknown_tag", "Тег не найден")
			}
			if err := tx.Where("entity_type=? AND entity_id=?", kind, id).Delete(&EntityTagAssignment{}).Error; err != nil {
				return err
			}
			for _, tag := range ids {
				if err := tx.Create(&EntityTagAssignment{kind, id, tag}).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

func taggedRunCards(db *gorm.DB, tag string) ([]Card, error) {
	if _, err := uuid.Parse(tag); err != nil {
		return nil, fmt.Errorf("invalid configured pool tag")
	}
	rows := []Card{}
	err := db.Where("id::text IN (SELECT entity_id FROM entity_tag_assignments WHERE entity_type='card' AND tag_id=?)", tag).
		Where("is_template IS DISTINCT FROM 'only_template'").Order("card_number,id").Find(&rows).Error
	return rows, err
}
