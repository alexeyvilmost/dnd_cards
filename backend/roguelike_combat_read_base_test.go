package main

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCombatReadBaseNegotiationDoesNotAcceptACommand(t *testing.T) {
	t.Setenv("RULES_COMBAT_ASYNC_PERSIST_ENABLED", "1")
	for _, negotiation := range []string{"", combatFrameWire, combatDeltaWire, combatSnapshotDeltaWire} {
		cache := newCombatRuntimeCache()
		rc := &RoguelikeController{combatCache: cache}
		run := &RoguelikeRun{ID: uuid.New(), UserID: uuid.New(), Revision: 7, Phase: RoguelikePhaseCombat, Status: RoguelikeStatusActive, CombatState: JSONMap{"world": map[string]any{"scene": map[string]any{"round": 2}}}}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/owned", nil)
		c.Request.Header.Set("X-Combat-Wire", negotiation)
		rc.writeCombatReadResponse(c, run)
		if w.Code != http.StatusOK {
			t.Fatal("Read failed")
		}
		token := w.Header().Get("X-Combat-Read-Base")
		if negotiation != combatDeltaWire && negotiation != combatSnapshotDeltaWire {
			if token != "" || len(cache.slots) != 0 {
				t.Fatal("Unnegotiated read seeded a base")
			}
			continue
		}
		id, err := uuid.Parse(strings.TrimPrefix(token, "read:"))
		if err != nil || id == uuid.Nil {
			t.Fatal("Invalid read token")
		}
		if _, err := uuid.Parse(token); err == nil {
			t.Fatal("A read token can be confused with a command UUID")
		}
		slot := cache.slots[combatCacheKey(run.ID, run.UserID)]
		if slot == nil || slot.readBase == nil || slot.readBaseID != token || slot.readBase.ID != run.ID || slot.readBase.UserID != run.UserID || slot.readBase.Revision != run.Revision {
			t.Fatal("Read base not bound to owner and revision")
		}
		if slot.commandID != uuid.Nil || slot.requestHash != "" || slot.receiptRun != nil || slot.pending != nil || slot.leases != 0 {
			t.Fatal("Read token affected command acceptance")
		}
	}
}

func TestCombatReadBaseGetChecksOwnerBeforeSeeding(t *testing.T) {
	t.Setenv("RULES_COMBAT_ASYNC_PERSIST_ENABLED", "1")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &RoguelikeCombatEvent{}); err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, CharacterID: f.ownerCharacter.ID, SourceCharacterID: f.ownerCharacter.ID, Revision: 7, Phase: RoguelikePhaseCombat, Status: RoguelikeStatusActive, RunSeed: "owned-read-test", Party: JSONMap{}, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}, CombatCatalog: JSONMap{}, CombatEnvelope: JSONMap{"artifactHash": "private-marker-not-public", "state": map[string]any{"outcome": "active", "characterId": f.ownerCharacter.ID.String(), "world": map[string]any{"scene": map[string]any{"round": 2}}}}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	rc := NewRoguelikeController(f.db)
	read := func(owner uuid.UUID) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/owned", nil)
		c.Request.Header.Set("X-Combat-Wire", combatDeltaWire)
		c.Set("user_id", owner)
		c.Params = gin.Params{{Key: "id", Value: run.ID.String()}}
		rc.Get(c)
		return w
	}
	owned := read(f.owner.ID)
	if owned.Code != http.StatusOK || !strings.HasPrefix(owned.Header().Get("X-Combat-Read-Base"), "read:") {
		t.Fatal("Owned GET did not seed an exact read base")
	}
	if strings.Contains(owned.Body.String(), "private-marker-not-public") {
		t.Fatal("GET disclosed a private envelope")
	}
	before := len(rc.combatCache.slots)
	foreign := read(f.other.ID)
	if foreign.Code != http.StatusNotFound || foreign.Header().Get("X-Combat-Read-Base") != "" || len(rc.combatCache.slots) != before {
		t.Fatal("Foreign GET seeded or disclosed a base")
	}
	var receipts int64
	if err := f.db.Model(&RoguelikeCommandReceipt{}).Count(&receipts).Error; err != nil || receipts != 0 {
		t.Fatal("GET created a command receipt")
	}
	var stored RoguelikeRun
	if err := f.db.First(&stored, "id=?", run.ID).Error; err != nil || stored.Revision != run.Revision {
		t.Fatal("GET changed the durable run")
	}
}

func TestCombatReadBaseOwnerIsolationAndInactiveFallback(t *testing.T) {
	t.Setenv("RULES_COMBAT_ASYNC_PERSIST_ENABLED", "1")
	cache := newCombatRuntimeCache()
	rc := &RoguelikeController{combatCache: cache}
	id := uuid.New()
	for index := 0; index < 2; index++ {
		run := &RoguelikeRun{ID: id, UserID: uuid.New(), Revision: int64(index + 1), Phase: RoguelikePhaseCombat, Status: RoguelikeStatusActive, CombatState: JSONMap{"world": map[string]any{"actor": index}}}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/owned", nil)
		c.Request.Header.Set("X-Combat-Wire", combatDeltaWire)
		rc.writeCombatReadResponse(c, run)
		slot := cache.slots[combatCacheKey(id, run.UserID)]
		if slot == nil || slot.readBase.UserID != run.UserID {
			t.Fatal("Foreign read base")
		}
	}
	if len(cache.slots) != 2 {
		t.Fatal("Owners shared a cache slot")
	}
	run := &RoguelikeRun{ID: uuid.New(), UserID: uuid.New(), Revision: 1, Phase: RoguelikePhaseCamp, Status: RoguelikeStatusActive, CombatState: JSONMap{"world": map[string]any{}}}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/owned", nil)
	c.Request.Header.Set("X-Combat-Wire", combatDeltaWire)
	rc.writeCombatReadResponse(c, run)
	if w.Header().Get("X-Combat-Read-Base") != "" || len(cache.slots) != 2 {
		t.Fatal("Inactive combat seeded a base")
	}
}
