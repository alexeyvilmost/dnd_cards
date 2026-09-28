package main

import (
	"context"
	"os"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Read-only snapshot regression: subclass content refers to Bane as an English
// slug while the spell library stores its stable SPELL card number.
func TestRoguelikeCatalogResolvesEnglishSpellSlugFromSnapshot(t *testing.T) {
	dsn := os.Getenv("ROGUELIKE_ALIAS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ROGUELIKE_ALIAS_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	var spell Spell
	if err = db.Select("id", "name", "name_en", "card_number").First(&spell, "card_number = ?", "SPELL-0267").Error; err != nil {
		t.Fatal(err)
	}
	if spell.NameEn == nil || *spell.NameEn != "Bane" {
		t.Fatalf("snapshot alias precondition changed: %#v", spell.NameEn)
	}
	catalog := emptyRoguelikeFrozenCatalog()
	if err = catalog.fulfill(db, roguelikeWorkerNeed{Kind: "entity", EntityType: "spell", Reference: "bane"}); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Entities["spell"]) != 1 || catalog.Entities["spell"][0]["id"] != spell.ID.String() {
		t.Fatalf("English grant_spell slug did not resolve to the library spell: %#v", catalog.Entities["spell"])
	}
}

// Exercises the user's previously failing Urvin encounter without committing
// any run state: initialization only reads the snapshot and calls the worker.
func TestRoguelikeExistingRunCanInitializeCombatReadOnly(t *testing.T) {
	dsn := os.Getenv("ROGUELIKE_ALIAS_TEST_DATABASE_URL")
	runID := os.Getenv("ROGUELIKE_WORKER_INIT_RUN_ID")
	workerURL := os.Getenv("RULES_WORKER_URL")
	token := os.Getenv("RULES_WORKER_TOKEN")
	if dsn == "" || runID == "" || workerURL == "" || token == "" {
		t.Skip("local snapshot run and worker configuration are required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	var run RoguelikeRun
	if err = db.Preload("Character").First(&run, "id = ?", runID).Error; err != nil {
		t.Fatal(err)
	}
	if run.Character == nil || run.Phase != RoguelikePhaseCombat {
		t.Fatalf("expected existing run in combat with its clone loaded; phase=%s character=%v", run.Phase, run.Character != nil)
	}
	run.Character.AccessMode = characterV3AccessOwner
	_, _, err = initializeRoguelikeWorker(context.Background(), db,
		roguelikeWorkerClient{URL: workerURL, Token: token}, &run, "read-only-init-regression", "")
	if err != nil {
		t.Fatal(err)
	}
}
