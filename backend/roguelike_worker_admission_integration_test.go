package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

// The executor response is controlled, but HTTP, PostgreSQL transactions,
// receipts, runtime revisions, seed/clock and duplicate recovery are real.
func TestWorkerAdmissionRollbackAndReceiptRecovery(t *testing.T) {
	t.Setenv("RULES_WORKER_MAX_INFLIGHT", "1")
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &CharacterEvent{}, &Action{}); err != nil {
		t.Fatal(err)
	}
	character := f.ownerCharacter
	character.CharacterType = "dungeon_crawl"
	character.CurrentHP = 4
	if err := f.db.Omit("User", "Group").Save(&character).Error; err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: character.ID, CharacterID: character.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Revision: 1, GameClockHours: 9, Supplies: 1,
		RunSeed: "owned-admission-seed", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	var actualCalls atomic.Int32
	var fail atomic.Bool
	entered, unblock := make(chan struct{}, 1), make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/hold" {
			entered <- struct{}{}
			<-unblock
			fmt.Fprint(w, `{"patch":{"current_hp":4},"envelope":{"test":true}}`)
			return
		}
		actualCalls.Add(1)
		if fail.Load() {
			w.WriteHeader(500)
			return
		}
		var body struct {
			Input struct {
				Character CharacterV3 `json:"character"`
			} `json:"input"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid worker request")
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ready", "elapsedSeconds": 6, "patch": JSONMap{"current_hp": 7, "runtime_revision": body.Input.Character.RuntimeRevision + 1}})
	}))
	defer server.Close()
	// Unblock cleanup even if an assertion fails with a request still in flight.
	defer func() {
		select {
		case unblock <- struct{}{}:
		default:
		}
	}()
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("w", 32))
	registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
	endpoint, token := "/api/roguelike/runs/"+run.ID.String()+"/commands", f.token(t, f.owner)
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "camp_turn", Payload: JSONMap{}}
	snapshot := func() *RoguelikeRun {
		t.Helper()
		stored, err := ownedRoguelikeRun(f.db, run.ID, f.owner.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		return stored
	}
	before := snapshot()
	assertUnchanged := func() {
		t.Helper()
		if !reflect.DeepEqual(before, snapshot()) {
			t.Fatal("rejected request changed run, resources, RNG, or runtime")
		}
		var count int64
		if err := f.db.Model(&RoguelikeCommandReceipt{}).Where("run_id = ?", run.ID).Count(&count).Error; err != nil || count != 0 {
			t.Fatal("rejected request wrote a receipt")
		}
	}
	client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("w", 32)}
	hold := func() chan error {
		done := make(chan error, 1)
		go func() { _, err := client.call(context.Background(), "/hold", JSONMap{}); done <- err }()
		admissionWait(t, entered)
		return done
	}
	done := hold()
	busy := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	if busy.Code != 409 || !strings.Contains(busy.Body.String(), "combat_worker_busy") || actualCalls.Load() != 0 {
		t.Fatalf("overload status %d or worker call unexpected", busy.Code)
	}
	assertUnchanged()
	unblock <- struct{}{}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	fail.Store(true)
	failed := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	if failed.Code != 409 {
		t.Fatalf("worker failure status %d", failed.Code)
	}
	assertUnchanged()
	fail.Store(false)
	accepted := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	if accepted.Code != 200 {
		t.Fatalf("same command after capacity recovery status %d", accepted.Code)
	}
	committed := snapshot()
	if committed.Revision != 2 || committed.Character.RuntimeRevision != character.RuntimeRevision+1 || committed.RunSeed != before.RunSeed || committed.Character.CurrentHP != 7 {
		t.Fatal("accepted command did not commit exactly once")
	}
	done = hold()
	replay := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	var original, duplicate any
	if json.Unmarshal(accepted.Body.Bytes(), &original) != nil || json.Unmarshal(replay.Body.Bytes(), &duplicate) != nil || replay.Code != 200 || !reflect.DeepEqual(original, duplicate) || actualCalls.Load() != 2 || !reflect.DeepEqual(committed, snapshot()) {
		t.Fatal("receipt recovery called saturated worker or changed result")
	}
	unblock <- struct{}{}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
