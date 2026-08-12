package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func canonicalEnvelopeFixture(t *testing.T) []byte {
	t.Helper()
	commandID := uuid.New()
	sourceActorID := uuid.New()
	snapshot := map[string]any{
		"schemaVersion": 5,
		"id":            "world:test",
		"ruleset": map[string]any{
			"systemId": "dnd5e-2024", "releaseId": "test",
			"contentHash": "sha256:" + strings.Repeat("a", 64), "errataVersion": "test",
		},
		"revision": 1, "logicalClock": 1,
		"actors":              map[string]any{"actor:source": map[string]any{"id": "actor:source"}},
		"objects":             map[string]any{},
		"scene":               map[string]any{"mode": "exploration"},
		"processedCommandIds": []any{commandID.String()},
		"pendingResolution":   nil,
		"concentrations":      map[string]any{},
		"attackActions":       map[string]any{},
		"grapples":            map[string]any{},
	}
	snapshotValue, snapshotCanonical, err := canonicalizeRawJSON(canonicalMustJSON(t, snapshot))
	if err != nil || snapshotValue == nil {
		t.Fatalf("canonicalize snapshot fixture: %v", err)
	}
	envelope := map[string]any{
		"commandId": commandID, "semanticCommandId": commandID.String(),
		"rulesetReleaseId": uuid.New(), "rulesArtifactHash": "sha256:" + strings.Repeat("c", 64),
		"sourceActorId":  sourceActorID,
		"targetActorIds": []uuid.UUID{}, "expectedRevision": 0,
		"baseSnapshotSeq": 0, "baseStateHash": "sha256:" + strings.Repeat("b", 64),
		"snapshotSchemaVersion": 5, "serializerVersion": "rules-core-canonical-json-v1",
		"stateHash": canonicalSHA256(snapshotCanonical), "snapshot": json.RawMessage(snapshotCanonical),
		"actorBindings": []canonicalActorBinding{{ActorID: sourceActorID, WorldActorID: "actor:source"}},
	}
	return canonicalMustJSON(t, envelope)
}

func TestCanonicalTransitionRequiresStableSemanticAndReleaseEnvelope(t *testing.T) {
	var object map[string]any
	if err := json.Unmarshal(canonicalEnvelopeFixture(t), &object); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"semanticCommandId", "rulesetReleaseId", "rulesArtifactHash"} {
		candidate := mapsClone(object)
		delete(candidate, field)
		if _, err := decodeCanonicalTransitionRequest(bytes.NewReader(canonicalMustJSON(t, candidate))); err == nil {
			t.Fatalf("transition without %s was accepted", field)
		}
	}
	object["semanticCommandId"] = strings.Repeat("x", maxCanonicalStableIDBytes+1)
	if _, err := decodeCanonicalTransitionRequest(bytes.NewReader(canonicalMustJSON(t, object))); err == nil {
		t.Fatal("oversized semanticCommandId was accepted")
	}
}

func mapsClone(source map[string]any) map[string]any {
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func canonicalMustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestDecodeCanonicalTransitionRequestRejectsUnknownAndAmbiguousInput(t *testing.T) {
	valid := canonicalEnvelopeFixture(t)
	prepared, err := decodeCanonicalTransitionRequest(bytes.NewReader(valid))
	if err != nil {
		t.Fatalf("valid transition rejected: %v", err)
	}
	if prepared.requestHash != canonicalSHA256(prepared.requestCanonical) {
		t.Fatal("request hash is not bound to canonical request bytes")
	}

	var object map[string]any
	if err = json.Unmarshal(valid, &object); err != nil {
		t.Fatal(err)
	}
	object["unknownField"] = true
	if _, err = decodeCanonicalTransitionRequest(bytes.NewReader(canonicalMustJSON(t, object))); err == nil {
		t.Fatal("unknown top-level field was accepted")
	}
	duplicate := bytes.Replace(valid, []byte(`"commandId":`), []byte(`"commandId":"`+uuid.NewString()+`","commandId":`), 1)
	if _, err = decodeCanonicalTransitionRequest(bytes.NewReader(duplicate)); err == nil {
		t.Fatal("duplicate commandId was accepted")
	}
}

func TestDecodeCanonicalTransitionRequestEnforcesBoundAndWorldEnvelope(t *testing.T) {
	tooLarge := bytes.Repeat([]byte(" "), int(maxCanonicalTransitionBodyBytes+1))
	if _, err := decodeCanonicalTransitionRequest(bytes.NewReader(tooLarge)); err == nil {
		t.Fatal("oversized canonical transition was accepted")
	} else {
		var problem *canonicalHTTPError
		if !errorsAsCanonical(err, &problem) || problem.status != http.StatusRequestEntityTooLarge {
			t.Fatalf("oversized status = %#v", err)
		}
	}

	var object map[string]any
	if err := json.Unmarshal(canonicalEnvelopeFixture(t), &object); err != nil {
		t.Fatal(err)
	}
	snapshot := object["snapshot"].(map[string]any)
	delete(snapshot, "pendingResolution")
	object["snapshot"] = snapshot
	if _, err := decodeCanonicalTransitionRequest(bytes.NewReader(canonicalMustJSON(t, object))); err == nil {
		t.Fatal("WorldState without explicit pendingResolution was accepted")
	}
}

func TestDecodeCanonicalTransitionRequestRejectsInvalidActorHPBeforePersistence(t *testing.T) {
	var object map[string]any
	if err := json.Unmarshal(canonicalEnvelopeFixture(t), &object); err != nil {
		t.Fatal(err)
	}
	snapshot := object["snapshot"].(map[string]any)
	actor := snapshot["actors"].(map[string]any)["actor:source"].(map[string]any)
	actor["runtime"] = map[string]any{
		"hp": map[string]any{"current": 10, "max": 0, "temp": 0},
	}
	object["snapshot"] = snapshot

	_, err := decodeCanonicalTransitionRequest(bytes.NewReader(canonicalMustJSON(t, object)))
	var problem *canonicalHTTPError
	if err == nil || !errorsAsCanonical(err, &problem) || problem.status != http.StatusUnprocessableEntity {
		t.Fatalf("invalid actor HP error = %#v, want 422", err)
	}
}

func TestCanonicalDecisionMetadataUsesBoundedStringIdentitiesAndSchemaOne(t *testing.T) {
	var request canonicalTransitionRequest
	if err := json.Unmarshal(canonicalEnvelopeFixture(t), &request); err != nil {
		t.Fatal(err)
	}
	request.Decision = &canonicalDecisionMetadata{
		RequestID: "save:request:target:1", ResolutionID: "save:resolution:target:1",
		DecidingActorID: request.SourceActorID, RequestSchemaVersion: 1,
	}
	if err := validateCanonicalTransitionEnvelope(request); err != nil {
		t.Fatalf("stable string decision identity rejected: %v", err)
	}
	request.Decision.RequestSchemaVersion = 2
	if err := validateCanonicalTransitionEnvelope(request); err == nil {
		t.Fatal("decision request schema other than 1 was accepted")
	}
	request.Decision.RequestSchemaVersion = 1
	request.Decision.ResolutionID = request.Decision.RequestID
	if err := validateCanonicalTransitionEnvelope(request); err == nil {
		t.Fatal("identical request/resolution identities were accepted")
	}
}

func TestCanonicalRuntimeActorKindsMapExactlyToWorldKinds(t *testing.T) {
	for databaseKind, worldKind := range map[string]string{
		"player_character": "playerCharacter",
		"summoned_actor":   "summonedActor",
		"npc":              "monster",
		"external_actor":   "monster",
	} {
		actual, err := canonicalWorldActorKind(databaseKind)
		if err != nil || actual != worldKind {
			t.Errorf("kind %q mapped to %q, err=%v; want %q", databaseKind, actual, err, worldKind)
		}
	}
	if _, err := canonicalWorldActorKind("world_object"); err == nil {
		t.Fatal("world_object was accepted as a WorldState actor")
	}
}

func errorsAsCanonical(err error, target **canonicalHTTPError) bool {
	problem, ok := err.(*canonicalHTTPError)
	if ok {
		*target = problem
	}
	return ok
}

func TestCanonicalSessionHandlersRequireAuthenticatedContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	controller := NewCanonicalSessionController(nil)
	for _, test := range []struct {
		method  string
		path    string
		handler gin.HandlerFunc
	}{
		{method: http.MethodGet, path: "/api/transport/canonical-sessions/" + uuid.NewString(), handler: controller.GetCurrent},
		{method: http.MethodPost, path: "/api/transport/canonical-sessions/" + uuid.NewString() + "/transitions", handler: controller.ApplyTransition},
	} {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(test.method, test.path, bytes.NewReader(canonicalEnvelopeFixture(t)))
		context.Params = gin.Params{{Key: "id", Value: uuid.NewString()}}
		test.handler(context)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("%s unauthenticated status = %d", test.method, recorder.Code)
		}
	}
}

func TestCanonicalSessionRoutesUseStrictAuthAndBoundedTransition(t *testing.T) {
	source, err := os.ReadFile("canonical_session_routes.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for label, pattern := range map[string]string{
		"transport namespace": `/transport/canonical-sessions`,
		"rules namespace":     `/rules/canonical-sessions`,
		"transport auth":      `transport\.Use\(StrictAuthMiddleware\(authService\)\)`,
		"rules auth":          `rules\.Use\(StrictAuthMiddleware\(authService\)\)`,
		"bounded JSON":        `JSONBodyLimitMiddleware\(maxCanonicalTransitionBodyBytes\)`,
		"bounded stream":      `RequestBodyLimitMiddleware\(maxCanonicalTransitionBodyBytes\)`,
		"transition handler":  `transport\.POST\(`,
		"command handler":     `controller\.ApplyRulesCommand`,
	} {
		if !regexp.MustCompile(pattern).MatchString(text) {
			t.Errorf("canonical route is missing %s", label)
		}
	}
	controllerSource, err := os.ReadFile("canonical_session_controller.go")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`(?s)activeCanonicalMembers.*FOR SHARE`).Match(controllerSource) {
		t.Fatal("canonical mutation path does not lock active membership FOR SHARE")
	}
	mainSource, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`(?s)if canonicalTransportEnabled\(\) \|\| canonicalServerRulesEnabled\(\).*registerCanonicalSessionRoutes`).Match(mainSource) {
		t.Fatal("canonical routes are not guarded by the default-off feature flag")
	}
}

func TestCanonicalServerRulesFeatureFlagIsStrictOptIn(t *testing.T) {
	for _, disabled := range []string{"", "0", "true", "yes", " 1 "} {
		t.Setenv(canonicalServerRulesFeatureFlag, disabled)
		if canonicalServerRulesEnabled() {
			t.Fatalf("feature flag value %q unexpectedly enabled server rules", disabled)
		}
	}
	t.Setenv(canonicalServerRulesFeatureFlag, "1")
	if !canonicalServerRulesEnabled() {
		t.Fatal("feature flag value 1 did not enable server rules")
	}
}

func TestCanonicalTransportFeatureFlagIsStrictOptIn(t *testing.T) {
	for _, disabled := range []string{"", "0", "true", "yes", " 1 "} {
		t.Setenv(canonicalTransportFeatureFlag, disabled)
		if canonicalTransportEnabled() {
			t.Fatalf("feature flag value %q unexpectedly enabled transport", disabled)
		}
	}
	t.Setenv(canonicalTransportFeatureFlag, "1")
	if !canonicalTransportEnabled() {
		t.Fatal("feature flag value 1 did not enable transport")
	}
}
