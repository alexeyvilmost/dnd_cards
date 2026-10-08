package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestCombatCacheAsyncCommitRetryFailureAndLossBound(t *testing.T) {
	t.Setenv("RULES_COMBAT_ASYNC_PERSIST_ENABLED", "1")
	t.Setenv("DB_COMPACT_RECEIPTS", "1")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &RoguelikeCombatEvent{}); err != nil {
		t.Fatal(err)
	}
	hash := "sha256:" + strings.Repeat("1", 64)
	state := map[string]any{"outcome": "active", "characterId": f.ownerCharacter.ID.String()}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, CharacterID: f.ownerCharacter.ID, SourceCharacterID: f.ownerCharacter.ID, Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat, RunSeed: "owned-async-test", Attempt: 1, Revision: 1, Party: JSONMap{}, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}, CombatCatalog: JSONMap{}, CombatEnvelope: JSONMap{"artifactHash": hash, "entropy": map[string]any{"seed": "synthetic"}, "state": state}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Character CharacterV3 `json:"character"`
			Envelope  JSONMap     `json:"envelope"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(422)
			return
		}
		revision := body.Character.RuntimeRevision + 1
		next := map[string]any{"outcome": "active", "characterId": body.Character.ID.String(), "runtimeRevision": revision, "world": map[string]any{"synthetic": revision}}
		result := map[string]any{"envelope": map[string]any{"artifactHash": hash, "entropy": map[string]any{"seed": "synthetic"}, "state": next}, "patch": map[string]any{"runtime_revision": revision, "turn_state": map[string]any{"solo_combat_v1": next}}, "trace": map[string]any{"beforeHash": hash, "afterHash": hash, "runtimeRevision": revision}}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}))
	defer worker.Close()
	t.Setenv("RULES_WORKER_URL", worker.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("t", 32))
	controller := NewRoguelikeController(f.db)
	blocked, proceed := make(chan struct{}), make(chan struct{})
	var shouldFail atomic.Bool
	if err := f.db.Callback().Create().Before("gorm:create").Register("test:hold-combat-receipt", func(tx *gorm.DB) {
		if tx.Statement.Table == "roguelike_command_receipts" {
			if shouldFail.Load() {
				tx.AddError(errors.New("synthetic persistence failure"))
				return
			}
			close(blocked)
			<-proceed
		}
	}); err != nil {
		t.Fatal(err)
	}
	request := RoguelikeCommandRequest{CommandID: uuid.New(), Type: "combat_intent", ExpectedRevision: 1, Payload: JSONMap{"intent": map[string]any{"type": "test"}}}
	send := func(request RoguelikeCommandRequest) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(request)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(raw))
		slot, release, err := controller.combatCache.acquire(c.Request.Context(), run.ID, run.UserID)
		if err != nil {
			writeRoguelikeError(c, err)
			return w
		}
		defer release()
		sum, _ := roguelikeCommandRequestHash(request)
		controller.cachedCombatCommand(c, slot, run.ID, run.UserID, request, sum)
		return w
	}
	response := send(request)
	if response.Code != 200 || response.Header().Get("X-Combat-Persistence") != "background" {
		t.Fatal("command waited for persistence or rejected")
	}
	select {
	case <-blocked:
	case <-time.After(5 * time.Second):
		t.Fatal("background writer did not reach receipt")
	}
	sum, _ := roguelikeCommandRequestHash(request)
	if replay, background, err := controller.combatCache.replay(run.ID, run.UserID, request.CommandID, sum); err != nil || replay == nil || replay.Revision != 2 || !background {
		t.Fatal("retry did not return the acknowledged pending frame")
	}
	if foreign, _, err := controller.combatCache.replay(run.ID, f.other.ID, request.CommandID, sum); err != nil || foreign != nil {
		t.Fatal("retry crossed owner boundary")
	}
	var durable RoguelikeRun
	if err := f.db.First(&durable, "id=?", run.ID).Error; err != nil || durable.Revision != 1 {
		t.Fatal("partial transaction became visible")
	}
	repeated := make(chan *httptest.ResponseRecorder, 1)
	go func() { repeated <- send(request) }()
	select {
	case <-repeated:
		t.Fatal("second command bypassed the one-unsaved-command bound")
	case <-time.After(20 * time.Millisecond):
	}
	close(proceed)
	retry := <-repeated
	var firstJSON, retryJSON any
	_ = json.Unmarshal(response.Body.Bytes(), &firstJSON)
	_ = json.Unmarshal(retry.Body.Bytes(), &retryJSON)
	if retry.Code != 200 || !reflect.DeepEqual(firstJSON, retryJSON) || calls.Load() != 1 {
		t.Fatal("exact retry recomputed or changed the accepted result")
	}
	var events, receipts int64
	f.db.Model(&RoguelikeCombatEvent{}).Count(&events)
	f.db.Model(&RoguelikeCommandReceipt{}).Count(&receipts)
	if events != 1 || receipts != 1 {
		t.Fatal("journal and receipt not atomically saved")
	}
	// A failed write rolls back all authoritative rows and blocks a new command
	// until a reload acknowledges the loss of exactly the last command.
	shouldFail.Store(true)
	request.CommandID = uuid.New()
	request.ExpectedRevision = 2
	lost := send(request)
	if lost.Code != 200 {
		t.Fatal("loss-budget command was not acknowledged")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := waitCombatPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	if err := f.db.First(&durable, "id=?", run.ID).Error; err != nil || durable.Revision != 2 {
		t.Fatal("failed background command leaked a partial update")
	}
	blockedResponse := send(request)
	if blockedResponse.Code != 503 {
		t.Fatal("failure did not block the next command")
	}
	controller.combatCache.acknowledgeReload(run.ID, run.UserID)
	slot, release, err := controller.combatCache.acquire(ctx, run.ID, run.UserID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	restored, err := slot.load(f.db, run.ID, run.UserID, false)
	if err != nil || restored.Revision != 2 {
		t.Fatal("reload did not restore the last durable frame")
	}
}

func TestCombatCacheWirePreservesDifferencesAndPrivateState(t *testing.T) {
	id := uuid.New()
	world := map[string]any{"actors": map[string]any{"test": true}}
	snapshot := map[string]any{"world": world, "actionPresentation": map[string]any{"image": "sheet"}}
	turn := JSONMap{"solo_combat_v1": snapshot}
	character := &CharacterV3{ID: id, TurnState: &turn}
	run := &RoguelikeRun{CharacterID: id, Character: character, Characters: []*CharacterV3{character}, CombatState: JSONMap{"world": world, "actionPresentation": map[string]any{"image": "state"}}, CombatEnvelope: JSONMap{"private_entropy": "must-not-appear"}, CombatCatalog: JSONMap{"private": "must-not-appear"}}
	frame := compactCombatFrame(run)
	raw, err := json.Marshal(frame)
	if err != nil || bytes.Contains(raw, []byte("must-not-appear")) || frame.Run.Character != nil || frame.LeaderIndex == nil || !reflect.DeepEqual(frame.Mirrors, []string{"world"}) {
		t.Fatal("wire disclosed private data or lost references")
	}
	if frame.Snapshot["actionPresentation"].(map[string]any)["image"] != "sheet" {
		t.Fatal("presentation difference overwritten")
	}
	if _, exists := (*character.TurnState)["solo_combat_v1"]; !exists {
		t.Fatal("compaction mutated published frame")
	}
}
