package main

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
)

func reviewRequest(t *testing.T, router *gin.Engine, path string) map[string]json.RawMessage {
	t.Helper()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCatalogReviewPaginationAndNormalization(t *testing.T) {
	db := openCatalogPaginationTestDB(t)
	for index, status := range []string{"verified", "verified_mechanical", "untested", "known_mismatch", "verified_narrative", "partial", "unknown", ""} {
		support := JSONMap{"status": status}
		row := ResourceDefinition{ResourceID: string(rune('a' + index)), Name: "Needle %", Category: "class", Support: &support, SortOrder: index}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	other := ResourceDefinition{ResourceID: "other", Name: "Other", Category: "character"}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	deleted := ResourceDefinition{ResourceID: "deleted", Name: "Needle %", Category: "class"}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE resources SET deleted_at=NOW() WHERE id=?", deleted.ID).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/resources", NewResourceController(db).GetResources)
	base := "/resources?fields=list&category=class&search=%25&review_summary=true&review_status=verified&limit=1"
	var firstID string
	for page, expectedID := range []string{"a", "b"} {
		response := reviewRequest(t, router, base+"&page="+string(rune('1'+page)))
		var total int
		_ = json.Unmarshal(response["total"], &total)
		var rows []ResourceDefinition
		_ = json.Unmarshal(response["resources"], &rows)
		var summary catalogReviewSummary
		_ = json.Unmarshal(response["review_summary"], &summary)
		if total != 2 || len(rows) != 1 || rows[0].ResourceID != expectedID {
			t.Fatalf("wrong page %s", response)
		}
		if summary.Total != 8 || len(summary.Counts) != 8 || summary.Counts["verified"] != 2 || summary.Counts["not_tested"] != 1 || summary.Counts["narrative"] != 1 || summary.Counts["not_verified"] != 4 {
			t.Fatalf("wrong normalized full counts %#v", summary)
		}
		if page == 0 {
			firstID = rows[0].ID.String()
		}
	}
	if err := db.Exec(`UPDATE resources SET support='{"status":"narrative"}'::jsonb WHERE id=?`, firstID).Error; err != nil {
		t.Fatal(err)
	}
	response := reviewRequest(t, router, base+"&page=1")
	var summary catalogReviewSummary
	_ = json.Unmarshal(response["review_summary"], &summary)
	if summary.Counts["verified"] != 1 || summary.Counts["narrative"] != 2 {
		t.Fatalf("stale summary %#v", summary)
	}
	legacy := reviewRequest(t, router, "/resources")
	if _, exists := legacy["review_summary"]; exists {
		t.Fatal("changed unrequested response")
	}
	for _, query := range []string{"review_status=garbage", "review_summary=1", "review_status=verified%27"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/resources?"+query, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("accepted invalid query %s: %d", query, response.Code)
		}
	}
}

func TestCatalogReviewSummaryUsesItemPermissions(t *testing.T) {
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"Player's Handbook", "HiddenSource"} {
		support := JSONMap{"status": "verified"}
		row := Card{Name: "Private boundary", CardNumber: source, Source: &source, Rarity: "common", Support: &support}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.GET("/cards", NewCardController(db).GetCards)
	response := reviewRequest(t, router, "/cards?fields=list&review_summary=true&review_status=verified&page=1&limit=1")
	var summary catalogReviewSummary
	_ = json.Unmarshal(response["review_summary"], &summary)
	var total int
	_ = json.Unmarshal(response["total"], &total)
	if total != 1 || summary.Total != 1 || summary.Counts["verified"] != 1 {
		t.Fatalf("private row leaked: %s", response)
	}
}
