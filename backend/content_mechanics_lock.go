package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// isContentMechanicsLocked intentionally trusts only the durable DB marker.
// The certification API is solely responsible for proving that the marker was
// created from complete current evidence; ordinary CRUD must fail closed once
// it is present.
func isContentMechanicsLocked(support *JSONMap) bool {
	if support == nil {
		return false
	}
	return isContentMechanicsLockedValue(*support)
}

func isContentMechanicsLockedValue(support any) bool {
	var locked any
	switch value := support.(type) {
	case JSONMap:
		locked = value["mechanics_locked"]
	case map[string]any:
		locked = value["mechanics_locked"]
	default:
		return false
	}
	flag, ok := locked.(bool)
	return ok && flag
}

func rejectLockedContentMutation(c *gin.Context, support *JSONMap) bool {
	if !isContentMechanicsLocked(support) {
		return false
	}
	c.JSON(http.StatusLocked, gin.H{
		"error": "Механика сущности закреплена полной тестовой сертификацией и недоступна для изменения",
		"code":  "content_mechanics_locked",
	})
	return true
}
