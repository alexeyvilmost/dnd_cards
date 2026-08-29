package main

import (
	"bytes"
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

func TestMonsterUpdateUsesEditableProjection(t *testing.T) {
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
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
	schema := "monster_update_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = db.AutoMigrate(&Monster{}); err != nil {
		t.Fatal(err)
	}

	abilities := JSONMap{"str": 8, "dex": 15, "con": 10, "int": 10, "wis": 8, "cha": 8}
	actionIDs := Properties{}
	effectIDs := Properties{}
	ai := JSONMap{"strategy": "melee_chase", "preferred_range_ft": 5}
	support := JSONMap{"status": "verified_partial"}
	monster := Monster{
		ID: uuid.New(), Slug: "goblin-update-test", Name: "Goblin before", Size: "small",
		CreatureType: "goblinoid", ChallengeRating: "1/4", ArmorClass: 15, MaxHP: 10,
		Speed: 30, ProficiencyBonus: 2, Abilities: &abilities, ActionIDs: &actionIDs,
		EffectIDs: &effectIDs, AI: &ai, TokenURL: "https://storage.example/old.png",
		TokenStorageID: "protected-storage-id", Support: &support,
	}
	if err = db.Create(&monster).Error; err != nil {
		t.Fatal(err)
	}

	payload := MonsterUpsertRequest{
		Slug: "goblin-update-test", Name: "Goblin after", Size: "small",
		CreatureType: "goblinoid", ChallengeRating: "1/4", ArmorClass: 16, MaxHP: 12,
		Speed: 30, ProficiencyBonus: 2, Abilities: &abilities, ActionIDs: &actionIDs,
		EffectIDs: &effectIDs, AI: &ai, TokenURL: "https://storage.example/new.png",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/api/monsters/:id", NewMonsterController(db).Update)
	request := httptest.NewRequest(http.MethodPut, "/api/monsters/"+monster.ID.String(), bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("update monster: got %d: %s", response.Code, response.Body.String())
	}

	var stored Monster
	if err = db.First(&stored, "id = ?", monster.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Name != "Goblin after" || stored.ArmorClass != 16 || stored.MaxHP != 12 {
		t.Fatalf("editable fields were not updated: %+v", stored)
	}
	if stored.TokenURL != "https://storage.example/new.png" {
		t.Fatalf("token_url=%q", stored.TokenURL)
	}
	if stored.TokenStorageID != "protected-storage-id" {
		t.Fatalf("token_storage_id=%q", stored.TokenStorageID)
	}
	if stored.Support == nil || (*stored.Support)["status"] != "verified_partial" {
		t.Fatalf("support metadata was not preserved: %#v", stored.Support)
	}
}
