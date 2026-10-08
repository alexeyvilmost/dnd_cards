package main

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompactProjectionInputContainsOnlyVerifiedProjectorFields(t *testing.T) {
	for _, revision := range []int64{0, 17} {
		turn := JSONMap{"choice": map[string]any{"value": "second 🐉"}, "solo_combat_v1": map[string]any{"large": strings.Repeat("snapshot", 1000)}}
		character := &CharacterV3{ID: uuid.New(), RuntimeRevision: revision, TurnState: &turn, Notes: strings.Repeat("private notes", 1000)}
		before, _ := json.Marshal(character)
		raw, err := json.Marshal(compactCombatProjectionCharacter(character))
		if err != nil {
			t.Fatal("Compact input failed")
		}
		var actual JSONMap
		if json.Unmarshal(raw, &actual) != nil || len(actual) != 3 || actual["id"] != character.ID.String() || actual["runtime_revision"] != float64(revision) {
			t.Fatal("Verified input fields changed")
		}
		state := actual["turn_state"].(map[string]any)
		if len(state) != 1 || state["choice"] == nil {
			t.Fatal("Noncombat turn choice changed")
		}
		after, _ := json.Marshal(character)
		if string(before) != string(after) {
			t.Fatal("Original character mutated")
		}
	}
	if compactCombatProjectionCharacter(nil) != nil {
		t.Fatal("Missing member changed")
	}
}

func TestCompactProjectionUnknownWorkerRetriesCompleteSheet(t *testing.T) {
	turn := JSONMap{"choice": "second", "solo_combat_v1": map[string]any{"original": true}}
	character := &CharacterV3{ID: uuid.New(), RuntimeRevision: 3, Name: "Full original", TurnState: &turn}
	run := &RoguelikeRun{Character: character, CharacterID: character.ID, Characters: []*CharacterV3{character}, CombatEnvelope: JSONMap{"artifactHash": "sha256:" + strings.Repeat("a", 64)}}
	calls := 0
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body JSONMap
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Fatal("Invalid request")
		}
		sheet := body["character"].(map[string]any)
		if calls == 1 {
			if len(sheet) != 3 || body["projectionInputVersion"] != float64(1) {
				t.Fatal("Unknown version not gated")
			}
			w.WriteHeader(409)
			_, _ = w.Write([]byte(`{"error":"projection_unavailable"}`))
			return
		}
		if calls != 2 || sheet["name"] != "Full original" || sheet["turn_state"].(map[string]any)["solo_combat_v1"] == nil || body["projectionInputVersion"] != nil || body["frameKey"] != nil {
			t.Fatal("Fallback omitted authoritative full input")
		}
		_, _ = w.Write([]byte(`{"envelope":{"state":{}},"patch":{"runtime_revision":4},"trace":{}}`))
	}))
	defer worker.Close()
	client := roguelikeWorkerClient{URL: worker.URL, Token: strings.Repeat("t", 32)}
	if _, err := callCombatWorkerBody(context.Background(), client, cachedCombatWorkerBody(run, map[string]any{"type": "end_turn"}, ""), run, map[string]any{"type": "end_turn"}); err != nil || calls != 2 {
		t.Fatal("Unknown worker fallback failed")
	}
}
