package main

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestValidateRoguelikeCampRuntimePatchPreservesOwnership(t *testing.T) {
	characterID := uuid.New()
	cardID := uuid.New().String()
	oldEquipment := JSONMap{"main_hand": nil, "off_hand": nil}
	oldInventory := InventoryItemRows{{CardID: cardID, Qty: 1}}
	character := CharacterV3{
		ID: characterID, CurrentHP: 8, MaxHP: 12,
		Equipment: &oldEquipment, InventoryItems: &oldInventory,
	}
	newEquipment := JSONMap{"main_hand": cardID, "off_hand": nil}
	newInventory := InventoryItemRows{}
	currentHP, maxHP := 8, 12
	if err := validateRoguelikeCampRuntimePatch(character, PatchCharacterRuntimeRequest{
		CurrentHP: &currentHP, MaxHP: &maxHP,
		Equipment: &newEquipment, InventoryItems: &newInventory,
	}); err != nil {
		t.Fatalf("valid equipment transfer rejected: %v", err)
	}

	injected := uuid.New().String()
	newEquipment["off_hand"] = injected
	err := validateRoguelikeCampRuntimePatch(character, PatchCharacterRuntimeRequest{
		Equipment: &newEquipment, InventoryItems: &newInventory,
	})
	var conflict *characterRuntimeCommandError
	if !errors.As(err, &conflict) || conflict.Code != "roguelike_item_ownership_changed" {
		t.Fatalf("injected item was not rejected with ownership conflict: %#v", err)
	}
}

func TestRoguelikeTwoHandedOwnershipIsOrderIndependent(t *testing.T) {
	cardID := uuid.New().String()
	equipment := JSONMap{"main_hand": cardID, "off_hand": cardID}
	for attempt := 0; attempt < 100; attempt++ {
		owned, err := roguelikeItemOwnership(&equipment, nil)
		if err != nil || owned[cardID] != 1 {
			t.Fatalf("two-handed item counted incorrectly on attempt %d: owned=%#v error=%v", attempt, owned, err)
		}
	}
	character := CharacterV3{ID: uuid.New(), Equipment: &equipment}
	emptyEquipment := JSONMap{"main_hand": nil, "off_hand": nil}
	inventory := InventoryItemRows{{CardID: cardID, Qty: 1}}
	if err := validateRoguelikeCampRuntimePatch(character, PatchCharacterRuntimeRequest{
		Equipment: &emptyEquipment, InventoryItems: &inventory,
	}); err != nil {
		t.Fatalf("unequipping a two-handed item changed ownership: %v", err)
	}
}

func TestValidateRoguelikeCampRuntimePatchRejectsRuntimeSmuggling(t *testing.T) {
	character := CharacterV3{ID: uuid.New(), CurrentHP: 4, MaxHP: 12}
	healed := 12
	err := validateRoguelikeCampRuntimePatch(character, PatchCharacterRuntimeRequest{CurrentHP: &healed})
	var conflict *characterRuntimeCommandError
	if !errors.As(err, &conflict) || conflict.Code != "roguelike_camp_patch_forbidden" {
		t.Fatalf("HP smuggling was not rejected: %#v", err)
	}
}

func TestValidateRoguelikeCampRuntimePatchAllowsOwnedAttunementOnly(t *testing.T) {
	cardID := uuid.New().String()
	inventory := InventoryItemRows{{CardID: cardID, Qty: 1}}
	before := JSONMap{"temp_hp": float64(0)}
	after := JSONMap{"temp_hp": float64(0), "attuned_ids": []any{cardID}}
	character := CharacterV3{ID: uuid.New(), InventoryItems: &inventory, TurnState: &before}
	if err := validateRoguelikeCampRuntimePatch(character, PatchCharacterRuntimeRequest{TurnState: &after}); err != nil {
		t.Fatalf("owned attunement rejected: %v", err)
	}

	after["attuned_ids"] = []any{uuid.New().String()}
	err := validateRoguelikeCampRuntimePatch(character, PatchCharacterRuntimeRequest{TurnState: &after})
	var conflict *characterRuntimeCommandError
	if !errors.As(err, &conflict) || conflict.Code != "roguelike_attunement_invalid" {
		t.Fatalf("foreign attunement was not rejected: %#v", err)
	}
}
