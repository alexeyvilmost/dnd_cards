package main

import "testing"

func TestRuntimeEquipmentCommandConservesPhysicalItems(t *testing.T) {
	id := "11111111-1111-4111-8111-111111111111"
	for _, slot := range []string{"main_hand", "ring_1"} {
		t.Run(slot, func(t *testing.T) {
			items := InventoryItemRows{{CardID: id, Qty: 1}}
			empty := InventoryItemRows{}
			eq := JSONMap{slot: id}
			none := JSONMap{}
			character := CharacterV3{InventoryItems: &items, Equipment: &none}
			if err := validateRuntimeEquipmentTransition(character, CharacterRuntimeCommandPatch{Equipment: &eq, InventoryItems: &empty}); err != nil {
				t.Fatal(err)
			}
			if err := validateRuntimeEquipmentTransition(character, CharacterRuntimeCommandPatch{Equipment: &eq, InventoryItems: &items}); err == nil {
				t.Fatal("duplicated item accepted")
			}
			character.InventoryItems = &empty
			character.Equipment = &eq
			if err := validateRuntimeEquipmentTransition(character, CharacterRuntimeCommandPatch{Equipment: &none, InventoryItems: &items}); err != nil {
				t.Fatal(err)
			}
			moved := InventoryItemRows{{CardID: id, Qty: 1, ContainerID: "22222222-2222-4222-8222-222222222222"}}
			if err := validateRuntimeEquipmentTransition(character, CharacterRuntimeCommandPatch{Equipment: &none, InventoryItems: &moved}); err == nil {
				t.Fatal("container relocation accepted")
			}
		})
	}
}
