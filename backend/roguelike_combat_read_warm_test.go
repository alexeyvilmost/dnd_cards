package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestCombatReadWarmOnlyPublishesOwnedIdleUnacceptedFrame(t *testing.T) {
	var calls atomic.Int32
	hash := "sha256:" + strings.Repeat("1", 64)
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var input map[string]any
		if r.URL.Path != "/prefetch" || r.Header.Get("Authorization") != "Bearer synthetic-read-warm-only-worker-token" || json.NewDecoder(r.Body).Decode(&input) != nil || input["deferPrediction"] != true || input["intent"] != nil {
			t.Error("read warmup executed or predicted a command")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "ready", "trace": map[string]any{"afterHash": hash}})
	}))
	defer worker.Close()
	t.Setenv("RULES_WORKER_URL", worker.URL)
	t.Setenv("RULES_WORKER_TOKEN", "synthetic-read-warm-only-worker-token")
	cache := newCombatRuntimeCache()
	rc := &RoguelikeController{combatCache: cache}
	run := &RoguelikeRun{ID: uuid.New(), UserID: uuid.New(), Revision: 5, Character: &CharacterV3{ID: uuid.New()}, CombatEnvelope: JSONMap{"artifactHash": hash}}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/owned", nil)
	slot, release, err := cache.acquire(c.Request.Context(), run.ID, run.UserID)
	if err != nil {
		t.Fatal(err)
	}
	rc.warmOwnedCombatRead(c, slot, run)
	if calls.Load() != 0 {
		t.Fatal("a leased command slot was warmed")
	}
	release()
	foreign := cloneCachedCombatRun(run)
	foreign.UserID = uuid.New()
	rc.warmOwnedCombatRead(c, slot, foreign)
	if calls.Load() != 0 {
		t.Fatal("foreign owner reused an input slot")
	}
	rc.warmOwnedCombatRead(c, slot, run)
	frame, actualHash := slot.frame()
	if calls.Load() != 1 || frame == nil || frame.ID != run.ID || frame.UserID != run.UserID || frame.Revision != run.Revision || actualHash != hash || slot.pending != nil || slot.receiptRun != nil || slot.commandID != uuid.Nil || slot.requestHash != "" || slot.leases != 0 {
		t.Fatal("read warmup affected acceptance or failed to publish its owned frame")
	}
	frame.Revision++
	slot.setFrame(frame, hash)
	rc.warmOwnedCombatRead(c, slot, run)
	current, _ := slot.frame()
	if calls.Load() != 1 || current.Revision != frame.Revision {
		t.Fatal("stale read replaced a newer command frame")
	}
}

func TestCombatReadWarmFailurePreservesOrdinaryCommandFallback(t *testing.T) {
	for _, fail := range []bool{false, true} {
		worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if fail {
				w.WriteHeader(http.StatusServiceUnavailable)
			} else {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"status":"ready","trace":{"afterHash":"invalid"}}`))
			}
		}))
		t.Setenv("RULES_WORKER_URL", worker.URL)
		t.Setenv("RULES_WORKER_TOKEN", "synthetic-read-warm-only-worker-token")
		cache := newCombatRuntimeCache()
		rc := &RoguelikeController{combatCache: cache}
		run := &RoguelikeRun{ID: uuid.New(), UserID: uuid.New(), Character: &CharacterV3{ID: uuid.New()}, CombatEnvelope: JSONMap{"artifactHash": "sha256:" + strings.Repeat("2", 64)}}
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/owned", nil)
		slot, release, err := cache.acquire(c.Request.Context(), run.ID, run.UserID)
		if err != nil {
			t.Fatal(err)
		}
		release()
		rc.warmOwnedCombatRead(c, slot, run)
		worker.Close()
		frame, hash := slot.frame()
		if frame != nil || hash != "" || slot.failure || slot.pending != nil || slot.leases != 0 {
			t.Fatal("failed optimization poisoned ordinary execution")
		}
	}
}
