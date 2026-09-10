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

func TestTrustedWeaponRecallHasNoRestRecoveryOrClockCost(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}); err != nil {
		t.Fatal(err)
	}
	character := fixture.ownerCharacter
	run := RoguelikeRun{ID: uuid.New(), UserID: fixture.owner.ID, SourceCharacterID: character.ID, CharacterID: character.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Revision: 1, GameClockHours: 9, Supplies: 1,
		RunSeed: "private-test", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	if err := fixture.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "recall_weapon", Payload: JSONMap{
		"object_id": "owned-weapon", "hand": "off_hand", "runtime": JSONMap{"current_hp": 999},
	}}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Input struct {
				Character CharacterV3 `json:"character"`
				Recall    JSONMap     `json:"recallWeapon"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Input.Recall["commandId"] != command.CommandID.String() || body.Input.Recall["objectId"] != "owned-weapon" || body.Input.Recall["hand"] != "off_hand" {
			t.Error("wrong recall declaration")
		}
		if body.Input.Character.CurrentHP == 999 {
			t.Error("client state trusted")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "ready", "patch": JSONMap{"current_hp": body.Input.Character.CurrentHP, "runtime_revision": body.Input.Character.RuntimeRevision + 1}})
	}))
	defer server.Close()
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("r", 32))
	registerRoguelikeRoutes(fixture.router.Group("/api"), fixture.auth, NewRoguelikeController(fixture.db))
	endpoint := "/api/roguelike/runs/" + run.ID.String() + "/commands"
	token := fixture.token(t, fixture.owner)
	first := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
	if first.Code != 200 {
		t.Fatalf("recall status %d: %s", first.Code, first.Body.String())
	}
	again := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
	if again.Code != 200 || again.Body.String() != first.Body.String() || calls != 1 {
		t.Fatal("recall replay changed state")
	}
	stored, err := ownedRoguelikeRun(fixture.db, run.ID, fixture.owner.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GameClockHours != 9 || stored.Supplies != 1 || stored.Revision != 2 || stored.Character.CurrentHP != character.CurrentHP {
		t.Fatal("recall applied rest/economy changes")
	}
}

func TestTrustedCampActionsCommitEventsOnceAndRejectLegacyPatches(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &CharacterEvent{}, &Action{}); err != nil {
		t.Fatal(err)
	}
	character := fixture.ownerCharacter
	character.CharacterType = "dungeon_crawl"
	character.CurrentHP = 4
	if err := fixture.db.Omit("User", "Group").Save(&character).Error; err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: fixture.owner.ID, SourceCharacterID: character.ID, CharacterID: character.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Revision: 1, GameClockHours: 9, Supplies: 1,
		RunSeed: "private-test", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	if err := fixture.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := authorizeRoguelikeCharacterMutation(fixture.db, character, fixture.owner.ID, run.ID.String(), roguelikeIntentCampAction); err == nil {
		t.Fatal("legacy camp patch accepted")
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Input struct {
				Character  CharacterV3 `json:"character"`
				Seed       string      `json:"seed"`
				ActionID   string      `json:"actionId"`
				NextTurn   bool        `json:"nextTurn"`
				ItemCardID string      `json:"itemCardId"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/camp-action" || body.Input.Seed == "" || body.Input.Seed == "forged" || body.Input.Character.CurrentHP == 999 {
			t.Error("untrusted camp execution")
		}
		if calls == 1 && body.Input.ActionID != "owned-action" {
			t.Error("missing action")
		}
		if calls == 2 && !body.Input.NextTurn {
			t.Error("missing next turn")
		}
		if calls == 3 && body.Input.ItemCardID != "owned-item" {
			t.Error("missing item")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "ready", "patch": JSONMap{"current_hp": 7, "runtime_revision": body.Input.Character.RuntimeRevision + 1}, "events": []JSONMap{{"type": "healing", "amount": 3, "source": "Second Wind"}}})
	}))
	defer server.Close()
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("r", 32))
	registerRoguelikeRoutes(fixture.router.Group("/api"), fixture.auth, NewRoguelikeController(fixture.db))
	endpoint := "/api/roguelike/runs/" + run.ID.String() + "/commands"
	token := fixture.token(t, fixture.owner)
	for i, kind := range []string{"camp_action", "camp_turn", "use_item"} {
		command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: int64(i + 1), Type: kind, Payload: JSONMap{"seed": "forged", "runtime": JSONMap{"current_hp": 999}}}
		if kind == "camp_action" {
			command.Payload["action_id"] = "owned-action"
		}
		if kind == "use_item" {
			command.Payload["card_id"] = "owned-item"
		}
		first := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
		if first.Code != 200 {
			t.Fatalf("%s: %d %s", kind, first.Code, first.Body.String())
		}
		again := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
		var original, replay JSONMap
		if err := json.Unmarshal(first.Body.Bytes(), &original); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(again.Body.Bytes(), &replay); err != nil {
			t.Fatal(err)
		}
		if again.Code != 200 || !roguelikeJSONEqual(original, replay) || calls != i+1 {
			t.Fatal("non-idempotent camp action")
		}
	}
	stored, err := ownedRoguelikeRun(fixture.db, run.ID, fixture.owner.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GameClockHours != 9 || stored.Supplies != 1 || stored.Revision != 4 || stored.Character.CurrentHP != 7 {
		t.Fatal("wrong camp action state")
	}
	var count int64
	fixture.db.Model(&CharacterEvent{}).Where("character_id = ?", character.ID).Count(&count)
	if count != 3 {
		t.Fatalf("events duplicated or lost: %d", count)
	}
}
