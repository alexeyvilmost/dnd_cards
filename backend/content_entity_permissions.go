package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ContentEntityMutation permits administrators to manage the catalog, and
// creators to edit only rows whose Author is their immutable account UUID.
// Ordinary users may create items and spells; their Author is set by the
// controller, never copied from the request.
func ContentEntityMutation(auth *AuthService, db *gorm.DB, table string, create bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireStrictJWT(auth, c)
		if !ok {
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		if canManageEntityTags(c) {
			c.Next()
			return
		}
		if create && table != "cards" && table != "spells" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "создавать можно только предметы и заклинания"})
			return
		}
		if !create {
			id, err := uuid.Parse(c.Param("id"))
			column := "id"
			lookup := any(id)
			if err != nil {
				column = map[string]string{"resources": "resource_id", "variables": "variable_id", "concepts": "concept_id"}[table]
				if column == "" {
					c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "сущность не найдена"})
					return
				}
				lookup = c.Param("id")
			}
			var count int64
			if err := db.Table(table).Where(column+" = ? AND author = ? AND deleted_at IS NULL", lookup, claims.UserID.String()).Count(&count).Error; err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "не удалось проверить авторство"})
				return
			}
			if count == 0 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "редактировать может только автор"})
				return
			}
		}
		// Existing editors may submit an `author` field. Remove it before the
		// model binder sees the request, including case variants accepted by Go.
		if c.Request.Method != http.MethodDelete {
			body, err := io.ReadAll(io.LimitReader(c.Request.Body, (32<<20)+1))
			if err != nil || len(body) > 32<<20 {
				c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": "слишком большой запрос"})
				return
			}
			var object map[string]json.RawMessage
			if json.Unmarshal(body, &object) == nil && object != nil {
				for key := range object {
					if strings.EqualFold(key, "author") {
						delete(object, key)
					}
				}
				body, err = json.Marshal(object)
				if err != nil {
					c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "неверный запрос"})
					return
				}
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(body))
			c.Request.ContentLength = int64(len(body))
		}
		c.Next()
	}
}

func contentEntityAuthor(c *gin.Context, supplied string) string {
	if canManageEntityTags(c) {
		return supplied
	}
	id, err := GetCurrentUserID(c)
	if err != nil {
		return ""
	}
	return id.String()
}

// Image changes are scoped to an existing owned item or spell. The old global
// image-library and paid generation routes stay administrator-only.
func ContentEntityImageMutation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if canManageEntityTags(c) {
			c.Next()
			return
		}
		kind, id := c.PostForm("entity_type"), c.PostForm("entity_id")
		if c.Request.Method == http.MethodDelete {
			kind, id = c.Param("entity_type"), c.Param("entity_id")
		}
		table := map[string]string{"card": "cards", "spell": "spells"}[kind]
		parsed, err := uuid.Parse(id)
		if table == "" || err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "изображение можно менять только у своего предмета или заклинания"})
			return
		}
		userID, err := GetCurrentUserID(c)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
			return
		}
		var count int64
		if err := db.Table(table).Where("id = ? AND author = ? AND deleted_at IS NULL", parsed, userID.String()).Count(&count).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "не удалось проверить авторство"})
			return
		}
		if count == 0 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "редактировать может только автор"})
			return
		}
		c.Next()
	}
}
