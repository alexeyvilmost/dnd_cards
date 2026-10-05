package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

// This dedicated gate receives only the checked-in synthetic corpus from the
// owned stand. It deliberately bypasses character creation to test persisted
// continuation transactions; the real creation path has its own browser gate.
func TestSoloDurableContinuationsActualWorkerReceipts(t *testing.T) {
	directory, file := os.Getenv("TEST_RUN_DIRECTORY"), os.Getenv("SOLO_DURABLE_CASES_FILE")
	if directory == "" || file == "" {
		t.Fatal("owned durable-continuation gate is required")
	}
	relative, err := filepath.Rel(directory, file)
	if err != nil || filepath.IsAbs(relative) || strings.HasPrefix(relative, "..") {
		t.Fatal("corpus must belong to this stand")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		ArtifactHash string `json:"artifactHash"`
		Cases        []struct {
			ID                string   `json:"id"`
			Phases            []string `json:"phases"`
			State             JSONMap  `json:"state"`
			Intent            JSONMap  `json:"intent"`
			ExpectedRejection bool     `json:"expectedRejection"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(data, &corpus); err != nil || len(corpus.Cases) != 222 || !strings.HasPrefix(corpus.ArtifactHash, "sha256:") {
		t.Fatal("invalid required corpus")
	}
	upstream, err := url.Parse(os.Getenv("TEST_WORKER_ORIGIN"))
	if err != nil || upstream.Hostname() != "127.0.0.1" || upstream.Port() == "" || upstream.Scheme != "http" {
		t.Fatal("owned loopback worker required")
	}
	token := os.Getenv("TEST_WORKER_TOKEN")
	if token == "" {
		t.Fatal("owned worker authentication required")
	}
	var calls atomic.Int64
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); proxy.ServeHTTP(w, r) }))
	t.Cleanup(server.Close)
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", token)
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err = f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &RoguelikeCombatEvent{}, &FrozenCombatCatalog{}); err != nil {
		t.Fatal(err)
	}
	registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
	auth := f.token(t, f.owner)
	coverage := map[string]int{}
	accepted, rejected := 0, 0
	for _, row := range corpus.Cases {
		t.Run(row.ID, func(t *testing.T) {
			leader, ok := row.State["characterId"].(string)
			if !ok {
				t.Fatal("missing controlled leader")
			}
			controlled := []string{leader}
			if ids, ok := row.State["controlledCharacterIds"].([]any); ok {
				controlled = nil
				for _, id := range ids {
					controlled = append(controlled, id.(string))
				}
			}
			remap := map[string]string{}
			for _, id := range controlled {
				remap[id] = uuid.NewString()
			}
			var replace func(any) any
			replace = func(value any) any {
				switch current := value.(type) {
				case string:
					if id, ok := remap[current]; ok {
						return id
					}
					// Cross-actor influence identifiers are explicitly owner-qualified.
					// Preserve that binding when giving the synthetic sheets SQL UUIDs.
					for owner, id := range remap {
						if strings.HasPrefix(current, owner+"::") {
							return id + strings.TrimPrefix(current, owner)
						}
					}
					return current
				case []any:
					result := make([]any, len(current))
					for i, v := range current {
						result[i] = replace(v)
					}
					return result
				case map[string]any:
					result := map[string]any{}
					for k, v := range current {
						key := k
						if id, ok := remap[k]; ok {
							key = id
						}
						result[key] = replace(v)
					}
					return result
				case JSONMap:
					return replace(map[string]any(current))
				default:
					return value
				}
			}
			state := JSONMap(replace(row.State).(map[string]any))
			intent := JSONMap(replace(row.Intent).(map[string]any))
			characters := []*CharacterV3{}
			actors := state["world"].(map[string]any)["actors"].(map[string]any)
			for _, id := range controlled {
				hero := testCharacterV3(f.owner.ID, "Synthetic durable continuation")
				hero.ID = uuid.MustParse(remap[id])
				hero.CharacterType = "dungeon_crawl"
				runtime := actors[hero.ID.String()].(map[string]any)["runtime"].(map[string]any)
				hp := runtime["hp"].(map[string]any)
				hero.CurrentHP = int(hp["current"].(float64))
				hero.MaxHP = int(hp["max"].(float64))
				if err = f.db.Create(&hero).Error; err != nil {
					t.Fatal(err)
				}
				characters = append(characters, &hero)
			}
			envelope := JSONMap{"schemaVersion": 1, "artifactHash": corpus.ArtifactHash, "entropy": JSONMap{"seed": "durable-owned-synthetic", "cursor": 0}, "state": state}
			run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: uuid.MustParse(remap[leader]), CharacterID: uuid.MustParse(remap[leader]), Status: "active", Phase: "combat", Revision: 1, RunSeed: "synthetic-durable", CombatEnvelope: envelope, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}, Party: JSONMap{}}
			if len(characters) > 1 {
				members := []roguelikePartyMember{}
				for _, hero := range characters {
					members = append(members, roguelikePartyMember{CharacterID: hero.ID, SourceCharacterID: hero.ID})
				}
				run.Party = JSONMap{"members": members}
			}
			if err = f.db.Create(&run).Error; err != nil {
				t.Fatal(err)
			}
			request := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "combat_intent", Payload: JSONMap{"intent": intent}}
			body, _ := json.Marshal(request)
			send := func() *httptest.ResponseRecorder {
				req := httptest.NewRequest("POST", "/api/roguelike/runs/"+run.ID.String()+"/commands", bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", "Bearer "+auth)
				response := httptest.NewRecorder()
				f.router.ServeHTTP(response, req)
				return response
			}
			snapshot := func() any {
				var stored RoguelikeRun
				var receipts []RoguelikeCommandReceipt
				var events []RoguelikeCombatEvent
				if err = f.db.First(&stored, "id = ?", run.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err = f.db.Where("run_id = ?", run.ID).Order("id").Find(&receipts).Error; err != nil {
					t.Fatal(err)
				}
				if err = f.db.Where("run_id = ?", run.ID).Order("id").Find(&events).Error; err != nil {
					t.Fatal(err)
				}
				sheets := []CharacterV3{}
				for _, hero := range characters {
					var sheet CharacterV3
					if err = f.db.First(&sheet, "id = ?", hero.ID).Error; err != nil {
						t.Fatal(err)
					}
					sheets = append(sheets, sheet)
				}
				return []any{stored, sheets, receipts, events}
			}
			before := snapshot()
			first := send()
			if row.ExpectedRejection {
				if first.Code != 409 {
					t.Fatalf("expected boundary rejection, HTTP %d", first.Code)
				}
				if !reflect.DeepEqual(snapshot(), before) {
					t.Fatal("rejection changed persisted state")
				}
				rejected++
				return
			}
			if first.Code != 200 {
				var failure struct {
					Code string `json:"code"`
				}
				_ = json.Unmarshal(first.Body.Bytes(), &failure)
				t.Fatalf("continuation returned HTTP %d code=%s", first.Code, failure.Code)
			}
			committed := snapshot()
			if reflect.DeepEqual(committed, before) {
				t.Fatal("accepted continuation was not committed")
			}
			atRetry := calls.Load()
			retry := send()
			if retry.Code != 200 {
				t.Fatalf("retry HTTP %d", retry.Code)
			}
			var a, b any
			_ = json.Unmarshal(first.Body.Bytes(), &a)
			_ = json.Unmarshal(retry.Body.Bytes(), &b)
			if !reflect.DeepEqual(a, b) || !reflect.DeepEqual(snapshot(), committed) || calls.Load() != atRetry {
				t.Fatal("duplicate changed response, database, or invoked worker")
			}
			// Recreate the route/controller after reloading SQL rows. The separate
			// corpus test restarts the executable; this verifies durable receipt lookup.
			f.router = characterV3Router(f.auth, NewCharacterV3Controller(f.db))
			registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
			retried := send()
			var c any
			_ = json.Unmarshal(retried.Body.Bytes(), &c)
			if retried.Code != 200 || !reflect.DeepEqual(a, c) || !reflect.DeepEqual(snapshot(), committed) || calls.Load() != atRetry {
				t.Fatal("reloaded controller lost accepted receipt")
			}
			var count int64
			if err = f.db.Model(&RoguelikeCommandReceipt{}).Where("run_id = ? AND command_id = ?", run.ID, request.CommandID).Count(&count).Error; err != nil || count != 1 {
				t.Fatal("expected one durable command receipt")
			}
			accepted++
			for _, phase := range row.Phases {
				coverage[phase]++
			}
		})
	}
	if accepted != 220 || rejected != 2 || len(coverage) != 17 {
		t.Fatalf("incomplete durable matrix: accepted=%d rejected=%d phases=%d", accepted, rejected, len(coverage))
	}
	if t.Failed() {
		return
	}
	report, _ := json.Marshal(map[string]any{"status": "passed", "cases": len(corpus.Cases), "accepted": accepted, "boundaryRejections": rejected, "acceptedPhases": coverage, "artifactHash": corpus.ArtifactHash, "workerRequests": calls.Load(), "receiptReplaysPerAcceptedCase": 2})
	if err = os.WriteFile(filepath.Join(directory, "solo-durable-receipts.json"), report, 0600); err != nil {
		t.Fatal(err)
	}
}
