package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Real PostgreSQL and normal command/receipt HTTP; only the worker computation
// is controlled. Hold a completed result while a second connection commits a
// semantic change. An accepted transport result is not a commit authorization.
func TestInitializationPreparationCommitRaces(t *testing.T) {
	for _, size := range []int{1, 2, 6} {
		for _, mutation := range []string{"none", "effect-content", "effect-membership", "basic-membership", "owner-policy", "process-policy", "character-input", "party-member-input", "run-input", "unrelated-content"} {
			t.Run(fmt.Sprintf("party%d/%s", size, mutation), func(t *testing.T) {
				f := openCharacterV3AccessFixture(t)
				t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
				t.Setenv("RULES_PREPARATION_CACHE_ENABLED", "0")
				t.Setenv("RULES_CATALOG_BATCH_ENABLED", "1")
				t.Setenv("DB_FROZEN_CATALOGS", "0")
				t.Setenv("CONTENT_ADMIN_USER_IDS", "")
				if err := f.db.AutoMigrate(&Action{}, &Effect{}, &Variable{}, &RoguelikeRun{}, &RoguelikeCommandReceipt{}, &RoguelikeCombatEvent{}); err != nil {
					t.Fatal(err)
				}
				kind, otherKind, basic := "qa-init-owned-effects", "qa-init-unrelated", "basic"
				effect := Effect{ID: uuid.New(), CardNumber: "QA-init-owned-" + uuid.NewString(), Name: "owned declaration", Type: &kind}
				unrelated := Effect{ID: uuid.New(), CardNumber: "QA-init-unrelated-" + uuid.NewString(), Name: "unrelated declaration", Type: &otherKind}
				for _, row := range []*Effect{&effect, &unrelated} {
					if err := f.db.Create(row).Error; err != nil {
						t.Fatal(err)
					}
				}
				characters := []*CharacterV3{&f.ownerCharacter}
				for i := 1; i < size; i++ {
					c := testCharacterV3(f.owner.ID, "other data actor")
					if err := f.db.Create(&c).Error; err != nil {
						t.Fatal(err)
					}
					characters = append(characters, &c)
				}
				members := []roguelikePartyMember{}
				for _, c := range characters {
					members = append(members, roguelikePartyMember{CharacterID: c.ID, SourceCharacterID: c.ID})
				}
				run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: characters[0].ID, CharacterID: characters[0].ID, Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat, Revision: 1, RunSeed: "private-initialization-race", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
				if size > 1 {
					run.Party = JSONMap{"members": members}
				}
				if err := f.db.Create(&run).Error; err != nil {
					t.Fatal(err)
				}
				entered, release := make(chan struct{}, 1), make(chan struct{})
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					var body struct {
						Input struct {
							Character  CharacterV3            `json:"character"`
							Characters []CharacterV3          `json:"characters"`
							Catalog    roguelikeFrozenCatalog `json:"catalog"`
							Seed       string                 `json:"seed"`
						} `json:"input"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						w.WriteHeader(500)
						return
					}
					artifact := "sha256:" + strings.Repeat("a", 64)
					needs := []roguelikeWorkerNeed{{Kind: "effect_type", EffectType: kind}, {Kind: "variables"}}
					if !body.Input.Catalog.VariablesComplete {
						json.NewEncoder(w).Encode(map[string]any{"status": "needs_content", "needs": needs, "artifactHash": artifact})
						return
					}
					ctx, cancel := context.WithTimeout(context.Background(), time.Second)
					defer cancel()
					if err := f.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
						var current RoguelikeRun
						if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).First(&current, "id = ?", run.ID).Error; err != nil {
							return err
						}
						for _, c := range characters {
							var current CharacterV3
							if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).First(&current, "id = ?", c.ID).Error; err != nil {
								return err
							}
						}
						return nil
					}); err != nil {
						t.Errorf("worker under write lock: %v", err)
					}
					selection := &roguelikeCatalogSelection{Version: 1, Variables: true, EffectTypes: []string{kind}, Reads: needs}
					for entityKind, rows := range body.Input.Catalog.Entities {
						for _, row := range rows {
							selection.Entities = append(selection.Entities, struct {
								EntityType string `json:"entityType"`
								ID         string `json:"id"`
							}{EntityType: entityKind, ID: row["id"].(string)})
						}
					}
					hash, err := workerCatalogHash(body.Input.Catalog)
					if err != nil {
						t.Error(err)
						w.WriteHeader(500)
						return
					}
					patch := func(c CharacterV3) JSONMap {
						return JSONMap{"current_hp": c.CurrentHP - 1, "runtime_revision": c.RuntimeRevision + 1}
					}
					patches := map[string]JSONMap{}
					for _, c := range body.Input.Characters {
						patches[c.ID.String()] = patch(c)
					}
					result := map[string]any{"status": "ready", "artifactHash": artifact, "catalogSelection": selection, "contentManifestHash": hash, "patch": patch(body.Input.Character), "patches": patches, "envelope": JSONMap{"artifactHash": artifact, "entropy": JSONMap{"seed": body.Input.Seed, "cursor": 1}, "state": JSONMap{"outcome": "active"}}, "trace": JSONMap{"afterHash": "sha256:" + strings.Repeat("b", 64), "runtimeRevision": body.Input.Character.RuntimeRevision + 1}, "randomValues": []float64{0.25}}
					encoded, err := json.Marshal(result)
					if err != nil {
						t.Error(err)
						w.WriteHeader(500)
						return
					}
					entered <- struct{}{}
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
					w.Header().Set("Content-Type", "application/json")
					w.Write(encoded)
				}))
				defer server.Close()
				defer func() {
					select {
					case <-release:
					default:
						close(release)
					}
				}()
				t.Setenv("RULES_WORKER_URL", server.URL)
				t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("q", 32))
				registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
				request := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "initialize_combat", Payload: JSONMap{}}
				url, token := "/api/roguelike/runs/"+run.ID.String()+"/commands", f.token(t, f.owner)
				done := make(chan *httptest.ResponseRecorder, 1)
				go func() { done <- performCharacterV3Request(t, f.router, "POST", url, token, request) }()
				select {
				case <-entered:
				case response := <-done:
					t.Fatalf("request ended before controlled result: status%d", response.Code)
				case <-time.After(10 * time.Second):
					t.Fatal("worker barrier timeout")
				}
				var err error
				switch mutation {
				case "effect-content":
					err = f.db.Model(&effect).Update("name", "changed consumed declaration").Error
				case "effect-membership":
					err = f.db.Create(&Effect{ID: uuid.New(), CardNumber: "QA-init-new-" + uuid.NewString(), Name: "new member", Type: &kind}).Error
				case "basic-membership":
					err = f.db.Create(&Action{ID: uuid.New(), CardNumber: "QA-init-basic-" + uuid.NewString(), Name: "new basic", Type: &basic}).Error
				case "owner-policy":
					err = f.db.Model(&f.owner).Update("is_admin", true).Error
				case "process-policy":
					t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
				case "character-input":
					err = f.db.Model(characters[0]).Update("abilities", JSONMap{"str": 17}).Error
				case "party-member-input":
					err = f.db.Model(characters[len(characters)-1]).Update("resources", JSONMap{"declared_pool": 0}).Error
				case "run-input":
					err = f.db.Model(&run).Update("encounter", JSONMap{"map_id": "changed-current-input"}).Error
				case "unrelated-content":
					err = f.db.Model(&unrelated).Update("name", "unrelated update").Error
				}
				if err != nil {
					t.Fatal(err)
				}
				snapshot := func() string {
					current, e := ownedRoguelikeRun(f.db, run.ID, f.owner.ID, false)
					if e != nil {
						t.Fatal(e)
					}
					return equipmentInputHash(current)
				}
				before := snapshot()
				close(release)
				var response *httptest.ResponseRecorder
				select {
				case response = <-done:
				case <-time.After(10 * time.Second):
					t.Fatal("commit completion timeout")
				}
				if mutation != "none" && mutation != "unrelated-content" {
					if response.Code != 409 || !strings.Contains(response.Body.String(), "initialization_inputs_stale") {
						t.Fatalf("stale prepared command accepted/wrong rejection: %d %s", response.Code, response.Body.String())
					}
					if snapshot() != before {
						t.Fatal("rejection changed authoritative run/characters/entropy")
					}
					for _, model := range []any{&RoguelikeCommandReceipt{}, &RoguelikeCombatEvent{}} {
						var n int64
						if err := f.db.Model(model).Where("run_id = ?", run.ID).Count(&n).Error; err != nil || n != 0 {
							t.Fatal("rejection wrote receipt/history")
						}
					}
				} else {
					if response.Code != 200 {
						t.Fatalf("valid preparation refused: %d %s", response.Code, response.Body.String())
					}
					accepted, oldCalls := snapshot(), calls.Load()
					retry := performCharacterV3Request(t, f.router, "POST", url, token, request)
					var a, b any
					json.Unmarshal(response.Body.Bytes(), &a)
					json.Unmarshal(retry.Body.Bytes(), &b)
					if retry.Code != 200 || equipmentInputHash(a) != equipmentInputHash(b) || snapshot() != accepted || calls.Load() != oldCalls {
						t.Fatal("exact accepted retry changed state/response or repeated worker")
					}
				}
			})
		}
	}
}
