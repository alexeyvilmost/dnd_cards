package main

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type catalogReviewSummary struct {
	Total  int64            `json:"total"`
	Counts map[string]int64 `json:"counts"`
}

// The SQL projection matches normalizeSupportStatus in the canonical UI. It
// reads saved review metadata; listing never certifies or modifies an entity.
func catalogReviewStatusSQL(table string) string {
	statuses := make([]string, 0, len(validContentReviewStatuses))
	for status := range validContentReviewStatuses {
		statuses = append(statuses, "'"+status+"'")
	}
	sort.Strings(statuses)
	column := table + ".support->>'status'"
	return "CASE WHEN " + column + " IN (" + strings.Join(statuses, ",") + ") THEN " + column +
		" WHEN " + column + " = 'verified_mechanical' THEN 'verified'" +
		" WHEN " + column + " = 'verified_narrative' THEN 'narrative'" +
		" WHEN " + column + " = 'untested' THEN 'not_tested' ELSE 'not_verified' END"
}

// Call after the endpoint's permission/search/tag filters and before its
// pagination. Reusing that exact query prevents a parallel visibility policy.
func applyCatalogReview(query *gorm.DB, c *gin.Context, table string) (*gorm.DB, bool) {
	raw, summary := c.Query("review_status"), c.Query("review_summary")
	if raw == "" && (summary == "" || summary == "false") {
		return query, true
	}
	known := false
	for _, allowed := range contentReviewTables {
		if table == allowed {
			known = true
			break
		}
	}
	if !known || table == "passive_presentations" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Неизвестный каталог"})
		return query, false
	}
	if len(raw) > 1024 || (summary != "" && summary != "true" && summary != "false") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные параметры статусов проверки"})
		return query, false
	}
	selected := make([]string, 0)
	if raw != "" {
		for _, status := range strings.Split(raw, ",") {
			if !validContentReviewStatuses[status] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Неизвестный статус проверки"})
				return query, false
			}
			selected = append(selected, status)
		}
	}
	expression := catalogReviewStatusSQL(table)
	if summary == "true" {
		var groups []struct {
			Status string
			Count  int64
		}
		// A fresh session clones the statement: grouping must not leak into the
		// page query, and one joined entity contributes to exactly one count.
		if err := query.Session(&gorm.Session{}).Select(expression + " AS status, COUNT(DISTINCT " + table + ".id) AS count").
			Group(expression).Scan(&groups).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось получить статистику проверки"})
			return query, false
		}
		result := catalogReviewSummary{Counts: make(map[string]int64, len(validContentReviewStatuses))}
		for status := range validContentReviewStatuses {
			result.Counts[status] = 0
		}
		for _, group := range groups {
			result.Counts[group.Status] += group.Count
			result.Total += group.Count
		}
		c.Set("catalogReviewSummary", result)
	}
	if len(selected) > 0 {
		query = query.Where("("+expression+") IN ?", selected)
	}
	return query, true
}

func catalogReviewResponse(c *gin.Context, response gin.H) gin.H {
	if summary, exists := c.Get("catalogReviewSummary"); exists {
		response["review_summary"] = summary
	}
	return response
}

// Reference catalogs previously searched these presentation fields in the
// browser. Keep literal substring semantics when moving that work before SQL
// pagination; a percent sign or underscore is ordinary user text.
func referenceCatalogSearch(query *gorm.DB, c *gin.Context, columns string) *gorm.DB {
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		return query.Where("strpos(lower(concat_ws(' ', "+columns+")), lower(?)) > 0", search)
	}
	return query
}
