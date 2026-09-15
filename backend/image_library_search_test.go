package main

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestImageLibrarySearchFiltersWholeCatalogBeforePagination(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&ImageLibrary{}); err != nil {
		t.Fatal(err)
	}
	rows := make([]ImageLibrary, 0, 103)
	now := time.Now()
	for i := 0; i < 101; i++ {
		name := fmt.Sprintf("Recent %d", i)
		rows = append(rows, ImageLibrary{CloudinaryID: fmt.Sprint(i), CloudinaryURL: "/fixture.png", CardName: &name, CreatedAt: now})
	}
	name, original := "Скрытый клинок", "unseen-blade.png"
	rows = append(rows, ImageLibrary{CloudinaryID: "old-blade", CloudinaryURL: "/old.png", CardName: &name, OriginalName: &original, CreatedAt: now.Add(-time.Hour)})
	rows = append(rows, ImageLibrary{CloudinaryID: "deleted-blade", CloudinaryURL: "/deleted.png", CardName: &name, DeletedAt: &now, CreatedAt: now})
	if err := f.db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	f.router.GET("/qa/image-library", NewImageLibraryController(f.db).GetImageLibrary)
	for _, query := range []string{"%D0%A1%D0%BA%D1%80%D1%8B%D1%82%D1%8B%D0%B9", "UNSEEN-BLADE"} {
		response := performCharacterV3Request(t, f.router, "GET", "/qa/image-library?limit=1&page=1&search="+query, "", nil)
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
		var result struct {
			Images     []ImageLibrary `json:"images"`
			Pagination struct {
				Total int `json:"total"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Pagination.Total != 1 || len(result.Images) != 1 || result.Images[0].CloudinaryID != "old-blade" {
			t.Fatalf("wrong search result: %+v", result)
		}
	}
}
