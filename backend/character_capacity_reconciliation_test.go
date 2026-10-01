package main

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCharacterMaximumGrowthPreservesHPShareAndSpentResources(t *testing.T) {
	for _, test := range []struct{ current, before, after, expected int }{{10, 10, 20, 20}, {5, 10, 20, 10}, {1, 10, 20, 2}, {0, 10, 20, 0}, {5, 10, 15, 8}, {1, 20, 5, 1}} {
		if got := characterCurrentHPForMaximum(test.current, test.before, test.after); got != test.expected {
			t.Errorf("HP %d/%d -> max %d: got %d want %d", test.current, test.before, test.after, got, test.expected)
		}
	}
	character := CharacterV3{MaxHP: 10, CurrentHP: 5, Resources: &JSONMap{"spell_slot_1": 0, "class_pool": 1, "dormant_item": 0}, MaxResources: &JSONMap{"spell_slot_1": 2, "class_pool": 3, "dormant_item": 0}, TurnState: &JSONMap{"temp_hp": 7}}
	maximum, staleHP := 20, 20
	request := PatchCharacterRuntimeRequest{MaxHP: &maximum, CurrentHP: &staleHP, Resources: &JSONMap{"spell_slot_1": 3, "class_pool": 4, "spell_slot_2": 0, "dormant_item": 2}, MaxResources: &JSONMap{"spell_slot_1": 3, "class_pool": 4, "spell_slot_2": 2, "dormant_item": 2}}
	updates := runtimeUpdatesForLockedCharacter(character, request, map[string]bool{"dormant_item": true})
	if updates["current_hp"] != 10 {
		t.Fatalf("stale submitted HP replaced the authoritative proportion: %v", updates)
	}
	resources := updates["resources"].(*JSONMap)
	for key, expected := range map[string]int{"spell_slot_1": 1, "class_pool": 2, "spell_slot_2": 2, "dormant_item": 0} {
		if value, _ := resourceCapacityNumber((*resources)[key]); value != expected {
			t.Errorf("%s got %v want %d", key, (*resources)[key], expected)
		}
	}
	if _, changed := updates["turn_state"]; changed {
		t.Fatal("maximum reconciliation changed temporary HP")
	}
	encounter := uuid.New()
	character.CurrentEncounterID = &encounter
	if _, changed := runtimeUpdatesForLockedCharacter(character, request)["current_hp"]; changed {
		t.Fatal("encounter-owned HP was changed by a build reconciliation")
	}
}

func TestCharacterMaximumGrowthThroughLockedSaveAndRuntimePatch(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&Card{}); err != nil {
		t.Fatal(err)
	}
	token := fixture.token(t, fixture.owner)
	for _, source := range []string{"class level", "constitution source"} {
		character := testCharacterV3(fixture.owner.ID, source)
		character.CurrentHP = 5
		character.Resources = &JSONMap{"spell_slot_1": 0, "class_pool": 1}
		character.MaxResources = &JSONMap{"spell_slot_1": 2, "class_pool": 3}
		character.TurnState = &JSONMap{"temp_hp": 7}
		if err := fixture.db.Create(&character).Error; err != nil {
			t.Fatal(err)
		}
		path := "/api/characters-v3/" + character.ID.String()
		saved := performCharacterV3Request(t, fixture.router, http.MethodPut, path, token, map[string]any{"name": source, "level": 1, "max_hp": 20, "current_hp": 20})
		var updated CharacterV3
		if saved.Code != http.StatusOK || json.Unmarshal(saved.Body.Bytes(), &updated) != nil || updated.CurrentHP != 10 || updated.MaxHP != 20 {
			t.Fatalf("%s PUT did not preserve half vitality: %d %s", source, saved.Code, saved.Body.String())
		}
		patch := map[string]any{"max_hp": 30, "current_hp": 30, "max_resources": map[string]any{"spell_slot_1": 3, "spell_slot_2": 2, "class_pool": 4}, "resources": map[string]any{"spell_slot_1": 3, "spell_slot_2": 0, "class_pool": 4}, "expected_runtime_revision": updated.RuntimeRevision}
		patched := performCharacterV3Request(t, fixture.router, http.MethodPatch, path+"/runtime", token, patch)
		if patched.Code != http.StatusOK || json.Unmarshal(patched.Body.Bytes(), &updated) != nil {
			t.Fatalf("%s PATCH failed: %d %s", source, patched.Code, patched.Body.String())
		}
		if updated.CurrentHP != 15 || updated.MaxHP != 30 {
			t.Fatalf("%s PATCH HP = %d/%d", source, updated.CurrentHP, updated.MaxHP)
		}
		for key, expected := range map[string]int{"spell_slot_1": 1, "spell_slot_2": 2, "class_pool": 2} {
			if got, _ := resourceCapacityNumber((*updated.Resources)[key]); got != expected {
				t.Fatalf("%s %s current=%d expected=%d", source, key, got, expected)
			}
		}
		if temp, _ := resourceCapacityNumber((*updated.TurnState)["temp_hp"]); temp != 7 {
			t.Fatal("temporary HP were rescaled")
		}
		// A save retry after the committed increase does not grow HP again.
		repeated := performCharacterV3Request(t, fixture.router, http.MethodPut, path, token, map[string]any{"name": source, "level": 1, "max_hp": 30, "current_hp": 30})
		if repeated.Code != http.StatusOK || json.Unmarshal(repeated.Body.Bytes(), &updated) != nil || updated.CurrentHP != 15 {
			t.Fatalf("save retry changed committed HP: %d %s", repeated.Code, repeated.Body.String())
		}
	}
}

func TestDormantOwnedItemResourceDoesNotRefillOnReactivation(t *testing.T) {
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Card{}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"first_item_pool", "second_item_pool"} {
		item := Card{ID: uuid.New(), Name: "Renamed item", CardNumber: uuid.NewString(), Mechanics: &JSONMap{"effects": []any{map[string]any{"result": []any{map[string]any{"kind": "resource", "op": "grant", "id": key, "amount": 2}}}}}}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		character := CharacterV3{Resources: &JSONMap{key: 0}, MaxResources: &JSONMap{key: 0}, InventoryItems: &InventoryItemRows{{CardID: item.ID.String(), Qty: 1}}}
		request := PatchCharacterRuntimeRequest{Resources: &JSONMap{key: 2}, MaxResources: &JSONMap{key: 2}}
		pools, err := dormantCharacterItemResourcePools(db, character, request)
		if err != nil || !pools[key] {
			t.Fatalf("item grant pool missing: %v %v", pools, err)
		}
		updates := runtimeUpdatesForLockedCharacter(character, request, pools)
		if current, _ := resourceCapacityNumber((*updates["resources"].(*JSONMap))[key]); current != 0 {
			t.Fatal("re-equipping an item restored spent charges")
		}
	}
}
