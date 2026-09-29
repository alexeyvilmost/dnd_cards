package main

import (
	"encoding/json"
	"github.com/google/uuid"
	"testing"
)

func TestItemEquipmentPolicyCatalogAuthority(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Card{}); err != nil {
		t.Fatal(err)
	}
	for _, slot := range []string{"ring_1", "boots"} {
		var m JSONMap
		_ = json.Unmarshal([]byte(`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"equipment_policy","cannot_remove":true}]}]}`), &m)
		card := Card{ID: uuid.New(), Name: "Curse " + slot, CardNumber: "curse-" + slot, Description: "cannot remove", Rarity: "common", Mechanics: &m}
		if err := f.db.Create(&card).Error; err != nil {
			t.Fatal(err)
		}
		equipment := JSONMap{slot: card.ID.String()}
		character := CharacterV3{ID: uuid.New(), Equipment: &equipment}
		for _, next := range []JSONMap{{}, {slot: uuid.NewString()}, {"other": card.ID.String()}} {
			if err := validateItemEquipmentChange(f.db, character, &next); err == nil {
				t.Fatal("accepted removal", slot)
			}
		}
		preserved := JSONMap{slot: card.ID.String(), "head": uuid.NewString()}
		if err := validateItemEquipmentChange(f.db, character, &preserved); err != nil {
			t.Fatal(err)
		}
		if err := validateItemEquipmentChange(f.db, CharacterV3{ID: uuid.New()}, &equipment); err != nil {
			t.Fatal(err)
		}
	}
}
