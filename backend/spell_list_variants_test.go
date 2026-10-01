package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestSpellListRetainsOnlyVariantParentMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Spell{}); err != nil {
		t.Fatal(err)
	}

	detailedDescription := strings.Repeat("Detailed spell description. ", 1000)
	authoringPayload := strings.Repeat("Heavy authoring payload. ", 1000)
	rows := make([]Spell, 0, 4)
	parents := make(map[uuid.UUID]string)
	for family := 1; family <= 2; family++ {
		parentID := uuid.New()
		childID := uuid.New()
		parentMechanics := JSONMap{
			"spell_variant_ids": []interface{}{childID.String()},
			"effects":           []interface{}{map[string]interface{}{"kind": "narrative", "description": authoringPayload}},
		}
		childMechanics := JSONMap{
			"variant_of_spell_id": parentID.String(),
			"effects":             []interface{}{map[string]interface{}{"kind": "healing", "amount": float64(family + 2)}},
			"authoring_payload":   authoringPayload,
		}
		rows = append(rows,
			Spell{ID: parentID, Name: fmt.Sprintf("Family %d", family), Description: "Parent spell",
				CardNumber: fmt.Sprintf("SPELL-LIST-PARENT-%d", family), Level: family,
				DetailedDescription: &detailedDescription, Mechanics: &parentMechanics,
				ImageURL:           "data:image/png;base64," + strings.Repeat("AAAA", 1000),
				ImageCloudinaryURL: "https://example.invalid/parent.png"},
			Spell{ID: childID, Name: fmt.Sprintf("Family %d: variant", family), Description: "Chosen effect",
				CardNumber: fmt.Sprintf("SPELL-LIST-CHILD-%d", family), Level: family,
				DetailedDescription: &detailedDescription, Mechanics: &childMechanics,
				ImageURL:           "data:image/png;base64," + strings.Repeat("BBBB", 1000),
				ImageCloudinaryURL: "https://example.invalid/child.png"},
		)
		parents[childID] = parentID.String()
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	controller := NewSpellController(db)
	router := gin.New()
	router.GET("/spells", controller.GetSpells)
	router.GET("/spells/:id", controller.GetSpell)
	seen := make(map[uuid.UUID]bool)
	for page := 1; page <= len(rows); page++ {
		recorder := httptest.NewRecorder()
		path := fmt.Sprintf("/spells?fields=list&limit=1&page=%d", page)
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s returned %d: %s", path, recorder.Code, recorder.Body.String())
		}
		var response struct {
			Spells []SpellResponse `json:"spells"`
			Total  int64           `json:"total"`
			Page   int             `json:"page"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Total != int64(len(rows)) || response.Page != page || len(response.Spells) != 1 {
			t.Fatalf("unexpected pagination: %#v", response)
		}
		spell := response.Spells[0]
		if seen[spell.ID] {
			t.Fatalf("spell %s occurred on more than one page", spell.ID)
		}
		seen[spell.ID] = true
		if spell.DetailedDescription != nil || strings.HasPrefix(spell.ImageURL, "data:") {
			t.Fatalf("heavy fields leaked into list projection for %s", spell.ID)
		}
		if parentID, isVariant := parents[spell.ID]; isVariant {
			want := JSONMap{"variant_of_spell_id": parentID}
			if spell.Mechanics == nil || !reflect.DeepEqual(*spell.Mechanics, want) {
				t.Fatalf("variant metadata = %#v, want %#v", spell.Mechanics, want)
			}
		} else if spell.Mechanics != nil {
			t.Fatalf("ordinary spell mechanics leaked into list projection: %#v", spell.Mechanics)
		}
	}
	for _, row := range rows {
		if !seen[row.ID] {
			t.Fatalf("spell %s is missing from paginated list", row.ID)
		}
		if _, isVariant := parents[row.ID]; !isVariant {
			continue
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/spells/"+row.ID.String(), nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("detail returned %d: %s", recorder.Code, recorder.Body.String())
		}
		var detail SpellResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &detail); err != nil {
			t.Fatal(err)
		}
		if detail.Mechanics == nil || !reflect.DeepEqual(*detail.Mechanics, *row.Mechanics) {
			t.Fatalf("detail mechanics changed for %s", row.ID)
		}
		if detail.DetailedDescription == nil || *detail.DetailedDescription != detailedDescription {
			t.Fatalf("detail description changed for %s", row.ID)
		}
	}
}
