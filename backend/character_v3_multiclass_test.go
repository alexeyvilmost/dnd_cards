package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestValidateCharacterClassLevels(t *testing.T) {
	fighter := uuid.MustParse("2705eb12-1556-40c8-bdae-671e8f5c67eb")
	wizard := uuid.MustParse("d3b22b24-a4f1-4dab-8038-c89bfee62843")
	valid := JSONMap{fighter.String(): float64(1), wizard.String(): float64(1)}
	character := CharacterV3{ClassID: &fighter, ClassLevels: &valid, Level: 2}
	if err := validateCharacterClassLevels(character); err != nil {
		t.Fatalf("valid multiclass rejected: %v", err)
	}

	badTotal := JSONMap{fighter.String(): float64(1)}
	character.ClassLevels = &badTotal
	if err := validateCharacterClassLevels(character); err == nil {
		t.Fatal("mismatched total accepted")
	}

	missingPrimary := JSONMap{wizard.String(): float64(2)}
	character.ClassLevels = &missingPrimary
	if err := validateCharacterClassLevels(character); err == nil {
		t.Fatal("missing primary class accepted")
	}
}
