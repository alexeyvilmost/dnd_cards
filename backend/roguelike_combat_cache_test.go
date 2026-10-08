package main

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	computed := make(chan struct{}, 1)
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 2 {
			computed <- struct{}{}
		}
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
	var held atomic.Bool
	if err := f.db.Callback().Create().Before("gorm:create").Register("test:hold-combat-receipt", func(tx *gorm.DB) {
		if tx.Statement.Table == "roguelike_command_receipts" {
			if shouldFail.Load() {
				tx.AddError(errors.New("synthetic persistence failure"))
				return
			}
			if held.CompareAndSwap(false, true) {
				close(blocked)
				<-proceed
			}
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
		c.Params = gin.Params{{Key: "id", Value: run.ID.String()}}
		c.Set("user_id", run.UserID)
		controller.Command(c)
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
	retry := send(request)
	var firstJSON, retryJSON any
	_ = json.Unmarshal(response.Body.Bytes(), &firstJSON)
	_ = json.Unmarshal(retry.Body.Bytes(), &retryJSON)
	if retry.Code != 200 || !reflect.DeepEqual(firstJSON, retryJSON) || calls.Load() != 1 {
		t.Fatal("pending exact retry recomputed or changed the result")
	}
	nextRequest := request
	nextRequest.CommandID = uuid.New()
	nextRequest.ExpectedRevision = 2
	repeated := make(chan *httptest.ResponseRecorder, 1)
	go func() { repeated <- send(nextRequest) }()
	select {
	case <-computed:
	case <-time.After(5 * time.Second):
		t.Fatal("next pure computation waited for previous persistence")
	}
	select {
	case <-repeated:
		t.Fatal("second command bypassed the one-unsaved-command bound")
	case <-time.After(20 * time.Millisecond):
	}
	close(proceed)
	next := <-repeated
	if next.Code != 200 || calls.Load() != 2 {
		t.Fatal("overlap recomputed or failed the next command")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := waitCombatPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	var events, receipts int64
	f.db.Model(&RoguelikeCombatEvent{}).Count(&events)
	f.db.Model(&RoguelikeCommandReceipt{}).Count(&receipts)
	if events != 2 || receipts != 2 {
		t.Fatal("journal and receipt not atomically saved")
	}
	// A failed write rolls back all authoritative rows and blocks a new command
	// until a reload acknowledges the loss of exactly the last command.
	shouldFail.Store(true)
	request.CommandID = uuid.New()
	request.ExpectedRevision = 3
	lost := send(request)
	if lost.Code != 200 {
		t.Fatal("loss-budget command was not acknowledged")
	}
	if err := waitCombatPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	if err := f.db.First(&durable, "id=?", run.ID).Error; err != nil || durable.Revision != 3 {
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
	if err != nil || restored.Revision != 3 {
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
	// A different entity and JSON edge values verify the optimized transient
	// encoder against the persistence encoder, including escaping and numbers.
	otherTurn := JSONMap{"text": "<Герой> & 🐉\u2028", "empty": JSONMap{}, "numbers": []any{1e-9, 1e21, -0.5}, "missing": nil}
	run.Characters = append(run.Characters, &CharacterV3{ID: uuid.New(), TurnState: &otherTurn})
	expected, err := json.Marshal(compactCombatFrame(run))
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/commands", nil)
	c.Request.Header.Set("X-Combat-Wire", combatFrameWire)
	writeCombatRunResponse(c, run)
	var actualValue, expectedValue any
	actualErr := json.Unmarshal(w.Body.Bytes(), &actualValue)
	expectedErr := json.Unmarshal(expected, &expectedValue)
	if w.Code != 200 || actualErr != nil || expectedErr != nil || !reflect.DeepEqual(actualValue, expectedValue) || bytes.Contains(w.Body.Bytes(), []byte("<Герой>")) {
		t.Fatal("optimized combat encoding differs from canonical JSON")
	}
}

func TestCombatCachePreparedInputMustMatchAllProjectionInputs(t *testing.T) {
	var calls atomic.Int32
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"envelope": map[string]any{"state": map[string]any{"fresh": true}}, "patch": map[string]any{"runtime_revision": 7}})
	}))
	defer worker.Close()
	client := roguelikeWorkerClient{URL: worker.URL, Token: strings.Repeat("t", 32)}
	first, second := &CharacterV3{ID: uuid.New(), RuntimeRevision: 2}, &CharacterV3{ID: uuid.New(), RuntimeRevision: 5}
	run := &RoguelikeRun{Character: first, CharacterID: first.ID, Characters: []*CharacterV3{first, second}, CombatEnvelope: JSONMap{"artifactHash": "pin"}}
	slot := &combatCacheSlot{run: run, hash: "base"}
	intent := map[string]any{"type": "action", "actorId": first.ID.String()}
	input, err := json.Marshal(cachedCombatWorkerBody(run, intent, "base"))
	if err != nil {
		t.Fatal(err)
	}
	prepared := &preparedCombatWorker{inputHash: sha256.Sum256(input), result: &roguelikeWorkerResult{Patch: JSONMap{"prepared": true}}}
	ctx := context.WithValue(context.Background(), preparedCombatWorkerKey{}, prepared)
	actual, err := cachedCombatWorkerCall(ctx, client, slot, run, intent)
	if err != nil || actual != prepared.result || calls.Load() != 0 {
		t.Fatal("identical prepared input not reused")
	}
	second.RuntimeRevision++
	actual, err = cachedCombatWorkerCall(ctx, client, slot, run, intent)
	if err != nil || actual == prepared.result || calls.Load() != 1 {
		t.Fatal("changed second participant reused stale computation")
	}
	second.RuntimeRevision--
	intent["type"] = "end_turn"
	actual, err = cachedCombatWorkerCall(ctx, client, slot, run, intent)
	if err != nil || actual == prepared.result || calls.Load() != 2 {
		t.Fatal("changed intent reused stale computation")
	}
	intent["type"] = "action"
	slot.hash = "different-base"
	actual, err = cachedCombatWorkerCall(ctx, client, slot, run, intent)
	if err != nil || actual == prepared.result || calls.Load() != 3 {
		t.Fatal("changed combat frame reused stale computation")
	}
}

func TestCombatCacheDeltaRestoresExactAcknowledgedState(t *testing.T) {
	for _, offset := range []int{1, 16, 64, 65} {
		old := make([]any, 80)
		for i := range old {
			old[i] = i
		}
		next := append(append([]any{}, old[offset:]...), 80)
		delta := &combatStateDelta{}
		wire := compactCombatState(JSONMap{"history": next}, JSONMap{"history": old}, delta)
		if offset <= 64 {
			if len(delta.ArrayPrefixes) != 1 || delta.ArrayPrefixes[0].Offset != offset {
				t.Fatal("sliding history did not reference its exact acknowledged range")
			}
			prefix := delta.ArrayPrefixes[0]
			wire["history"] = append(append([]any{}, old[prefix.Offset:prefix.Offset+prefix.Length]...), wire["history"].([]any)...)
		} else if len(delta.ArrayPrefixes) != 0 {
			t.Fatal("history search exceeded its work bound")
		}
		if !reflect.DeepEqual(wire["history"], next) {
			t.Fatal("sliding history changed canonical rows")
		}
	}
	owner, id, command := uuid.New(), uuid.New(), uuid.New()
	hero, ally := uuid.New(), uuid.New()
	baseState := JSONMap{"world": map[string]any{"actors": map[string]any{hero.String(): map[string]any{"hp": 3, "inventory": []any{1, 2, 3, 4}}, ally.String(): map[string]any{"hp": 5}}, "scene": map[string]any{"round": 1}}, "log": []any{0, 1, 2, 3, 4, 5, 6, 7}, "presentation": map[string]any{"one": strings.Repeat("я", 1000), "two": 2, "three": 3, "four": 4}}
	nextState := JSONMap{"world": map[string]any{"actors": map[string]any{hero.String(): map[string]any{"hp": 2, "inventory": []any{1, 2, 3, 4}}, ally.String(): map[string]any{"hp": 6}}, "scene": map[string]any{"round": 2}}, "log": []any{0, 1, 2, 3, 4, 5, 6, 7, 8}, "presentation": baseState["presentation"]}
	before := &RoguelikeRun{ID: id, UserID: owner, Revision: 2, CombatState: baseState}
	next := &RoguelikeRun{ID: id, UserID: owner, Revision: 3, CombatState: nextState}
	for _, mode := range []string{"delta", "wrong-command", "foreign-owner", "legacy"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/commands", nil)
		c.Request.Header.Set("X-Combat-Wire", combatDeltaWire)
		c.Request.Header.Set("X-Combat-Base", command.String())
		base := cloneCachedCombatRun(before)
		c.Set("combat_wire_base_command_id", command.String())
		if mode == "wrong-command" {
			c.Request.Header.Set("X-Combat-Base", uuid.New().String())
		}
		if mode == "foreign-owner" {
			base.UserID = uuid.New()
		}
		if mode == "legacy" {
			c.Request.Header.Set("X-Combat-Wire", combatFrameWire)
		}
		c.Set("combat_wire_base_run", base)
		writeCombatRunResponse(c, next)
		var wire struct {
			Run struct {
				CombatState map[string]any `json:"combat_state"`
			} `json:"run"`
			Delta *combatStateDelta `json:"state_delta"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &wire); err != nil || w.Code != 200 {
			t.Fatal("invalid delta response")
		}
		var canonicalBase, expected map[string]any
		_ = json.Unmarshal(mirrorTestJSON(t, baseState), &canonicalBase)
		_ = json.Unmarshal(mirrorTestJSON(t, nextState), &expected)
		if mode == "delta" {
			if wire.Delta == nil || len(wire.Delta.References) == 0 || len(wire.Delta.ArrayPrefixes) != 1 || wire.Delta.BaseCommandID != command.String() {
				t.Fatal("exact unchanged fields/history not referenced")
			}
			parent := func(root map[string]any, path []string) map[string]any {
				for _, key := range path[:len(path)-1] {
					root = root[key].(map[string]any)
				}
				return root
			}
			for _, path := range wire.Delta.References {
				target, source := parent(wire.Run.CombatState, path), parent(canonicalBase, path)
				target[path[len(path)-1]] = source[path[len(path)-1]]
			}
			for _, prefix := range wire.Delta.ArrayPrefixes {
				target, source := parent(wire.Run.CombatState, prefix.Path), parent(canonicalBase, prefix.Path)
				key := prefix.Path[len(prefix.Path)-1]
				target[key] = append(source[key].([]any)[prefix.Offset:prefix.Offset+prefix.Length], target[key].([]any)...)
			}
		} else if wire.Delta != nil {
			t.Fatal("foreign/legacy/missing command base received delta")
		}
		if !reflect.DeepEqual(wire.Run.CombatState, expected) {
			t.Fatal("delta changed canonical state")
		}
	}
	if len(baseState["log"].([]any)) != 8 || nextState["world"].(map[string]any)["actors"].(map[string]any)[hero.String()].(map[string]any)["hp"] != 2 {
		t.Fatal("wire mutated acknowledged inputs")
	}
}
