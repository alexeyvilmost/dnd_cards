package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkerClientRequiresCompleteAuthenticatedResult(t *testing.T) {
	token := strings.Repeat("a", 32)
	response := `{"envelope":{"schemaVersion":1},"patch":{"runtime_revision":2}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("missing authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(response))
	}))
	defer server.Close()
	client := roguelikeWorkerClient{URL: server.URL, Token: token}
	if _, err := client.call(context.Background(), "/transition", JSONMap{}); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{`{}`, `{"envelope":{}}`, `{"status":"needs_content","needs":[]}`} {
		response = invalid
		if _, err := client.call(context.Background(), "/initialize", JSONMap{}); err == nil {
			t.Fatalf("accepted incomplete %s", invalid)
		}
	}
}
func TestPrivateWorkerStateIsNotSerializedIntoRunDTO(t *testing.T) {
	run := RoguelikeRun{CombatEnvelope: JSONMap{"entropy": JSONMap{"seed": "private-seed"}}, CombatCatalog: JSONMap{"private": "catalog"}, CombatState: JSONMap{"outcome": "active"}}
	data, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, forbidden := range []string{"private-seed", "entropy", "combat_envelope", "combat_catalog"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("leaked %s", forbidden)
		}
	}
	if !strings.Contains(text, `"combat_state":{"outcome":"active"}`) {
		t.Fatal("missing public state")
	}
}
func TestWorkerPatchRejectsProgressionAndUnexpectedRevision(t *testing.T) {
	character := CharacterV3{RuntimeRevision: 4, CurrentHP: 20}
	for _, patch := range []JSONMap{{"runtime_revision": float64(5), "experience": 9999}, {"runtime_revision": float64(4), "current_hp": 10}} {
		if err := applyTrustedRoguelikePatch(&character, patch); err == nil {
			t.Fatal("accepted forbidden patch")
		}
	}
	if character.CurrentHP != 20 || character.RuntimeRevision != 4 {
		t.Fatal("rejected patch mutated character")
	}
	if err := applyTrustedRoguelikePatch(&character, JSONMap{"runtime_revision": float64(5), "current_hp": float64(12)}); err != nil {
		t.Fatal(err)
	}
	if character.CurrentHP != 12 || character.RuntimeRevision != 5 {
		t.Fatal("runtime patch was not applied")
	}
}

func TestTrustedEncounterRejectsClientOutcomeBeforeAndAfterInitialization(t *testing.T) {
	turn := JSONMap{SOLO_COMBAT_KEY: map[string]any{"outcome": "victory"}}
	run := RoguelikeRun{Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat,
		Encounter: JSONMap{"trusted_required": true}, Character: &CharacterV3{TurnState: &turn}}
	if err := completeRoguelikeEncounter(nil, &run); err == nil {
		t.Fatal("accepted browser victory before initialization")
	}
	run.CombatEnvelope = JSONMap{"state": map[string]any{"outcome": "active"}}
	if err := completeRoguelikeEncounter(nil, &run); err == nil {
		t.Fatal("accepted browser victory over authoritative active state")
	}
}

func TestRetryInitializationResolvesNewLoadoutAndKeepsFrozenOpponents(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	for _, statement := range []string{
		`CREATE TABLE actions(id uuid PRIMARY KEY, type text, deleted_at timestamptz)`,
		`CREATE TABLE cards(id uuid PRIMARY KEY, card_number text, mechanics jsonb, deleted_at timestamptz)`,
		`INSERT INTO cards VALUES('c4000000-0000-4000-8000-000000000001','NEW-SHIELD','{"armor_profile":{"category":"shield","base_ac":2}}',NULL)`,
	} {
		if err := fixture.db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			ArtifactHash string `json:"artifactHash"`
			Input        struct {
				Catalog  roguelikeFrozenCatalog `json:"catalog"`
				Monsters JSONMap                `json:"monsters"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.ArtifactHash != "" || body.Input.Monsters["sentinel"] != "same-opponents" {
			t.Error("attempt reused old player artifact or replaced opponents")
		}
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			if len(body.Input.Catalog.Entities["card"]) != 0 {
				t.Error("stale player catalog reused")
			}
			w.Write([]byte(`{"status":"needs_content","needs":[{"kind":"entity","entityType":"card","reference":"c4000000-0000-4000-8000-000000000001"}]}`))
			return
		}
		cards := body.Input.Catalog.Entities["card"]
		if len(cards) != 1 || cards[0]["card_number"] != "NEW-SHIELD" {
			t.Error("newly acquired item was not resolved")
		}
		w.Write([]byte(`{"status":"ready","envelope":{"artifactHash":"new-attempt-artifact"},"patch":{"runtime_revision":1}}`))
	}))
	defer server.Close()
	run := RoguelikeRun{Character: &fixture.ownerCharacter, CombatCatalog: JSONMap{"artifactHash": "previous-artifact", "entities": JSONMap{"card": []any{"old-loadout"}}}, Encounter: JSONMap{"catalog": JSONMap{"sentinel": "same-opponents"}}}
	_, catalog, err := initializeRoguelikeWorker(context.Background(), fixture.db, roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("a", 32)}, &run, "test-attempt-seed", "")
	if err != nil || calls != 2 || catalog["artifactHash"] != "new-attempt-artifact" {
		t.Fatalf("new attempt failed: %v, calls=%d", err, calls)
	}
}
