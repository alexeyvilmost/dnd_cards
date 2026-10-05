package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestInitiativeOptionsAreOwnedReadOnlyAndRevisionBound(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("RULES_INITIATIVE_OPTIONS_ENABLED", "1")
	if err := f.db.AutoMigrate(&Action{}, &RoguelikeRun{}); err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: f.ownerCharacter.ID, CharacterID: f.ownerCharacter.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}, RunSeed: "private-test-seed"}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
	calls := atomic.Int64{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		var input map[string]json.RawMessage
		if err := json.Unmarshal(body["input"], &input); err != nil {
			t.Error(err)
		}
		if _, ok := input["seed"]; ok {
			t.Error("options received entropy")
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := f.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var locked RoguelikeRun
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).First(&locked, "id = ?", run.ID).Error; err != nil {
				return err
			}
			var hero CharacterV3
			return tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).First(&hero, "id = ?", f.ownerCharacter.ID).Error
		}); err != nil {
			t.Errorf("worker under row lock: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ready", "artifactHash": "sha256:" + strings.Repeat("a", 64), "initiativeOptions": []JSONMap{}})
	}))
	defer server.Close()
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("x", 32))
	stamp := func() string {
		var value string
		if err := f.db.Raw("SELECT xmin::text FROM roguelike_runs WHERE id = ?", run.ID).Scan(&value).Error; err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := stamp()
	var persistedBefore CharacterV3
	if err := f.db.First(&persistedBefore, "id = ?", f.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	// PostgreSQL timestamps have microsecond precision; compare the persisted
	// preimage, not the nanosecond-precision object passed to GORM Create.
	if equipmentInputHash(persistedBefore) != equipmentInputHash(f.ownerCharacter) {
		stored, original := map[string]json.RawMessage{}, map[string]json.RawMessage{}
		a, _ := json.Marshal(persistedBefore)
		b, _ := json.Marshal(f.ownerCharacter)
		_ = json.Unmarshal(a, &stored)
		_ = json.Unmarshal(b, &original)
		fields := []string{}
		for key, value := range stored {
			if string(value) != string(original[key]) {
				fields = append(fields, key)
			}
		}
		sort.Strings(fields)
		t.Logf("Fixture fields normalized on initial database write: %v", fields)
	}
	url := fmt.Sprintf("/api/roguelike/runs/%s/initiative-options?expected_revision=%d", run.ID, run.Revision)
	token := f.token(t, f.owner)
	for i := 0; i < 2; i++ {
		result := performCharacterV3Request(t, f.router, "GET", url, token, nil)
		if result.Code != 200 || !strings.Contains(result.Body.String(), `"enabled":true`) {
			t.Fatalf("options status %d", result.Code)
		}
	}
	if stamp() != before {
		t.Fatal("read-only options changed saved run")
	}
	var current CharacterV3
	f.db.First(&current, "id = ?", f.ownerCharacter.ID)
	if equipmentInputHash(current) != equipmentInputHash(persistedBefore) {
		t.Fatal("read-only options changed character")
	}
	if result := performCharacterV3Request(t, f.router, "GET", url, f.token(t, f.other), nil); result.Code != 404 {
		t.Fatalf("foreign options status %d", result.Code)
	}
	if err := f.db.Model(&run).Update("revision", run.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	if result := performCharacterV3Request(t, f.router, "GET", url, token, nil); result.Code != 409 {
		t.Fatalf("stale options status %d", result.Code)
	}
	if calls.Load() != 2 {
		t.Fatal("rejected options reached worker")
	}
	t.Setenv("RULES_INITIATIVE_OPTIONS_ENABLED", "0")
	if result := performCharacterV3Request(t, f.router, "GET", url, token, nil); result.Code != 200 || !strings.Contains(result.Body.String(), `"enabled":false`) {
		t.Fatal("capability rollback unavailable")
	}
}
