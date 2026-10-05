package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestPreparationCatalogActualWorkerColdWarmAndEvictedEquality(t *testing.T) {
	raw, dsn := os.Getenv("PERFORMANCE_PREPARATION_FIXTURES"), os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if raw == "" || dsn == "" || os.Getenv("RULES_WORKER_URL") == "" {
		t.Skip("owned preparation stand and fixtures required")
	}
	var fixtures []struct {
		CharacterID string   `json:"characterId"`
		CardIDs     []string `json:"cardIds"`
	}
	if err := json.Unmarshal([]byte(raw), &fixtures); err != nil || len(fixtures) != 2 {
		t.Fatal("expected two owned fixtures")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	t.Setenv("RULES_CATALOG_BATCH_ENABLED", "1")
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	aliasName, exactName := "Owned Alias "+suffix, "Owned Exact "+suffix
	alias, exact := "owned_alias_"+suffix, "owned_exact_"+suffix
	empty := JSONMap{}
	spells := []Spell{
		{ID: uuid.New(), Name: "Alias A", NameEn: &aliasName, CardNumber: "QA-A-" + suffix, Mechanics: &empty},
		{ID: uuid.New(), Name: "Alias B", NameEn: &aliasName, CardNumber: "QA-B-" + suffix, Mechanics: &empty},
		{ID: uuid.New(), Name: "Prior UUID", NameEn: &exactName, CardNumber: "QA-C-" + suffix, Mechanics: &empty},
		{ID: uuid.New(), Name: "Exact Winner", CardNumber: exact, Mechanics: &empty},
	}
	for i := range spells {
		if err := db.Create(&spells[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for fixtureIndex, fixture := range fixtures {
		tx := db.Begin(&sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		func() {
			defer tx.Rollback()
			var character CharacterV3
			if err := tx.First(&character, "id = ?", fixture.CharacterID).Error; err != nil {
				t.Fatal(err)
			}
			if err := equipmentOwner(tx, character.UserID, character); err != nil {
				t.Fatal(err)
			}
			for _, cardID := range fixture.CardIDs {
				extra := map[string]any{"commandId": uuid.NewString(), "seed": "owned-cache-differential-seed", "operation": map[string]string{"equip": cardID}}
				var baseline, newCold *roguelikeWorkerResult
				for _, mode := range []string{"legacy", "cold", "warm", "evicted", "prefetch"} {
					t.Setenv("RULES_CATALOG_PREFETCH_ENABLED", "0")
					if mode == "prefetch" {
						t.Setenv("RULES_CATALOG_PREFETCH_ENABLED", "1")
					}
					if mode == "legacy" {
						t.Setenv("RULES_PREPARATION_CACHE_ENABLED", "0")
					} else {
						t.Setenv("RULES_PREPARATION_CACHE_ENABLED", "1")
					}
					if mode == "cold" || mode == "evicted" || mode == "prefetch" {
						characterPreparationCatalogs = newPreparationCatalogLRU(8<<20, 128)
					}
					trace := &requestPerformance{values: map[string]float64{}}
					ctx := context.WithValue(context.Background(), performanceContextKey{}, trace)
					result, _, err := prepareCharacterWorker(ctx, tx.WithContext(ctx), client, "/equipment", character.UserID, character, extra)
					if err != nil {
						t.Fatalf("fixture %d, %s preparation failed: %v", fixtureIndex, mode, err)
					}
					if result.Status != "ready" {
						t.Fatal("preparation not ready")
					}
					if mode == "legacy" {
						baseline = result
						continue
					}
					if result.CatalogSelection == nil {
						t.Fatal("worker lacks consumed-catalog contract")
					}
					if !reflect.DeepEqual(result.PreparedCommand, baseline.PreparedCommand) || !reflect.DeepEqual(result.RandomValues, baseline.RandomValues) || result.ArtifactHash != baseline.ArtifactHash {
						t.Fatal("canonical preparation changed full command, RNG or artifact")
					}
					if mode == "cold" {
						newCold = result
					} else if !reflect.DeepEqual(result, newCold) {
						t.Fatal("cold/warm/evicted changed full worker result")
					}
					metrics := trace.snapshot()
					if mode == "warm" && (metrics["worker_calls"] != 1 || metrics["preparation_cache_hit"] != 1) {
						t.Fatalf("cache did not remove waterfall: calls=%v hits=%v", metrics["worker_calls"], metrics["preparation_cache_hit"])
					}
				}
			}
			if fixtureIndex == 0 {
				extra := map[string]any{"commandId": uuid.NewString(), "seed": "owned-cache-alias-proof", "operation": map[string]string{"equip": fixture.CardIDs[0]}}
				for _, check := range []struct {
					prior, reference string
					ambiguous        bool
				}{{spells[0].ID.String(), alias, true}, {spells[2].ID.String(), exact, false}} {
					characterPreparationCatalogs = newPreparationCatalogLRU(8<<20, 128)
					prior := Properties{check.prior}
					character.SpellIDs = &prior
					if _, _, err := prepareCharacterWorker(context.Background(), tx, client, "/equipment", character.UserID, character, extra); err != nil {
						t.Fatalf("UUID proof fixture failed: %v", err)
					}
					changed := Properties{check.reference}
					character.SpellIDs = &changed
					warm, _, warmErr := prepareCharacterWorker(context.Background(), tx, client, "/equipment", character.UserID, character, extra)
					characterPreparationCatalogs = newPreparationCatalogLRU(8<<20, 128)
					cold, _, coldErr := prepareCharacterWorker(context.Background(), tx, client, "/equipment", character.UserID, character, extra)
					if check.ambiguous {
						var warmRejection, coldRejection *roguelikeWorkerRejection
						if !errors.As(warmErr, &warmRejection) || !errors.As(coldErr, &coldRejection) || warmRejection.Code != "combat_catalog_ambiguous_ref" || coldRejection.Code != warmRejection.Code {
							t.Fatalf("new alias selector bypassed exact membership: warm=%v cold=%v", warmErr, coldErr)
						}
					} else if warmErr != nil || coldErr != nil || !reflect.DeepEqual(warm, cold) {
						t.Fatalf("new exact selector lost precedence: warm=%v cold=%v", warmErr, coldErr)
					}
				}
			}
		}()
	}
}
