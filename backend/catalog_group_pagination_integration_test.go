package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"dnd-cards-backend/migrations"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type groupedCatalogPage struct {
	Effects []Effect `json:"effects"`
	Feats   []Feat   `json:"feats"`
	Total   int      `json:"total"`
	Page    int      `json:"page"`
	Limit   int      `json:"limit"`
}

func getGroupedCatalogPage(t *testing.T, router *gin.Engine, path string) groupedCatalogPage {
	t.Helper()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, response.Code, response.Body.String())
	}
	var page groupedCatalogPage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func TestFeatCatalogCompletesOriginGroupBeforeLaterCategories(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Feat{}); err != nil {
		t.Fatal(err)
	}
	categories := []FeatCategory{FeatOrigin, FeatGeneral, FeatFightingStyle, FeatEpicBoon, "future-category"}
	counts := []int{12, 23, 8, 5, 2}
	expected := make([][]string, len(categories))
	// Interleave creation, names and UUIDs across categories. Neither a global
	// alphabetical sort nor a global creation sort can produce complete groups.
	for index := 0; index < 23; index++ {
		for categoryIndex, category := range categories {
			if index >= counts[categoryIndex] {
				continue
			}
			id := uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", index*10+categoryIndex+1))
			row := Feat{ID: id, Name: "Shared name", Description: "test", CardNumber: id.String(), Category: category,
				CreatedAt: time.Date(2026, 9, 1, 0, index, 0, 0, time.UTC)}
			if err := db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
			expected[categoryIndex] = append(expected[categoryIndex], id.String())
		}
	}
	router := gin.New()
	router.GET("/feats", NewFeatController(db).GetFeats)
	for _, sortBy := range []string{"name_asc", "created_desc"} {
		t.Run(sortBy, func(t *testing.T) {
			var want []string
			for _, group := range expected {
				if sortBy == "created_desc" {
					for index := len(group) - 1; index >= 0; index-- {
						want = append(want, group[index])
					}
				} else {
					want = append(want, group...)
				}
			}
			var got []string
			for number := 1; number <= 3; number++ {
				path := fmt.Sprintf("/feats?fields=list&limit=20&page=%d&sort_by=%s", number, sortBy)
				page := getGroupedCatalogPage(t, router, path)
				if page.Total != len(want) || page.Page != number || page.Limit != 20 {
					t.Fatalf("pagination metadata: %+v", page)
				}
				originCount := 0
				for _, row := range page.Feats {
					got = append(got, row.ID.String())
					if row.Category == FeatOrigin {
						originCount++
					}
				}
				if number == 1 && originCount != 12 || number > 1 && originCount != 0 {
					t.Fatalf("origin category was incomplete on first page: page %d has %d origin feats", number, originCount)
				}
				if repeated := getGroupedCatalogPage(t, router, path); !reflect.DeepEqual(page, repeated) {
					t.Fatal("repeated request changed the page")
				}
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("category pages are interleaved or unstable: got %v, want %v", got, want)
			}
		})
	}
	filtered := getGroupedCatalogPage(t, router, "/feats?category=origin&fields=list&limit=20")
	if filtered.Total != 12 || len(filtered.Feats) != 12 {
		t.Fatalf("origin filter: %+v", filtered)
	}
}

func TestEffectCatalogGroupsAllTypesBeforePagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Effect{}); err != nil {
		t.Fatal(err)
	}
	types := []EffectType{"condition", "weapon_mastery", "fighting_style", "feat_ability", "item_effect", "spell_effect", "eldritch_invocation", "maneuver_variant", "class_ability", "species_ability", "run_aura", "passive", "conditional", "triggered", "positive_effect", "negative_effect", "future-a", "future-b"}
	expected := make([][]string, len(types))
	for index := 0; index < 13; index++ {
		for typeIndex, kind := range types {
			if typeIndex != 0 && index >= 3 {
				continue
			}
			id := uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", index*100+typeIndex+1))
			row := Effect{ID: id, Name: "Shared name", Description: "test", CardNumber: id.String(), Rarity: RarityCommon, EffectType: kind,
				CreatedAt: time.Date(2026, 9, 1, 0, index, 0, 0, time.UTC)}
			if err := db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
			expected[typeIndex] = append(expected[typeIndex], id.String())
		}
	}
	router := gin.New()
	router.GET("/effects", NewEffectController(db).GetEffects)
	for _, sortBy := range []string{"name_asc", "created_desc"} {
		t.Run(sortBy, func(t *testing.T) {
			var want []string
			for _, group := range expected {
				if sortBy == "created_desc" {
					for index := len(group) - 1; index >= 0; index-- {
						want = append(want, group[index])
					}
				} else {
					want = append(want, group...)
				}
			}
			var got []string
			for number := 1; number <= 4; number++ {
				path := fmt.Sprintf("/effects?fields=list&limit=20&page=%d&sort_by=%s", number, sortBy)
				page := getGroupedCatalogPage(t, router, path)
				if page.Total != len(want) || page.Page != number || page.Limit != 20 {
					t.Fatalf("pagination metadata: %+v", page)
				}
				conditionCount := 0
				for _, row := range page.Effects {
					got = append(got, row.ID.String())
					if row.EffectType == "condition" {
						conditionCount++
					}
				}
				if number == 1 && conditionCount != 13 || number > 1 && conditionCount != 0 {
					t.Fatalf("conditions appeared after their group finished: page %d, count %d", number, conditionCount)
				}
				if repeated := getGroupedCatalogPage(t, router, path); !reflect.DeepEqual(page, repeated) {
					t.Fatal("repeated request changed the page")
				}
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("effect type pages are interleaved or unstable: got %v, want %v", got, want)
			}
		})
	}
	filtered := getGroupedCatalogPage(t, router, "/effects?effect_type=weapon_mastery&fields=list&limit=20")
	if filtered.Total != 3 || len(filtered.Effects) != 3 {
		t.Fatalf("effect type filter: %+v", filtered)
	}
}

func TestEffectCatalogSourceAndLevelFiltersMatchSameReferenceBeforePagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Card{}, &Effect{}, &Class{}, &Race{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations.GetAllMigrations() {
		if migration.Version == "281_entity_references" {
			if err := migration.Up(sqlDB); err != nil {
				t.Fatal(err)
			}
		}
	}
	var first, second []string
	for index := 0; index < 26; index++ {
		id := uuid.New()
		row := Effect{ID: id, Name: fmt.Sprintf("Effect %02d", index), Description: "test", CardNumber: id.String(), Rarity: RarityCommon, EffectType: EffectTypeClassAbility}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if index < 13 {
			first = append(first, id.String())
		} else {
			second = append(second, id.String())
		}
	}
	classID, otherClassID, raceID := uuid.New(), uuid.New(), uuid.New()
	for _, row := range []any{
		&Class{ID: classID, Name: "Fighter", Description: "test", CardNumber: classID.String(), LevelProgression: &JSONMap{
			"3": map[string]any{"effects": first, "choices": []any{map[string]any{"effects": first}}},
			"5": map[string]any{"effects": second}}},
		&Class{ID: otherClassID, Name: "Sorcerer", Description: "test", CardNumber: otherClassID.String(), LevelProgression: &JSONMap{"3": map[string]any{"effects": []string{second[0]}}}},
		&Race{ID: raceID, Name: "Elf", Description: "test", CardNumber: raceID.String(), LevelProgression: &JSONMap{
			"3": map[string]any{"effects": second}, "5": map[string]any{"effects": first}}},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.Use(EntityReferenceResponseMiddleware(db))
	router.GET("/effects", NewEffectController(db).GetEffects)
	for _, test := range []struct {
		name, query string
		want        []string
	}{
		{"class independently", "reference_type=class&reference_id=" + classID.String(), append(append([]string{}, first...), second...)},
		{"race independently", "reference_type=race&reference_id=" + raceID.String(), append(append([]string{}, first...), second...)},
		{"level independently", "reference_level=3", append(append([]string{}, first...), second...)},
		{"class level", "reference_type=class&reference_id=" + classID.String() + "&reference_level=3", first},
		{"race level", "reference_type=race&reference_id=" + raceID.String() + "&reference_level=3", second},
		{"other class", "reference_type=class&reference_id=" + otherClassID.String() + "&reference_level=3", second[:1]},
		{"source id alone", "reference_id=" + otherClassID.String(), second[:1]},
		{"different level on same entity", "reference_id=" + otherClassID.String() + "&reference_level=5", nil},
		{"mismatched kind", "reference_type=race&reference_id=" + classID.String(), nil},
		{"unknown source", "reference_id=" + uuid.NewString(), nil},
		{"no level matches", "reference_level=4", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			var got []string
			for number := 1; number <= len(test.want)/5+1; number++ {
				path := fmt.Sprintf("/effects?fields=list&limit=5&page=%d&%s", number, test.query)
				page := getGroupedCatalogPage(t, router, path)
				if page.Total != len(test.want) {
					t.Fatalf("matching paths duplicated count or filters applied after pagination: got %d, want %d", page.Total, len(test.want))
				}
				for _, row := range page.Effects {
					got = append(got, row.ID.String())
				}
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("source and level did not match the same reference: got %v, want %v", got, test.want)
			}
		})
	}
	for _, level := range []string{"0", "-1", "three", "3.5", "2147483648", "99999999999999999999"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/effects?reference_level="+level, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid level %s returned %d", level, response.Code)
		}
	}
}
