package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type integrationRulesWorker struct {
	mu    sync.Mutex
	calls int
}

func (worker *integrationRulesWorker) Execute(
	_ context.Context,
	request rulesWorkerExecuteRequest,
) (rulesWorkerExecuteResponse, error) {
	worker.mu.Lock()
	worker.calls++
	worker.mu.Unlock()
	value, _, err := canonicalizeRawJSON(request.World)
	if err != nil {
		return rulesWorkerExecuteResponse{}, err
	}
	world := value.(map[string]any)
	commandValue, _, err := canonicalizeRawJSON(request.Command)
	if err != nil {
		return rulesWorkerExecuteResponse{}, err
	}
	command := commandValue.(map[string]any)
	world["revision"] = json.Number("1")
	world["logicalClock"] = json.Number("1")
	world["processedCommandIds"] = []any{command["commandId"]}
	world["scene"] = map[string]any{
		"mode": "encounter", "initiative": []any{"actor:source", "actor:target"},
		"activeIndex": json.Number("0"), "round": json.Number("1"), "turnStarted": true,
	}
	next, err := canonicalJSON(world)
	if err != nil {
		return rulesWorkerExecuteResponse{}, err
	}
	events := json.RawMessage(`[{"obligationIds":["test:server-command"],"payload":{"type":"EncounterStarted","initiative":["actor:source","actor:target"]},"sourceActorId":"actor:source"}]`)
	return rulesWorkerExecuteResponse{
		ProtocolVersion: rulesWorkerProtocolVersion, EngineVersion: "integration-worker",
		SemanticAuthority: rulesWorkerAuthority, SchemaValidation: rulesWorkerSchemaValidation,
		Status: "accepted", RulesArtifactHash: request.RulesArtifactHash,
		BaseStateHash: request.BaseStateHash, StateHash: canonicalSHA256(next),
		EventHash: canonicalSHA256(events), RNGConsumed: []uint32{}, Events: events, NextState: next,
	}, nil
}

func (*integrationRulesWorker) Validate(
	_ context.Context,
	request rulesWorkerValidateRequest,
) (rulesWorkerValidateResponse, error) {
	return rulesWorkerValidateResponse{
		ProtocolVersion: rulesWorkerProtocolVersion, EngineVersion: "integration-worker",
		SemanticAuthority: rulesWorkerAuthority, SchemaValidation: rulesWorkerSchemaValidation,
		Status: "valid", RulesArtifactHash: request.RulesArtifactHash, StateHash: request.StateHash,
	}, nil
}

func applyRulesCommandAs(
	t *testing.T,
	controller *CanonicalSessionController,
	sessionID uuid.UUID,
	userID uuid.UUID,
	body []byte,
) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodPost, "/api/rules/canonical-sessions/"+sessionID.String()+"/commands",
		bytes.NewReader(body),
	)
	context.Params = gin.Params{{Key: "id", Value: sessionID.String()}}
	context.Set("user_id", userID)
	controller.ApplyRulesCommand(context)
	return recorder
}

func TestCanonicalRulesCommandExactRetryReturnsCommittedReceiptBeforeRevisionCheck(t *testing.T) {
	fixture := openCanonicalTransportFixtureWithAccess(t, true, false)
	if err := fixture.db.Exec(`UPDATE game_sessions SET authority_mode = 'server' WHERE id = ?`, fixture.sessionID).Error; err != nil {
		t.Fatal(err)
	}
	worker := &integrationRulesWorker{}
	controller := newCanonicalSessionControllerWithWorker(fixture.db, worker)
	commandID := uuid.New()
	body := canonicalMustJSON(t, map[string]any{"command": map[string]any{
		"schemaVersion": 1, "commandId": commandID.String(), "expectedRevision": 0,
		"rulesetContentHash": fixture.baseWorld["ruleset"].(map[string]any)["contentHash"],
		"actorId":            "actor:source", "type": "StartEncounter",
		"initiative": []any{"actor:source", "actor:target"},
	}})
	first := applyRulesCommandAs(t, controller, fixture.sessionID, fixture.ownerID, body)
	if first.Code != http.StatusOK {
		t.Fatalf("first command status=%d body=%s", first.Code, first.Body.String())
	}
	second := applyRulesCommandAs(t, controller, fixture.sessionID, fixture.ownerID, body)
	if second.Code != http.StatusOK {
		t.Fatalf("retry status=%d body=%s", second.Code, second.Body.String())
	}
	worker.mu.Lock()
	calls := worker.calls
	worker.mu.Unlock()
	if calls != 1 || fixture.count(t, "game_commands") != 1 || fixture.count(t, "game_events") != 1 {
		t.Fatalf("worker calls=%d commands=%d events=%d", calls, fixture.count(t, "game_commands"), fixture.count(t, "game_events"))
	}
	var response canonicalTransitionResponse
	if err := json.Unmarshal(second.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.CommandID != commandID || response.Revision != 1 || response.SemanticAuthority != rulesWorkerAuthority {
		t.Fatalf("unexpected retry receipt: %#v", response)
	}
}
