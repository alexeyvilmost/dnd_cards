package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestTrustedRestUsesCanonicalResourceMaximaAndRejectsOverflow(t *testing.T) {
	for _, spec := range []struct {
		name, pool       string
		maximum, current int
		status           int
	}{
		{"declared_item", "test_item_charges", 3, 2, 200},
		{"second_declaration", "test_feature_reserve", 5, 4, 200},
		{"overflow", "test_item_charges", 3, 4, 400},
		{"negative", "test_feature_reserve", 5, -1, 400},
	} {
		t.Run(spec.name, func(t *testing.T) {
			t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
			fixture := openCharacterV3AccessFixture(t)
			if err := fixture.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &CharacterEvent{}); err != nil {
				t.Fatal(err)
			}
			character := fixture.ownerCharacter
			character.CurrentHP, character.MaxHP = 4, 10
			character.Resources, character.MaxResources = &JSONMap{"hit_dice_d10": 2}, &JSONMap{"hit_dice_d10": 2}
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
				if r.URL.Path != "/rest" {
					t.Error("unexpected worker request")
				}
				var body struct {
					Input struct {
						Character CharacterV3 `json:"character"`
					} `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if _, exists := (*body.Input.Character.MaxResources)[spec.pool]; exists {
					t.Error("browser maxima reached worker")
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(JSONMap{"status": "ready", "patch": JSONMap{
					"current_hp": body.Input.Character.CurrentHP, "runtime_revision": body.Input.Character.RuntimeRevision + 1,
					"resources": JSONMap{"hit_dice_d10": 2, spec.pool: spec.current}, "max_resources": JSONMap{"hit_dice_d10": 2, spec.pool: spec.maximum},
				}})
			}))
			defer server.Close()
			t.Setenv("RULES_WORKER_URL", server.URL)
			t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("r", 32))
			registerRoguelikeRoutes(fixture.router.Group("/api"), fixture.auth, NewRoguelikeController(fixture.db))
			token := fixture.token(t, fixture.owner)
			command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "short_rest", Payload: JSONMap{
				"hit_die_rolls": []int{}, "runtime": JSONMap{"current_hp": 999, "max_resources": JSONMap{spec.pool: 999}, "resources": JSONMap{spec.pool: 999}},
			}}
			endpoint := "/api/roguelike/runs/" + run.ID.String() + "/commands"
			before, err := ownedRoguelikeRun(fixture.db, run.ID, fixture.owner.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			first := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
			if first.Code != spec.status {
				t.Fatalf("rest status=%d, expected=%d", first.Code, spec.status)
			}
			stored, err := ownedRoguelikeRun(fixture.db, run.ID, fixture.owner.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			var receipts int64
			fixture.db.Model(&RoguelikeCommandReceipt{}).Where("run_id = ?", run.ID).Count(&receipts)
			if spec.status != 200 {
				if stored.Revision != 1 || stored.Character.RuntimeRevision != before.Character.RuntimeRevision || !reflect.DeepEqual(stored.Character.Resources, before.Character.Resources) || !reflect.DeepEqual(stored.Character.MaxResources, before.Character.MaxResources) || receipts != 0 {
					t.Fatal("invalid worker resource result committed state")
				}
				return
			}
			second := performCharacterV3Request(t, fixture.router, http.MethodPost, endpoint, token, command)
			var accepted, replayed any
			json.Unmarshal(first.Body.Bytes(), &accepted)
			json.Unmarshal(second.Body.Bytes(), &replayed)
			if second.Code != 200 || !reflect.DeepEqual(accepted, replayed) || calls != 1 || receipts != 1 {
				t.Fatal("accepted canonical pool retry was not exact")
			}
			amount, _ := numberFromJSON((*stored.Character.Resources)[spec.pool])
			maximum, _ := numberFromJSON((*stored.Character.MaxResources)[spec.pool])
			if amount != spec.current || maximum != spec.maximum || stored.Character.CurrentHP != 4 || stored.Revision != 2 {
				t.Fatal("canonical pool was not preserved on reload")
			}
		})
	}
}

func TestLegacyRestPatchCannotSupplyMaxima(t *testing.T) {
	hp := 4
	run := RoguelikeRun{Character: &CharacterV3{CurrentHP: 4, MaxHP: 10, Resources: &JSONMap{"hit_dice_d10": 2}, MaxResources: &JSONMap{"hit_dice_d10": 2}}}
	if err := applyRoguelikeRuntimePatch(&run, roguelikeRuntimePatch{CurrentHP: &hp, Resources: &JSONMap{"hit_dice_d10": 2}, MaxResources: &JSONMap{"hit_dice_d10": 99}}, false, nil); err == nil {
		t.Fatal("legacy patch accepted browser-supplied maxima")
	}
}
