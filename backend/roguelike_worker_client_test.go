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
