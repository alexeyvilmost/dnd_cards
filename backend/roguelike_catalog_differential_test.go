package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The driver provisions these synthetic runs through the real API in its owned
// disposable DB. Both resolvers read one repeatable-read snapshot and execute
// the same worker bytes/seed. No normalization of game fields is permitted.
func TestCatalogBatchActualWorkerEquivalentForOwnedFixtures(t *testing.T) {
	raw, dsn := os.Getenv("PERFORMANCE_CATALOG_RUN_IDS"), os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if raw == "" || dsn == "" || os.Getenv("RULES_WORKER_URL") == "" {
		t.Skip("owned performance stand and run IDs required")
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil || len(ids) != 3 {
		t.Fatal("expected three owned party fixtures")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	for _, id := range ids {
		if _, err := uuid.Parse(id); err != nil {
			t.Fatal("invalid fixture ID")
		}
		tx := db.Begin(&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
		if tx.Error != nil {
			t.Fatal(tx.Error)
		}
		func() {
			defer tx.Rollback()
			var run RoguelikeRun
			if err := tx.Preload("Character").First(&run, "id = ?", id).Error; err != nil {
				t.Fatal(err)
			}
			if roguelikePartySize(&run) > 1 {
				if err := loadRoguelikeParty(tx, &run, false); err != nil {
					t.Fatal(err)
				}
			}
			if run.Character == nil || run.Phase != RoguelikePhaseCombat {
				t.Fatal("fixture is not a fresh encounter")
			}
			run.Character.AccessMode = characterV3AccessOwner
			for _, character := range run.Characters {
				character.AccessMode = characterV3AccessOwner
			}
			var previous *roguelikeWorkerResult
			var previousCatalog JSONMap
			for _, mode := range []string{"0", "1"} {
				t.Setenv("RULES_CATALOG_BATCH_ENABLED", mode)
				result, catalog, err := initializeRoguelikeWorker(context.Background(), tx, client, &run, "catalog-batch-fixed-seed", "")
				if err != nil || result.Status != "ready" {
					t.Fatalf("worker initialize failed: %v", err)
				}
				if mode == "0" {
					previous, previousCatalog = result, catalog
				} else if !reflect.DeepEqual(previous, result) || !reflect.DeepEqual(previousCatalog, catalog) {
					t.Fatal("batch changed actual worker outcome, RNG, pins or canonical catalog")
				}
			}
			for _, operation := range []string{"rest", "inventory", "camp_turn"} {
				for _, mode := range []string{"0", "1"} {
					t.Setenv("RULES_CATALOG_BATCH_ENABLED", mode)
					var result *roguelikeWorkerResult
					var err error
					if operation == "camp_turn" {
						result, err = executeSeededRoguelikeCampActionWorker(context.Background(), tx, client, run.Character, RoguelikeCommandRequest{CommandID: uuid.MustParse("00000000-0000-4000-8000-000000000001"), Type: "camp_turn", Payload: JSONMap{}}, "catalog-batch-camp-seed", run.Characters...)
					} else if operation == "rest" {
						result, err = executeRoguelikeRestWorker(context.Background(), tx, client, &run, RoguelikeCommandRequest{Type: "short_rest", Payload: JSONMap{"preserve_preparation": true}})
					} else {
						result, err = executeRoguelikeCampInventoryWorker(context.Background(), tx, client, run.Character, map[string]any{"placement": map[string]any{"equipment": run.Character.Equipment, "inventoryItems": run.Character.InventoryItems}})
					}
					if err != nil || result.Status != "ready" {
						t.Fatalf("worker %s failed: %v", operation, err)
					}
					if mode == "0" {
						previous = result
					} else if !reflect.DeepEqual(previous, result) {
						t.Fatalf("batch changed actual worker %s outcome", operation)
					}
				}
			}
		}()
	}
}
