package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type catalogPageResponse struct {
	Resources []ResourceDefinition `json:"resources"`
	Variables []Variable           `json:"variables"`
	Concepts  []ConceptEntity      `json:"concepts"`
	Total     int64                `json:"total"`
	Page      int                  `json:"page"`
	Limit     int                  `json:"limit"`
}

func openCatalogPaginationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if strings.TrimSpace(dsn) == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}
	quiet := &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	}
	admin, err := gorm.Open(postgres.Open(dsn), quiet)
	if err != nil {
		t.Fatal(err)
	}
	schema := "catalog_pagination_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = admin.Exec(fmt.Sprintf("CREATE SCHEMA %s", schema)).Error; err != nil {
		t.Fatal(err)
	}
	isolatedDSN, err := characterV3SchemaDSN(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(isolatedDSN), quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)).Error
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
		if sqlDB, dbErr := admin.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	if err = db.AutoMigrate(&ResourceDefinition{}, &Variable{}, &ConceptEntity{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func decodeCatalogPage(t *testing.T, recorder *httptest.ResponseRecorder) catalogPageResponse {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response catalogPageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestReferenceCatalogsUseStablePagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openCatalogPaginationTestDB(t)

	resources := []ResourceDefinition{
		{ResourceID: "class-first", Name: "First", Category: "class", SortOrder: 1},
		{ResourceID: "class-second", Name: "Second", Category: "class", SortOrder: 2},
		{ResourceID: "character-only", Name: "Character", Category: "character", SortOrder: 1},
	}
	variables := []Variable{
		{VariableID: "dice-first", Name: "First die", VarType: "dice", SortOrder: 1},
		{VariableID: "dice-second", Name: "Second die", VarType: "dice", SortOrder: 2},
		{VariableID: "number-only", Name: "Number", VarType: "number", SortOrder: 1},
	}
	concepts := []ConceptEntity{
		{ConceptID: "first-concept", Name: "First concept", SortOrder: 1},
		{ConceptID: "second-concept", Name: "Second concept", SortOrder: 2},
		{ConceptID: "third-concept", Name: "Third concept", SortOrder: 3},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&variables).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&concepts).Error; err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	router.GET("/resources", NewResourceController(db).GetResources)
	router.GET("/variables", NewVariableController(db).GetVariables)
	router.GET("/concepts", NewConceptController(db).GetConcepts)
	defaultResourceRecorder := httptest.NewRecorder()
	router.ServeHTTP(defaultResourceRecorder, httptest.NewRequest(http.MethodGet, "/resources", nil))
	defaultResourcePage := decodeCatalogPage(t, defaultResourceRecorder)
	if defaultResourcePage.Total != 3 || defaultResourcePage.Page != 1 ||
		defaultResourcePage.Limit != 3 || len(defaultResourcePage.Resources) != 3 {
		t.Fatalf("default resource catalog no longer returns the complete small catalog: %#v", defaultResourcePage)
	}

	resourceRecorder := httptest.NewRecorder()
	router.ServeHTTP(resourceRecorder, httptest.NewRequest(
		http.MethodGet, "/resources?category=class&page=2&limit=1", nil,
	))
	resourcePage := decodeCatalogPage(t, resourceRecorder)
	if resourcePage.Total != 2 || resourcePage.Page != 2 || resourcePage.Limit != 1 ||
		len(resourcePage.Resources) != 1 || resourcePage.Resources[0].ResourceID != "class-second" {
		t.Fatalf("unexpected resource page: %#v", resourcePage)
	}
	hugePageRecorder := httptest.NewRecorder()
	router.ServeHTTP(hugePageRecorder, httptest.NewRequest(
		http.MethodGet, "/resources?page=9999999999999&limit=1", nil,
	))
	hugePage := decodeCatalogPage(t, hugePageRecorder)
	if hugePage.Page != maxListPage || hugePage.Limit != 1 || len(hugePage.Resources) != 0 {
		t.Fatalf("resource page overflow guard is not stable: %#v", hugePage)
	}

	variableRecorder := httptest.NewRecorder()
	router.ServeHTTP(variableRecorder, httptest.NewRequest(
		http.MethodGet, "/variables?var_type=dice&page=2&limit=1", nil,
	))
	variablePage := decodeCatalogPage(t, variableRecorder)
	if variablePage.Total != 2 || variablePage.Page != 2 || variablePage.Limit != 1 ||
		len(variablePage.Variables) != 1 || variablePage.Variables[0].VariableID != "dice-second" {
		t.Fatalf("unexpected variable page: %#v", variablePage)
	}

	defaultVariableRecorder := httptest.NewRecorder()
	router.ServeHTTP(defaultVariableRecorder, httptest.NewRequest(http.MethodGet, "/variables", nil))
	defaultVariablePage := decodeCatalogPage(t, defaultVariableRecorder)
	if defaultVariablePage.Total != 3 || defaultVariablePage.Page != 1 ||
		defaultVariablePage.Limit != 3 || len(defaultVariablePage.Variables) != 3 {
		t.Fatalf("default variable catalog no longer returns the complete small catalog: %#v", defaultVariablePage)
	}

	conceptRecorder := httptest.NewRecorder()
	router.ServeHTTP(conceptRecorder, httptest.NewRequest(
		http.MethodGet, "/concepts?page=2&limit=1", nil,
	))
	conceptPage := decodeCatalogPage(t, conceptRecorder)
	if conceptPage.Total != 3 || conceptPage.Page != 2 || conceptPage.Limit != 1 ||
		len(conceptPage.Concepts) != 1 || conceptPage.Concepts[0].ConceptID != "second-concept" {
		t.Fatalf("unexpected concept page: %#v", conceptPage)
	}

	defaultConceptRecorder := httptest.NewRecorder()
	router.ServeHTTP(defaultConceptRecorder, httptest.NewRequest(http.MethodGet, "/concepts", nil))
	defaultConceptPage := decodeCatalogPage(t, defaultConceptRecorder)
	if defaultConceptPage.Total != 3 || defaultConceptPage.Page != 1 ||
		defaultConceptPage.Limit != 3 || len(defaultConceptPage.Concepts) != 3 {
		t.Fatalf("default concept catalog no longer returns the complete glossary: %#v", defaultConceptPage)
	}
}
