package main

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestUrvinVictoryStashClaimIsAtomicAndIdempotent(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &Card{}); err != nil {
		t.Fatal(err)
	}
	weight := 6.0
	card := Card{ID: uuid.New(), Name: "Boss reward", Description: "test", CardNumber: "URVIN-STASH-TEST", Rarity: RarityRare, Weight: &weight}
	if err := f.db.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	character := f.ownerCharacter
	character.RuleState = &JSONMap{"carryingCapacity": float64(5)}
	if err := f.db.Omit("User", "Group").Save(&character).Error; err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: character.ID, CharacterID: character.ID,
		Mode: urvinMode, Status: RoguelikeStatusVictory, Phase: RoguelikePhaseEnded, Revision: 1, RunSeed: "test",
		Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	j := UrvinJourney{Version: 1, CurrentNode: "boss", Nodes: []UrvinNode{{ID: "boss", Kind: "boss", Completed: true}}, Stash: []JSONMap{{"card_id": card.ID.String()}}}
	if err := saveUrvinJourney(&run, j); err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
	token := f.token(t, f.owner)
	endpoint := "/api/roguelike/runs/" + run.ID.String() + "/commands"
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "claim_stash", Payload: JSONMap{"card_id": card.ID.String(), "character_id": character.ID.String()}}
	failed := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	if failed.Code != 409 || !strings.Contains(failed.Body.String(), "carrying_capacity_exceeded") {
		t.Fatalf("weight limit bypassed: %d %s", failed.Code, failed.Body.String())
	}
	if err := f.db.Model(&Card{}).Where("id=?", card.ID).Update("weight", 1).Error; err != nil {
		t.Fatal(err)
	}
	first := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	second := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	var a, b any
	if first.Code != 200 || second.Code != 200 || json.Unmarshal(first.Body.Bytes(), &a) != nil || json.Unmarshal(second.Body.Bytes(), &b) != nil || !reflect.DeepEqual(a, b) {
		t.Fatalf("victory claim or replay failed: %d %s / %d %s", first.Code, first.Body.String(), second.Code, second.Body.String())
	}
	stored, err := ownedRoguelikeRun(f.db, run.ID, f.owner.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	journey, err := urvinJourney(stored)
	if err != nil || len(journey.Stash) != 0 || stored.Revision != 2 || stored.Status != RoguelikeStatusVictory || stored.Phase != RoguelikePhaseEnded || stored.Character.InventoryItems == nil || len(*stored.Character.InventoryItems) != 1 || (*stored.Character.InventoryItems)[0].Qty != 1 {
		t.Fatal("claim was not committed exactly once while retaining terminal state")
	}
	command.CommandID = uuid.New()
	command.ExpectedRevision = 2
	duplicate := performCharacterV3Request(t, f.router, http.MethodPost, endpoint, token, command)
	if duplicate.Code != 404 {
		t.Fatalf("new command duplicated a claimed reward: %d", duplicate.Code)
	}
	for _, kind := range []string{"enter_room", "leave_room", "event_choice", "short_rest", "confirm_level_up", "initialize_combat"} {
		if err := urvinCommandAllowed(stored, kind); err == nil {
			t.Fatalf("terminal run unexpectedly permits %s", kind)
		}
	}
	for _, state := range [][2]string{{RoguelikeStatusDefeat, RoguelikePhaseEnded}, {RoguelikeStatusActive, RoguelikePhaseCombat}, {RoguelikeStatusVictory, RoguelikePhaseCamp}} {
		stored.Status, stored.Phase = state[0], state[1]
		if err := applyUrvinRoomCommand(f.db, stored, command); err == nil {
			t.Fatalf("claim allowed in inappropriate state %v", state)
		}
	}
}
