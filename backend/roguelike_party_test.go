package main

import (
	"github.com/google/uuid"
	"testing"
)

func TestRoguelikePartyIdentityAndBounds(t *testing.T) {
	for count := 1; count <= 6; count++ {
		ids := []uuid.UUID{}
		for i := 0; i < count; i++ {
			ids = append(ids, uuid.New())
		}
		if err := validatePartySources(ids); err != nil {
			t.Fatal(err)
		}
	}
	id := uuid.New()
	for _, ids := range [][]uuid.UUID{nil, {id, id}, {uuid.Nil}, {uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()}} {
		if validatePartySources(ids) == nil {
			t.Fatalf("accepted invalid party %v", ids)
		}
	}
	leader, ally, foreign := uuid.New(), uuid.New(), uuid.New()
	run := &RoguelikeRun{CharacterID: leader}
	if !roguelikeHasCharacter(run, leader) || roguelikeHasCharacter(run, foreign) || roguelikePartySize(run) != 1 {
		t.Fatal("legacy identity changed")
	}
	run.Party, _ = mapFromJSON(map[string]any{"members": []roguelikePartyMember{{CharacterID: leader}, {CharacterID: ally}}})
	if !roguelikeHasCharacter(run, ally) || roguelikeHasCharacter(run, foreign) || roguelikePartySize(run) != 2 {
		t.Fatal("membership")
	}
}
func TestRoguelikePartyCheckpointRestoresEveryMember(t *testing.T) {
	user := uuid.New()
	leader := &CharacterV3{ID: uuid.New(), UserID: user, CurrentHP: 14, RuntimeRevision: 2, AvatarURL: "leader"}
	ally := &CharacterV3{ID: uuid.New(), UserID: user, CurrentHP: 12, RuntimeRevision: 4, AvatarURL: "ally"}
	run := &RoguelikeRun{CharacterID: leader.ID, UserID: user, Character: leader, Characters: []*CharacterV3{leader, ally}, Status: RoguelikeStatusDefeat, Gold: 40, Supplies: 2, Checkpoint: JSONMap{}}
	run.Party, _ = mapFromJSON(map[string]any{"members": []roguelikePartyMember{{CharacterID: leader.ID}, {CharacterID: ally.ID}}})
	var err error
	run.Checkpoint, err = roguelikeCheckpoint(run, leader)
	if err != nil {
		t.Fatal(err)
	}
	leader.CurrentHP = 0
	ally.CurrentHP = 0
	ally.AvatarURL = "new art"
	leader.RuntimeRevision = 8
	ally.RuntimeRevision = 10
	if err = restoreRoguelikeCheckpoint(run); err != nil {
		t.Fatal(err)
	}
	if leader.CurrentHP != 14 || ally.CurrentHP != 12 || leader.RuntimeRevision != 9 || ally.RuntimeRevision != 11 || ally.AvatarURL != "new art" {
		t.Fatal("party checkpoint mismatch")
	}
}
func TestRoguelikePartyBoundItemsUseWorldObjectIdentity(t *testing.T) {
	id := uuid.NewString()
	if !roguelikePartyBoundItem(map[string]any{"objects": []any{map[string]any{"itemCardId": id, "weaponBondActorId": "hero"}}}, id) {
		t.Fatal("bond missed")
	}
	if roguelikePartyBoundItem(map[string]any{"itemCardId": id, "ownerActorId": "hero"}, id) {
		t.Fatal("ordinary inventory blocked")
	}
}
