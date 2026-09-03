package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestValidateCharacterSubclassIDs(t *testing.T) {
	fighter := uuid.MustParse("2705eb12-1556-40c8-bdae-671e8f5c67eb")
	wizard := uuid.MustParse("d3b22b24-a4f1-4dab-8038-c89bfee62843")
	champion := uuid.MustParse("6cdedbaa-429b-4ef9-9747-050379713584")
	evoker := uuid.MustParse("f7b1da62-bd80-4a3a-a2af-ee8f3af47508")
	levels := JSONMap{fighter.String(): float64(3), wizard.String(): float64(3)}
	selections := JSONMap{fighter.String(): champion.String(), wizard.String(): evoker.String()}
	character := CharacterV3{ClassID: &fighter, ClassLevels: &levels, SubclassIDs: &selections, Level: 6}
	if err := validateCharacterSubclassIDs(character); err != nil {
		t.Fatalf("valid per-class subclasses rejected: %v", err)
	}

	unowned := JSONMap{uuid.NewString(): evoker.String()}
	character.SubclassIDs = &unowned
	if err := validateCharacterSubclassIDs(character); err == nil {
		t.Fatal("subclass for an unowned class accepted")
	}
}

func TestCharacterDefaultsBackfillLegacyPrimarySubclass(t *testing.T) {
	fighter := uuid.MustParse("2705eb12-1556-40c8-bdae-671e8f5c67eb")
	champion := uuid.MustParse("6cdedbaa-429b-4ef9-9747-050379713584")
	choices := JSONMap{"builder:subclass": []interface{}{champion.String()}}
	character := CharacterV3{ClassID: &fighter, Level: 3, ResolvedChoices: &choices}
	applyCharacterV3Defaults(&character)
	if character.SubclassIDs == nil || (*character.SubclassIDs)[fighter.String()] != champion.String() {
		t.Fatalf("legacy subclass was not backfilled: %#v", character.SubclassIDs)
	}
}

func TestValidateRequiredSubclassSelection(t *testing.T) {
	fighter := uuid.MustParse("2705eb12-1556-40c8-bdae-671e8f5c67eb")
	champion := uuid.MustParse("6cdedbaa-429b-4ef9-9747-050379713584")
	levels := JSONMap{fighter.String(): float64(3)}
	character := CharacterV3{ClassID: &fighter, ClassLevels: &levels, Level: 3}

	if err := validateRequiredSubclassSelection(character, fighter.String(), 2, 3); err != nil {
		t.Fatalf("subclass was required before its class threshold: %v", err)
	}
	if err := validateRequiredSubclassSelection(character, fighter.String(), 3, 3); err == nil {
		t.Fatal("missing required subclass was accepted at the class threshold")
	}

	selections := JSONMap{fighter.String(): champion.String()}
	character.SubclassIDs = &selections
	if err := validateRequiredSubclassSelection(character, fighter.String(), 3, 3); err != nil {
		t.Fatalf("selected subclass was rejected at the class threshold: %v", err)
	}
}
