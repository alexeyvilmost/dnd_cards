package main

import (
	"encoding/json"
	"github.com/google/uuid"
	"testing"
)

func capacityCard(ref string, delta int, mode string, attunable bool) Card {
	var mechanics JSONMap
	raw, _ := json.Marshal(map[string]any{"activation": map[string]any{"mode": "passive", "while": mode}, "effects": []any{map[string]any{"resolution": "auto", "result": []any{map[string]any{"kind": "attunement_capacity", "amount": delta}}}}})
	_ = json.Unmarshal(raw, &mechanics)
	return Card{ID: uuid.New(), CardNumber: ref, Name: ref, Description: "capacity", Rarity: "common", Mechanics: &mechanics, RequiresAttunement: &attunable}
}

func TestItemAttunementCapacityUsesCatalogGates(t *testing.T) {
	ring := capacityCard("RING", 1, "equipped", true)
	curse := capacityCard("CURSE", -1, "carried", false)
	equipment := JSONMap{"ring_1": ring.ID.String(), "ring_2": ring.ID.String()}
	inventory := InventoryItemRows{{CardID: curse.ID.String(), Qty: 1}}
	cards := []Card{ring, ring, curse}
	if got := catalogAttunementCapacity(cards, &equipment, &inventory, []string{ring.ID.String()}); got != 3 {
		t.Fatalf("duplicate/gate capacity=%d", got)
	}
	if got := catalogAttunementCapacity(cards, &equipment, &inventory, nil); got != 2 {
		t.Fatalf("unattuned capacity=%d", got)
	}
	if got := catalogAttunementCapacity(cards, &equipment, nil, []string{ring.ID.String()}); got != 4 {
		t.Fatalf("missing curse capacity=%d", got)
	}
}

func TestCampCapacityCatalogAuthorityAndReduction(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&Card{}); err != nil {
		t.Fatal(err)
	}
	ring := capacityCard("CAPACITY-RING", 1, "equipped", false)
	cards := []Card{ring}
	var ids []string
	inventory := InventoryItemRows{{CardID: ring.ID.String(), Qty: 1}}
	for i := 0; i < 4; i++ {
		card := capacityCard(uuid.NewString(), 0, "equipped", true)
		cards = append(cards, card)
		ids = append(ids, card.ID.String())
		inventory = append(inventory, InventoryItemRow{CardID: card.ID.String(), Qty: 1})
	}
	if err := fixture.db.Create(&cards).Error; err != nil {
		t.Fatal(err)
	}
	equipment := JSONMap{"ring_1": ring.ID.String()}
	before := JSONMap{"attunement_unlocked": true}
	after := JSONMap{"attunement_unlocked": true, "attuned_ids": ids}
	character := CharacterV3{ID: uuid.New(), Equipment: &equipment, InventoryItems: &inventory, TurnState: &before}
	if err := validateRoguelikeCampAttunementCards(fixture.db, character, PatchCharacterRuntimeRequest{TurnState: &after}); err != nil {
		t.Fatal(err)
	}
	emptyEquipment := JSONMap{}
	if err := validateRoguelikeCampAttunementCards(fixture.db, character, PatchCharacterRuntimeRequest{TurnState: &after, Equipment: &emptyEquipment}); err == nil {
		t.Fatal("accepted four attunements without equipped provider")
	}
	character.TurnState = &after
	reduced := JSONMap{"attunement_unlocked": true, "attuned_ids": ids[:3]}
	if err := validateRoguelikeCampAttunementCards(fixture.db, character, PatchCharacterRuntimeRequest{TurnState: &reduced, Equipment: &emptyEquipment}); err != nil {
		t.Fatal(err)
	}
}
