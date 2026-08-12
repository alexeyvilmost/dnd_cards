package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func canonicalRulesCommandFixture(t *testing.T) []byte {
	t.Helper()
	return canonicalMustJSON(t, map[string]any{
		"command": map[string]any{
			"schemaVersion":      1,
			"commandId":          uuid.NewString(),
			"expectedRevision":   0,
			"rulesetContentHash": "sha256:" + strings.Repeat("a", 64),
			"actorId":            "fighter",
			"type":               "StartEncounter",
			"initiative":         []string{"fighter", "wizard"},
		},
	})
}

func TestDecodeCanonicalRulesCommandAcceptsIntentAndRejectsClientState(t *testing.T) {
	request, envelope, canonical, err := decodeCanonicalRulesCommand(bytes.NewReader(canonicalRulesCommandFixture(t)))
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Type != "StartEncounter" || envelope.ActorID != "fighter" || len(request.Command) == 0 || len(canonical) == 0 {
		t.Fatalf("unexpected decoded command: %#v", envelope)
	}

	for _, forbidden := range []map[string]any{
		{"command": map[string]any{}, "snapshot": map[string]any{}},
		{"command": map[string]any{}, "current_hp": 1},
	} {
		if _, _, _, err = decodeCanonicalRulesCommand(bytes.NewReader(canonicalMustJSON(t, forbidden))); err == nil {
			t.Fatalf("client-computed state envelope was accepted: %#v", forbidden)
		}
	}
}

func TestServerRNGTapeIsDeterministicPerIdempotencyKey(t *testing.T) {
	t.Setenv("RULES_RNG_SECRET", "test-only-secret")
	one, err := deterministicServerRNGTape("f15500b7-3e3d-4a9e-8115-c1c47725434f")
	if err != nil {
		t.Fatal(err)
	}
	two, _ := deterministicServerRNGTape("f15500b7-3e3d-4a9e-8115-c1c47725434f")
	other, _ := deterministicServerRNGTape("a090f840-7778-4a94-a5b9-37a2a7934211")
	if len(one) != serverRulesRNGTapeLength || !slicesEqualUint32(one, two) || slicesEqualUint32(one, other) {
		t.Fatal("server RNG tape is not stable and command-scoped")
	}
}

func slicesEqualUint32(left, right []uint32) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func TestCanonicalRulesCommandRequiresAuthenticationBeforeWorker(t *testing.T) {
	gin.SetMode(gin.TestMode)
	controller := newCanonicalSessionControllerWithWorker(nil, nil)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(canonicalRulesCommandFixture(t)))
	context.Params = gin.Params{{Key: "id", Value: uuid.NewString()}}
	controller.ApplyRulesCommand(context)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated command status = %d", recorder.Code)
	}
}

func TestServerRulesTransitionResponseCarriesCanonicalResult(t *testing.T) {
	response := canonicalTransitionResponse{
		SemanticAuthority: rulesWorkerAuthority,
		SchemaValidation:  rulesWorkerSchemaValidation,
		EngineVersion:     "rules-core-worker-v1",
		Events:            json.RawMessage(`[]`), Snapshot: json.RawMessage(`{"schemaVersion":5}`),
	}
	value, err := transitionResponseValue(response)
	if err != nil {
		t.Fatal(err)
	}
	object := value.(map[string]any)
	if object["semanticAuthority"] != rulesWorkerAuthority || object["engineVersion"] == nil || object["snapshot"] == nil {
		t.Fatalf("server response lost canonical worker evidence: %#v", object)
	}
}

func TestServerActorLifecycleAllowsOnlySourceOwnedSummonedActor(t *testing.T) {
	owner := uuid.New()
	sourceID := uuid.New()
	bindings := []canonicalActorBinding{{ActorID: sourceID, WorldActorID: "owner"}}
	actors := []canonicalSessionActorRow{{
		ID: sourceID, OwnerUserID: &owner, ControllerUserID: &owner, ActorKind: "player_character",
	}}
	oldWorld := canonicalWorldView{actors: map[string]any{
		"owner": map[string]any{"id": "owner", "kind": "playerCharacter", "controllerId": owner.String()},
	}}
	newWorld := canonicalWorldView{actors: map[string]any{
		"owner": oldWorld.actors["owner"],
		"familiar": map[string]any{
			"id": "familiar", "kind": "summonedActor", "controllerId": owner.String(),
			"familiarState": map[string]any{"ownerActorId": "owner"},
		},
	}}
	nextBindings, creates, removals, err := serverActorLifecycle(
		oldWorld, newWorld, actors, bindings, sourceID,
	)
	if err != nil || len(nextBindings) != 2 || len(creates) != 1 || len(removals) != 0 ||
		creates[0].WorldActorID != "familiar" {
		t.Fatalf("lifecycle bindings=%#v creates=%#v removals=%#v err=%v", nextBindings, creates, removals, err)
	}
	tampered := newWorld
	tampered.actors["familiar"].(map[string]any)["controllerId"] = uuid.NewString()
	if _, _, _, err = serverActorLifecycle(oldWorld, tampered, actors, bindings, sourceID); err == nil {
		t.Fatal("summoned actor with a forged controller was accepted")
	}
}
