package main

import (
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTrustedRoguelikeRestIgnoresClientPatchAndCommitsOnce(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}); err != nil {
		t.Fatal(err)
	}
	character := fixture.ownerCharacter
	character.CurrentHP = 4
	character.MaxHP = 10
	character.Resources = &JSONMap{"hit_dice_d10": 2, "second_wind": 0}
	character.MaxResources = &JSONMap{"hit_dice_d10": 2, "second_wind": 2}
	if err := fixture.db.Omit("User", "Group").Save(&character).Error; err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: fixture.owner.ID, SourceCharacterID: character.ID, CharacterID: character.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Revision: 1, RunSeed: "private-test", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	if err := fixture.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/rest" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("r", 32) {
			t.Error("wrong worker request")
		}
		var body struct {
			Input struct {
				Character CharacterV3 `json:"character"`
				Long      bool        `json:"long"`
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		hp := body.Input.Character.CurrentHP
		if body.Input.Long {
			hp = body.Input.Character.MaxHP
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "ready", "patch": JSONMap{
			"current_hp": hp, "resources": JSONMap{"hit_dice_d10": 2, "second_wind": 1},
			"runtime_revision": body.Input.Character.RuntimeRevision + 1,
		}})
	}))
	defer server.Close()
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("r", 32))
	registerRoguelikeRoutes(fixture.router.Group("/api"), fixture.auth, NewRoguelikeController(fixture.db))
	token := fixture.token(t, fixture.owner)
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "short_rest", Payload: JSONMap{
		"hit_die_rolls": []int{}, "runtime": JSONMap{"current_hp": 10, "resources": JSONMap{"second_wind": 2}, "turn_state": JSONMap{"forged": true}},
	}}
	endpoint := "/api/roguelike/runs/" + run.ID.String() + "/commands"
	first := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
	if first.Code != 200 {
		t.Fatalf("rest status %d: %s", first.Code, first.Body.String())
	}
	second := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
	if second.Code != 200 || second.Body.String() != first.Body.String() || calls != 1 {
		t.Fatal("rest replay was not idempotent")
	}
	stored, err := ownedRoguelikeRun(fixture.db, run.ID, fixture.owner.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GameClockHours != 1 || stored.Revision != 2 || stored.Character.CurrentHP != 4 {
		t.Fatal("wrong committed rest")
	}
	if amount, _ := numberFromJSON((*stored.Character.Resources)["second_wind"]); amount != 1 {
		t.Fatal("accepted browser resource patch")
	}
	if stored.Character.TurnState != nil && (*stored.Character.TurnState)["forged"] != nil {
		t.Fatal("accepted browser state")
	}
	command.CommandID = uuid.New()
	command.ExpectedRevision = 2
	command.Type = "long_rest"
	rejected := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
	if rejected.Code != 409 || !strings.Contains(rejected.Body.String(), "supplies_required") {
		t.Fatalf("supplies not required: %s", rejected.Body.String())
	}
	unchanged, _ := ownedRoguelikeRun(fixture.db, run.ID, fixture.owner.ID, false)
	if unchanged.Revision != 2 || unchanged.GameClockHours != 1 || unchanged.Character.CurrentHP != 4 {
		t.Fatal("failed rest changed state")
	}
}

func TestRoguelikeHitDieUsesFloorForNegativeOddConstitution(t *testing.T) {
	run := RoguelikeRun{Character: &CharacterV3{CurrentHP: 4, MaxHP: 14, Abilities: &JSONMap{"con": 7},
		Resources: &JSONMap{"hit_dice_d10": 2}, MaxResources: &JSONMap{"hit_dice_d10": 2}}}
	hp := 7
	if err := applyRoguelikeRuntimePatch(&run, roguelikeRuntimePatch{CurrentHP: &hp, Resources: &JSONMap{"hit_dice_d10": 1}}, false, []int{5}); err != nil {
		t.Fatal(err)
	}
	if run.Character.CurrentHP != 7 {
		t.Fatal("wrong Constitution modifier")
	}
}
