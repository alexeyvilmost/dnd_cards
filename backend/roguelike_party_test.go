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

func TestRoguelikeOccupiedSourcesIncludesEntireHistoryAndEveryPartyMember(t *testing.T) {
	runs := make([]RoguelikeRun, 51)
	for i := range runs {
		runs[i] = RoguelikeRun{SourceCharacterID: uuid.New(), CharacterID: uuid.New()}
	}
	leader, ally := uuid.New(), uuid.New()
	runs[50].Party, _ = mapFromJSON(map[string]any{"members": []roguelikePartyMember{
		{CharacterID: uuid.New(), SourceCharacterID: leader},
		{CharacterID: uuid.New(), SourceCharacterID: ally},
	}})
	ids := roguelikeOccupiedSources(runs)
	if len(ids) != 52 {
		t.Fatalf("expected all sources, got %d", len(ids))
	}
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if !seen[runs[0].SourceCharacterID.String()] || !seen[leader.String()] || !seen[ally.String()] {
		t.Fatal("history or party source missing")
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

func TestRoguelikePartyLevelConfirmationAllowsSequentialCatchup(t *testing.T) {
	for _, mode := range []string{"classic", urvinMode} {
		t.Run(mode, func(t *testing.T) {
			user := uuid.New()
			leader := &CharacterV3{ID: uuid.New(), UserID: user, Level: 2}
			ally := &CharacterV3{ID: uuid.New(), UserID: user, Level: 1}
			run := &RoguelikeRun{
				Mode: mode, UserID: user, CharacterID: leader.ID, Character: leader,
				Characters: []*CharacterV3{leader, ally}, Experience: 900, PendingLevel: 2,
				Phase: RoguelikePhaseCamp, Status: RoguelikeStatusActive,
			}
			run.Party, _ = mapFromJSON(map[string]any{"members": []roguelikePartyMember{
				{CharacterID: leader.ID}, {CharacterID: ally.ID},
			}})
			if err := confirmRoguelikeLevelUp(run); err != nil || run.PendingLevel != 2 {
				t.Fatalf("first member could not wait for the level-2 party: pending=%d err=%v", run.PendingLevel, err)
			}
			ally.Level = 2
			if err := confirmRoguelikeLevelUp(run); err != nil || run.PendingLevel != 0 || len(run.Checkpoint) == 0 {
				t.Fatalf("earned level 3 blocked completed level 2: pending=%d err=%v", run.PendingLevel, err)
			}
			if err := startRoguelikeEncounter(nil, run); err == nil {
				t.Fatal("level-2 party could bypass the earned level-3 requirement")
			}
			run.PendingLevel = 3
			leader.Level = 3
			if err := confirmRoguelikeLevelUp(run); err != nil || run.PendingLevel != 3 {
				t.Fatalf("first member could not wait for level 3: pending=%d err=%v", run.PendingLevel, err)
			}
			ally.Level = 3
			if err := confirmRoguelikeLevelUp(run); err != nil || run.PendingLevel != 0 {
				t.Fatalf("earned level-3 party did not finish: pending=%d err=%v", run.PendingLevel, err)
			}
		})
	}
}

func TestRoguelikePartyLevelConfirmationRejectsUnearnedPendingLevel(t *testing.T) {
	leader, ally := &CharacterV3{ID: uuid.New(), Level: 3}, &CharacterV3{ID: uuid.New(), Level: 3}
	run := &RoguelikeRun{CharacterID: leader.ID, Character: leader, Characters: []*CharacterV3{leader, ally}, Experience: 300, PendingLevel: 3}
	run.Party, _ = mapFromJSON(map[string]any{"members": []roguelikePartyMember{{CharacterID: leader.ID}, {CharacterID: ally.ID}}})
	if err := confirmRoguelikeLevelUp(run); err == nil || run.PendingLevel != 3 {
		t.Fatalf("unearned pending level was accepted: pending=%d err=%v", run.PendingLevel, err)
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
