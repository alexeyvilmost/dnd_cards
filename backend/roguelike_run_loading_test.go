package main

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestOwnedRunLoadsPartyLeaderOnceAndKeepsSoloAccess(t *testing.T) {
	for _, party := range []bool{false, true} {
		f := openCharacterV3AccessFixture(t)
		if err := f.db.AutoMigrate(&RoguelikeRun{}); err != nil {
			t.Fatal(err)
		}
		run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, CharacterID: f.ownerCharacter.ID, SourceCharacterID: f.ownerCharacter.ID,
			Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat, Attempt: 1, RunSeed: "loading-test", Party: JSONMap{},
			CombatEnvelope: JSONMap{}, CombatCatalog: JSONMap{}, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
		if party {
			run.Party, _ = mapFromJSON(map[string]any{"members": []roguelikePartyMember{{CharacterID: f.ownerCharacter.ID}, {CharacterID: f.deleteCharacter.ID}}})
		}
		if err := f.db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		queries := 0
		if err := f.db.Callback().Query().After("gorm:query").Register("test:character-loads", func(tx *gorm.DB) {
			if tx.Statement.Table == "characters_v3" {
				queries++
			}
		}); err != nil {
			t.Fatal(err)
		}
		for _, locked := range []bool{false, true} {
			queries = 0
			if err := f.db.Transaction(func(tx *gorm.DB) error {
				loaded, err := ownedRoguelikeRun(tx, run.ID, run.UserID, locked)
				if err != nil {
					return err
				}
				if queries != 1 || loaded.Character == nil || loaded.Character.ID != run.CharacterID || loaded.Character.AccessMode != characterV3AccessOwner {
					t.Fatal("leader load duplicated or owner projection lost")
				}
				if party && (len(loaded.Characters) != 2 || loaded.Characters[0] != loaded.Character || loaded.Characters[1].ID != f.deleteCharacter.ID) {
					t.Fatal("party order or leader alias changed")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := ownedRoguelikeRun(f.db, run.ID, f.other.ID, false); err == nil {
			t.Fatal("foreign owner loaded run")
		}
	}
}
