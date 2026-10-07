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

func TestCombatRulesUpgradeRejectsAnyGameplayMutation(t *testing.T) {
	old := "sha256:" + strings.Repeat("a", 64)
	next := "sha256:" + strings.Repeat("b", 64)
	before := JSONMap{"schemaVersion": 1, "artifactHash": old, "entropy": JSONMap{"seed": "private-test", "cursor": 7}, "state": JSONMap{"world": JSONMap{"hp": 10}, "log": []any{"old"}}}
	for _, mode := range []string{"valid", "entropy", "world", "log", "extra", "random", "patch", "same"} {
		t.Run(mode, func(t *testing.T) {
			wire, _ := json.Marshal(before)
			after := JSONMap{}
			json.Unmarshal(wire, &after)
			after["artifactHash"] = next
			r := &roguelikeWorkerResult{Envelope: after, ArtifactHash: next}
			switch mode {
			case "entropy":
				after["entropy"].(map[string]any)["cursor"] = 8
			case "world":
				after["state"].(map[string]any)["world"] = JSONMap{"hp": 9}
			case "log":
				after["state"].(map[string]any)["log"] = []any{}
			case "extra":
				after["extra"] = true
			case "random":
				r.RandomValues = []float64{.5}
			case "patch":
				r.Patch = JSONMap{"current_hp": 10}
			case "same":
				r.ArtifactHash = old
				after["artifactHash"] = old
			}
			err := validateCombatRulesUpgrade(before, r)
			if (err == nil) != (mode == "valid") {
				t.Fatalf("unexpected validation for %s: %v", mode, err)
			}
		})
	}
}

func TestCombatRulesUpgradeCommitsOnceAndRetainsCharactersCatalogAndHistory(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &RoguelikeCombatEvent{}); err != nil {
		t.Fatal(err)
	}
	old := "sha256:" + strings.Repeat("a", 64)
	next := "sha256:" + strings.Repeat("b", 64)
	frame := JSONMap{"schemaVersion": 1, "artifactHash": old, "entropy": JSONMap{"seed": "private-test", "cursor": 7}, "state": JSONMap{"characterId": f.ownerCharacter.ID.String(), "runtimeRevision": 0, "world": JSONMap{"actors": JSONMap{}}, "log": []any{"past-roll"}}}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, CharacterID: f.ownerCharacter.ID, SourceCharacterID: f.ownerCharacter.ID, Revision: 4, Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat,
		RunSeed: "private-test", CombatEnvelope: frame, CombatCatalog: JSONMap{"immutable": true}, Encounter: JSONMap{}, Checkpoint: JSONMap{}, Shop: JSONMap{}, LastReward: JSONMap{}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	previousKey, err := roguelikeCombatJournalKey(frame)
	if err != nil {
		t.Fatal(err)
	}
	past := RoguelikeCombatEvent{RunID: run.ID, CommandID: uuid.New(), Revision: 4, CombatKey: previousKey, Record: JSONMap{"past": true}}
	if err := f.db.Create(&past).Error; err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/upgrade" {
			t.Error("wrong endpoint")
		}
		var body struct {
			Envelope JSONMap `json:"envelope"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		body.Envelope["artifactHash"] = next
		json.NewEncoder(w).Encode(roguelikeWorkerResult{Envelope: body.Envelope, ArtifactHash: next, Trace: JSONMap{"beforeHash": old, "afterHash": next, "runtimeRevision": 0}})
	}))
	defer server.Close()
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("r", 32))
	registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 4, Type: "upgrade_combat_rules", Payload: JSONMap{"artifactHash": old, "current_hp": 999}}
	path := "/api/roguelike/runs/" + run.ID.String() + "/commands"
	foreign := performCharacterV3Request(t, f.router, http.MethodPost, path, f.token(t, f.other), command)
	if foreign.Code == 200 || calls != 0 {
		t.Fatal("foreign upgrade accepted")
	}
	first := performCharacterV3Request(t, f.router, http.MethodPost, path, f.token(t, f.owner), command)
	if first.Code != 200 {
		t.Fatalf("upgrade %d %s", first.Code, first.Body.String())
	}
	second := performCharacterV3Request(t, f.router, http.MethodPost, path, f.token(t, f.owner), command)
	var a, b any
	json.Unmarshal(first.Body.Bytes(), &a)
	json.Unmarshal(second.Body.Bytes(), &b)
	if second.Code != 200 || calls != 1 || !reflect.DeepEqual(a, b) {
		t.Fatal("upgrade not idempotent")
	}
	stored, err := ownedRoguelikeRun(f.db, run.ID, f.owner.ID, false)
	if err != nil || stored.Revision != 5 || stored.Character.RuntimeRevision != f.ownerCharacter.RuntimeRevision || stored.Character.CurrentHP != f.ownerCharacter.CurrentHP || stored.CombatCatalog["immutable"] != true {
		t.Fatalf("unintended gameplay change: %v", err)
	}
	var events []RoguelikeCombatEvent
	f.db.Where("run_id = ?", run.ID).Order("revision").Find(&events)
	if len(events) != 2 || !reflect.DeepEqual(events[0].Record, past.Record) || events[1].Record["baselinePosition"] != "after" || events[1].Record["previousBaseline"] == nil {
		t.Fatal("lost historical/version boundary")
	}
	if events[1].Record["previousCombatKey"] != previousKey || events[1].Record["previousEventId"] != past.ID.String() {
		t.Fatal("missing preceding segment link")
	}
	command.CommandID = uuid.New()
	stale := performCharacterV3Request(t, f.router, http.MethodPost, path, f.token(t, f.owner), command)
	if stale.Code != 409 || calls != 1 {
		t.Fatal("stale version accepted")
	}
}
