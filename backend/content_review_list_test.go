package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestManualContentReviewListProjectionsPreserveSavedStatus(t *testing.T) {
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Monster{}); err != nil {
		t.Fatal(err)
	}
	resourceReview := JSONMap{"status": "verified_partial", "reviewed_by": "resource-reviewer"}
	variableReview := JSONMap{"status": "not_verified", "reviewed_by": "variable-reviewer"}
	conceptReview := JSONMap{"status": "narrative", "reviewed_by": "concept-reviewer"}
	monsterReview := JSONMap{"status": "partial_narrative_verified", "reviewed_by": "monster-reviewer"}
	for _, entity := range []any{
		&ResourceDefinition{ResourceID: "review-resource", Name: "Reviewed resource", Support: &resourceReview},
		&Variable{VariableID: "review-variable", Name: "Reviewed variable", Support: &variableReview},
		&ConceptEntity{ConceptID: "review-concept", Name: "Reviewed concept", Support: &conceptReview},
		&Monster{Slug: "review-monster", Name: "Reviewed monster", Support: &monsterReview},
	} {
		if err := db.Create(entity).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.GET("/resources", NewResourceController(db).GetResources)
	router.GET("/variables", NewVariableController(db).GetVariables)
	router.GET("/concepts", NewConceptController(db).GetConcepts)
	router.GET("/monsters", NewMonsterController(db).List)
	for collection, expected := range map[string]JSONMap{
		"resources": resourceReview, "variables": variableReview,
		"concepts": conceptReview, "monsters": monsterReview,
	} {
		for _, fields := range []string{"list", "full"} {
			t.Run(collection+"/"+fields, func(t *testing.T) {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/"+collection+"?fields="+fields+"&page=1&limit=20", nil))
				if response.Code != http.StatusOK {
					t.Fatalf("list failed: %d %s", response.Code, response.Body.String())
				}
				var page map[string]json.RawMessage
				if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
					t.Fatal(err)
				}
				var entities []struct {
					Support JSONMap `json:"support"`
				}
				if err := json.Unmarshal(page[collection], &entities); err != nil || len(entities) != 1 {
					t.Fatalf("unexpected list: %s (%v)", response.Body.String(), err)
				}
				if entities[0].Support["status"] != expected["status"] || entities[0].Support["reviewed_by"] != expected["reviewed_by"] {
					t.Fatalf("saved review omitted or changed by projection: %#v", entities[0].Support)
				}
			})
		}
	}
}
