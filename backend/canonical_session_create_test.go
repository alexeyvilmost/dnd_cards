package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http/httptest"
)

func genesisActorForStoredRuntime(character CharacterV3) map[string]any {
	return map[string]any{
		"id":   character.ID.String(),
		"kind": "playerCharacter",
		"runtime": map[string]any{
			"hp": map[string]any{
				"current": json.Number("10"),
				"max":     json.Number("10"),
				"temp":    json.Number("0"),
			},
			"resources":     map[string]any{},
			"maxResources":  map[string]any{},
			"equipment":     map[string]any{},
			"activeEffects": []any{},
			"inventory":     []any{},
		},
		"character": map[string]any{
			"level":     json.Number("1"),
			"profBonus": json.Number("2"),
		},
	}
}

func TestCloseServerSessionDetachesCharactersSoAcceptanceFixturesCanBeDeleted(t *testing.T) {
	fixture := openCanonicalTransportFixtureWithAccess(t, true, false)
	if err := fixture.db.Exec(`UPDATE game_sessions SET authority_mode = 'server' WHERE id = ?`, fixture.sessionID).Error; err != nil {
		t.Fatal(err)
	}
	controller := newCanonicalSessionControllerWithWorker(fixture.db, &integrationRulesWorker{})
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost,
		"/api/rules/canonical-sessions/"+fixture.sessionID.String()+"/close", bytes.NewReader(nil))
	context.Params = gin.Params{{Key: "id", Value: fixture.sessionID.String()}}
	context.Set("user_id", fixture.ownerID)

	controller.CloseServerSession(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("close status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var linked, removed int64
	if err := fixture.db.Raw(`SELECT count(*) FROM game_session_actors WHERE session_id = ? AND character_id IS NOT NULL`,
		fixture.sessionID).Scan(&linked).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Raw(`SELECT count(*) FROM game_session_actors WHERE session_id = ? AND lifecycle_status = 'removed'`,
		fixture.sessionID).Scan(&removed).Error; err != nil {
		t.Fatal(err)
	}
	if linked != 0 || removed != 2 {
		t.Fatalf("closed actor links=%d removed=%d, want 0/2", linked, removed)
	}
}

func TestValidateGenesisTreatsNullLegacyRuntimeCollectionsAsDomainEmptyValues(t *testing.T) {
	character := CharacterV3{
		ID: uuid.New(), Level: 1, ProficiencyBonus: 2,
		CurrentHP: 10, MaxHP: 10,
	}

	if err := validateGenesisActorAgainstCharacter(nil, genesisActorForStoredRuntime(character), character); err != nil {
		t.Fatalf("empty canonical runtime must match nullable legacy columns: %v", err)
	}
}

func TestValidateGenesisStillRejectsPopulatedRuntimeMismatch(t *testing.T) {
	character := CharacterV3{
		ID: uuid.New(), Level: 1, ProficiencyBonus: 2,
		CurrentHP: 10, MaxHP: 10,
	}
	actor := genesisActorForStoredRuntime(character)
	actor["runtime"].(map[string]any)["equipment"] = map[string]any{"main_hand": uuid.NewString()}

	err := validateGenesisActorAgainstCharacter(nil, actor, character)
	problem, ok := err.(*canonicalHTTPError)
	if !ok {
		t.Fatalf("expected canonicalHTTPError, got %T: %v", err, err)
	}
	if problem.status != http.StatusConflict || problem.message != "canonical genesis equipment differs from the stored character runtime" {
		t.Fatalf("unexpected mismatch response: %#v", problem)
	}
}
