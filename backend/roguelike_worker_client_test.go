package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestWorkerClientPublicRuleRejectionDiscardsPrivateDetails(t *testing.T) {
	for _, tc := range []struct {
		name, body, code, want string
	}{
		{"structured range", `{"error":"invalid_combat_command","rejectionCode":"OutOfRange","message":"private-seed; target-private is outside 0 ft range"}`, "combat_out_of_range", "Цель вне дальности"},
		{"legacy range", `{"error":"invalid_combat_command","message":"OutOfRange: target-private is outside 0 ft range; private-seed"}`, "combat_out_of_range", "Цель вне дальности"},
		{"different resource failure", `{"error":"invalid_combat_command","rejectionCode":"InsufficientResources","message":"Missing resources: resource-private"}`, "combat_insufficient_resources", "Недостаточно ресурсов"},
		{"invalid frozen definition", `{"error":"invalid_combat_command","rejectionCode":"InvalidActionDefinition","message":"private-snapshot"}`, "combat_action_invalid", "Механика действия"},
		{"unknown structured code", `{"error":"invalid_combat_command","rejectionCode":"OutOfRangePrivate","message":"private-seed"}`, "", ""},
		{"unanchored prefix", `{"error":"invalid_combat_command","message":"private-seed OutOfRange: hidden"}`, "", ""},
		{"unknown error kind", `{"error":"unknown","rejectionCode":"OutOfRange","message":"private-seed"}`, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnprocessableEntity)
				w.Write([]byte(tc.body))
			}))
			defer server.Close()
			client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("a", 32)}
			_, err := client.call(context.Background(), "/transition", JSONMap{})
			var public *roguelikeWorkerRejection
			if errors.As(err, &public) != (tc.code != "") {
				t.Fatalf("unexpected public classification: %v", err)
			}
			if tc.code != "" && (public.Code != tc.code || !strings.Contains(public.Message, tc.want)) {
				t.Fatalf("unexpected safe diagnostic: %#v", public)
			}
			if err == nil || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "outside 0") {
				t.Fatalf("exception details escaped boundary: %v", err)
			}
			if failure := publicRoguelikeWorkerFailure(err); failure == nil || strings.Contains(failure.Message, "начала боя") {
				t.Fatalf("transition failure incorrectly describes initialization: %#v", failure)
			}
		})
	}
}

func TestWorkerInitializationOpeningStateRemainsAResponseOnlySnapshot(t *testing.T) {
	opening := JSONMap{"characterId": "hero", "world": JSONMap{"actors": JSONMap{"hero": JSONMap{"hp": 12}}}}
	final := JSONMap{"characterId": "hero", "world": JSONMap{"actors": JSONMap{"hero": JSONMap{"hp": 4}}}}
	result := &roguelikeWorkerResult{CombatOpeningState: opening, Envelope: JSONMap{
		"state": final, "entropy": JSONMap{"seed": "private-opening-seed", "cursor": 8},
	}}
	for _, partySize := range []int{1, 2} {
		t.Run(fmt.Sprintf("party_%d", partySize), func(t *testing.T) {
			run := &RoguelikeRun{CombatState: final, CombatEnvelope: result.Envelope}
			if partySize > 1 {
				run.Characters = []*CharacterV3{{CurrentHP: 4}, {CurrentHP: 8}}
			}
			response, err := roguelikeRunResponse(run)
			if err != nil {
				t.Fatal(err)
			}
			if err = addRoguelikeCombatOpeningState(response, "initialize_combat", result); err != nil {
				t.Fatal(err)
			}
			public := response["run"].(map[string]any)
			if !reflect.DeepEqual(public["combat_opening_state"], opening) {
				t.Fatal("opening board missing from initialization response")
			}
			encoded, _ := json.Marshal(response)
			for _, private := range []string{"private-opening-seed", "entropy", "combat_envelope", "combatOpeningState"} {
				if strings.Contains(string(encoded), private) {
					t.Fatalf("opening response leaked %s", private)
				}
			}
			if _, persisted := run.CombatEnvelope["combatOpeningState"]; persisted {
				t.Fatal("opening board entered the persisted envelope")
			}
			reloaded, err := roguelikeRunResponse(run)
			if err != nil {
				t.Fatal(err)
			}
			if err = addRoguelikeCombatOpeningState(reloaded, "combat_intent", result); err != nil {
				t.Fatal(err)
			}
			if _, exists := reloaded["run"].(map[string]any)["combat_opening_state"]; exists {
				t.Fatal("opening presentation replayed by a later command or GET")
			}
		})
	}
}

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

func TestWorkerClientDecodesSeparateOpeningBoard(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"envelope":{"state":{"outcome":"active"}},"patch":{"runtime_revision":2},"combatOpeningState":{"characterId":"hero","outcome":"active","tokens":{"hero":{"position":{"x":1,"y":2}}}}}`))
	}))
	defer server.Close()
	client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("a", 32)}
	result, err := client.call(context.Background(), "/initialize", JSONMap{})
	if err != nil || result.CombatOpeningState["characterId"] != "hero" {
		t.Fatalf("worker opening board was discarded: %v", err)
	}
	if _, exists := result.Envelope["combatOpeningState"]; exists {
		t.Fatal("opening board entered the authoritative worker envelope")
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
