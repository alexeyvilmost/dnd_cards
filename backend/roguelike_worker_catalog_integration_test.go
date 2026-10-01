package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRoguelikeCatalogSpellAliasesAreUniqueAndExactReferencesWin(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Spell{}); err != nil {
		t.Fatal(err)
	}
	name := "  Hunter's Mark!  "
	first := Spell{ID: uuid.New(), Name: "Alias test A", NameEn: &name, CardNumber: "ALIAS-EXACT-A"}
	if err := f.db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	catalog := emptyRoguelikeFrozenCatalog()
	if err := catalog.fulfill(f.db, roguelikeWorkerNeed{Kind: "entity", EntityType: "spell", Reference: "  HUNTERS_MARK  "}); err != nil || len(catalog.Entities["spell"]) != 1 || catalog.Entities["spell"][0]["id"] != first.ID.String() {
		t.Fatalf("canonical English slug mismatch: %v", err)
	}
	second := Spell{ID: uuid.New(), Name: "Alias test B", NameEn: &name, CardNumber: "ALIAS-EXACT-B"}
	if err := f.db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	catalog = emptyRoguelikeFrozenCatalog()
	var conflict *roguelikeWorkerRejection
	err := catalog.fulfill(f.db, roguelikeWorkerNeed{Kind: "entity", EntityType: "spell", Reference: "hunters_mark"})
	if !errors.As(err, &conflict) || conflict.Code != "combat_catalog_ambiguous_ref" || len(catalog.Entities["spell"]) != 0 {
		t.Fatalf("ambiguous alias chose arbitrary mechanics: %v", err)
	}
	for _, ref := range []string{second.ID.String(), second.CardNumber} {
		catalog = emptyRoguelikeFrozenCatalog()
		if err = catalog.fulfill(f.db, roguelikeWorkerNeed{Kind: "entity", EntityType: "spell", Reference: ref}); err != nil || len(catalog.Entities["spell"]) != 1 || catalog.Entities["spell"][0]["id"] != second.ID.String() {
			t.Fatalf("exact reference lost to alias: %s %v", ref, err)
		}
	}
}

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

// Exercises a captured encounter without committing any run state. A run file
// permits replaying a fresh production capture against a local catalog snapshot
// without importing its character/run rows into the local database.
func TestRoguelikeExistingRunCanInitializeCombatReadOnly(t *testing.T) {
	dsn := os.Getenv("ROGUELIKE_ALIAS_TEST_DATABASE_URL")
	runID := os.Getenv("ROGUELIKE_WORKER_INIT_RUN_ID")
	runFile := os.Getenv("ROGUELIKE_WORKER_INIT_RUN_FILE")
	workerURL := os.Getenv("RULES_WORKER_URL")
	token := os.Getenv("RULES_WORKER_TOKEN")
	if dsn == "" || (runID == "" && runFile == "") || workerURL == "" || token == "" {
		t.Skip("local snapshot run and worker configuration are required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	readOnly := db.Begin(&sql.TxOptions{ReadOnly: true})
	if readOnly.Error != nil {
		t.Fatal(readOnly.Error)
	}
	defer readOnly.Rollback()
	var run RoguelikeRun
	if runFile != "" {
		captured, readErr := os.ReadFile(runFile)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err = json.Unmarshal(captured, &run); err != nil {
			t.Fatal(err)
		}
	} else {
		if err = readOnly.Preload("Character").First(&run, "id = ?", runID).Error; err != nil {
			t.Fatal(err)
		}
		if roguelikePartySize(&run) > 1 {
			if err = loadRoguelikeParty(readOnly, &run, false); err != nil {
				t.Fatal(err)
			}
		}
	}
	if run.Character == nil || run.Phase != RoguelikePhaseCombat {
		t.Fatalf("expected existing run in combat with its clone loaded; phase=%s character=%v", run.Phase, run.Character != nil)
	}
	run.Character.AccessMode = characterV3AccessOwner
	for _, character := range run.Characters {
		if character == nil {
			t.Fatal("captured party contains a missing character")
		}
		character.AccessMode = characterV3AccessOwner
	}
	result, catalog, err := initializeRoguelikeWorker(context.Background(), readOnly,
		roguelikeWorkerClient{URL: workerURL, Token: token}, &run, "read-only-init-regression", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "ready" || catalog["artifactHash"] == nil {
		t.Fatalf("initialization did not return a ready frozen catalog: status=%s", result.Status)
	}
}

// Camp abilities assemble the complete saved character, including subclass
// spell grants. This exercises that catalog path without committing gameplay.
func TestRoguelikeExistingRunCanHealInCampReadOnly(t *testing.T) {
	dsn := os.Getenv("ROGUELIKE_ALIAS_TEST_DATABASE_URL")
	runID := os.Getenv("ROGUELIKE_WORKER_CAMP_RUN_ID")
	actionID := os.Getenv("ROGUELIKE_WORKER_CAMP_ACTION_ID")
	workerURL, token := os.Getenv("RULES_WORKER_URL"), os.Getenv("RULES_WORKER_TOKEN")
	if dsn == "" || runID == "" || actionID == "" || workerURL == "" || token == "" {
		t.Skip("local camp snapshot and worker configuration are required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	readOnly := db.Begin(&sql.TxOptions{ReadOnly: true})
	if readOnly.Error != nil {
		t.Fatal(readOnly.Error)
	}
	defer readOnly.Rollback()
	var run RoguelikeRun
	if err = readOnly.Preload("Character").First(&run, "id = ?", runID).Error; err != nil {
		t.Fatal(err)
	}
	if run.Character == nil || run.Phase != RoguelikePhaseCamp || run.Character.CurrentHP < 1 {
		t.Fatal("expected a living saved character in camp")
	}
	run.Character.AccessMode = characterV3AccessOwner
	beforeHP, beforeRevision := run.Character.CurrentHP, run.Character.RuntimeRevision
	result, err := executeRoguelikeCampActionWorker(context.Background(), readOnly,
		roguelikeWorkerClient{URL: workerURL, Token: token}, run.Character,
		RoguelikeCommandRequest{CommandID: uuid.New(), Type: "camp_action", Payload: JSONMap{"action_id": actionID, "choices": JSONMap{}}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "ready" {
		t.Fatalf("camp action did not return a ready patch: status=%s", result.Status)
	}
	for _, event := range result.Events {
		kind, _ := event["type"].(string)
		if err = validateCharacterEvent(kind, event); err != nil {
			t.Fatalf("camp journal cannot persist %s: %v", kind, err)
		}
	}
	if err = applyTrustedRoguelikePatch(run.Character, result.Patch); err != nil {
		t.Fatal(err)
	}
	if run.Character.CurrentHP <= beforeHP || run.Character.RuntimeRevision != beforeRevision+1 {
		t.Fatalf("healing projection failed: HP %d -> %d, revision %d -> %d", beforeHP, run.Character.CurrentHP, beforeRevision, run.Character.RuntimeRevision)
	}
	t.Logf("read-only camp healing: HP %d -> %d; revision %d -> %d; goldSpent=%d elapsed=%d events=%d", beforeHP, run.Character.CurrentHP, beforeRevision, run.Character.RuntimeRevision, result.GoldSpent, result.ElapsedSeconds, len(result.Events))
}
