package main

import (
	"bytes"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestDecodeCharacterRuntimeCommandRejectsAmbiguousAndUnknownJSON(t *testing.T) {
	validRuleset := `"ruleset_ref":{"system_id":"dnd5e-2024","release_id":"micro","content_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","errata_version":"2024.1"}`
	characterID := uuid.NewString()
	commandID := uuid.NewString()
	for name, raw := range map[string]string{
		"duplicate command id":    fmt.Sprintf(`{"command_id":%q,"command_id":%q,%s,"participants":[{"character_id":%q,"expected_runtime_revision":0,"patch":{"current_hp":1}}],"events":[]}`, commandID, commandID, validRuleset, characterID),
		"unknown patch field":     fmt.Sprintf(`{"command_id":%q,%s,"participants":[{"character_id":%q,"expected_runtime_revision":0,"patch":{"equipment":{}}}],"events":[]}`, commandID, validRuleset, characterID),
		"immutable build field":   fmt.Sprintf(`{"command_id":%q,%s,"participants":[{"character_id":%q,"expected_runtime_revision":0,"patch":{"action_ids":[]}}],"events":[]}`, commandID, validRuleset, characterID),
		"unknown inventory field": fmt.Sprintf(`{"command_id":%q,%s,"participants":[{"character_id":%q,"expected_runtime_revision":0,"patch":{"inventory_items":[{"card_id":%q,"qty":1,"name":"forged"}]}}],"events":[]}`, commandID, validRuleset, characterID, uuid.NewString()),
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := decodeCharacterRuntimeCommand([]byte(raw))
			var commandErr *characterRuntimeCommandError
			if !errors.As(err, &commandErr) || commandErr.Code != "invalid_runtime_command" {
				t.Fatalf("error=%v, want invalid_runtime_command", err)
			}
		})
	}
}

func TestDecodeCharacterRuntimeCommandAcceptsActiveEffectLibraryIdentity(t *testing.T) {
	characterID := uuid.NewString()
	effectID := uuid.NewString()
	raw := fmt.Sprintf(`{"command_id":%q,"ruleset_ref":{"system_id":"dnd5e-2024","release_id":"micro","content_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","errata_version":"2024.1"},"participants":[{"character_id":%q,"expected_runtime_revision":0,"patch":{"active_effects":[{"id":"runtime-effect","name":"Bardic Inspiration","mechanics":{},"source":"Bardic Inspiration","entityRef":{"kind":"effect","id":%q,"cardNumber":"EFFECT-TEST"}}]}}],"events":[]}`,
		uuid.NewString(), characterID, effectID,
	)
	request, _, err := decodeCharacterRuntimeCommand([]byte(raw))
	if err != nil {
		t.Fatalf("library-linked active effect rejected: %v", err)
	}
	if err := validateRuntimeCommandPatch(request.Participants[0].Patch); err != nil {
		t.Fatalf("library-linked active effect failed shape validation: %v", err)
	}
	ref := (*request.Participants[0].Patch.ActiveEffects)[0].EntityRef
	if ref == nil || ref.Kind != "effect" || ref.ID != effectID || ref.CardNumber != "EFFECT-TEST" {
		t.Fatalf("entity identity did not round-trip: %#v", ref)
	}
}

func TestDecodeCharacterRuntimeCommandRejectsGenericConditionsAndMasteryEffects(t *testing.T) {
	characterID := uuid.NewString()
	for name, mechanics := range map[string]string{
		"condition":      `{"kind":"condition","value":"prone"}`,
		"weapon mastery": `{"kind":"modifier","stack_id":"weapon-mastery:sap"}`,
	} {
		t.Run(name, func(t *testing.T) {
			raw := fmt.Sprintf(`{"command_id":%q,"ruleset_ref":{"system_id":"dnd5e-2024","release_id":"micro","content_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","errata_version":"2024.1"},"participants":[{"character_id":%q,"expected_runtime_revision":0,"patch":{"active_effects":[{"id":"runtime-effect","name":"Generic","mechanics":%s,"source":"Generic"}]}}],"events":[]}`,
				uuid.NewString(), characterID, mechanics,
			)
			request, _, err := decodeCharacterRuntimeCommand([]byte(raw))
			if err != nil {
				t.Fatalf("shape decode failed before invariant validation: %v", err)
			}
			if err := validateRuntimeCommandPatch(request.Participants[0].Patch); err == nil {
				t.Fatal("generic actor effect was accepted without an effects-library identity")
			}
		})
	}
}

func TestRuntimeCommandInventorySnapshotIsStrictAndBounded(t *testing.T) {
	cardID := uuid.NewString()
	containerID := uuid.NewString()
	valid := InventoryItemRows{
		{CardID: containerID, Qty: 1},
		{CardID: cardID, Qty: 3, ContainerID: containerID},
	}
	if err := validateRuntimeCommandInventoryRows(&valid); err != nil {
		t.Fatalf("valid inventory snapshot rejected: %v", err)
	}

	tooMany := make(InventoryItemRows, maxEncounterRuntimeRows+1)
	for index := range tooMany {
		tooMany[index] = InventoryItemRow{CardID: uuid.NewString(), Qty: 1}
	}
	for name, rows := range map[string]InventoryItemRows{
		"too many":           tooMany,
		"invalid card":       {{CardID: "CARD-forged", Qty: 1}},
		"zero quantity":      {{CardID: cardID, Qty: 0}},
		"oversized quantity": {{CardID: cardID, Qty: maxEncounterRuntimeValue + 1}},
		"duplicate identity": {{CardID: cardID, Qty: 1}, {CardID: cardID, Qty: 1}},
		"self container":     {{CardID: cardID, Qty: 1, ContainerID: cardID}},
		"missing container":  {{CardID: cardID, Qty: 1, ContainerID: containerID}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateRuntimeCommandInventoryRows(&rows); err == nil {
				t.Fatalf("invalid inventory snapshot accepted: %#v", rows)
			}
		})
	}
}

func TestRuntimeCommandInventoryTransitionAllowsConsumptionOnly(t *testing.T) {
	cardID := uuid.NewString()
	containerID := uuid.NewString()
	otherContainerID := uuid.NewString()
	current := InventoryItemRows{
		{CardID: containerID, Qty: 1},
		{CardID: otherContainerID, Qty: 1},
		{CardID: cardID, Qty: 3, ContainerID: containerID},
	}
	consumed := InventoryItemRows{
		{CardID: containerID, Qty: 1},
		{CardID: otherContainerID, Qty: 1},
		{CardID: cardID, Qty: 2, ContainerID: containerID},
	}
	updates, err := runtimeCommandUpdates(CharacterV3{
		MaxHP: 10, InventoryItems: &current,
	}, CharacterRuntimeCommandPatch{InventoryItems: &consumed})
	if err != nil || updates["inventory_items"] == nil {
		t.Fatalf("inventory consumption rejected: updates=%#v error=%v", updates, err)
	}

	added := append(InventoryItemRows{}, consumed...)
	added = append(added, InventoryItemRow{CardID: uuid.NewString(), Qty: 1})
	increased := append(InventoryItemRows{}, current...)
	increased[2].Qty = 4
	moved := append(InventoryItemRows{}, current...)
	moved[2].ContainerID = otherContainerID
	for name, rows := range map[string]InventoryItemRows{
		"add": added, "increase": increased, "move": moved,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := runtimeCommandUpdates(CharacterV3{
				MaxHP: 10, InventoryItems: &current,
			}, CharacterRuntimeCommandPatch{InventoryItems: &rows}); err == nil {
				t.Fatalf("inventory %s mutation was accepted", name)
			}
		})
	}
}

func TestValidateCharacterRuntimeCommandRequiresStableParticipantOrder(t *testing.T) {
	first := uuid.NewString()
	second := uuid.NewString()
	if first < second {
		first, second = second, first
	}
	hp := 1
	request := CharacterRuntimeCommandRequest{
		CommandID: uuid.NewString(), RulesetRef: testRuntimeCommandRuleset(),
		Participants: []CharacterRuntimeCommandParticipant{
			{CharacterID: first, Patch: CharacterRuntimeCommandPatch{CurrentHP: &hp}},
			{CharacterID: second, Patch: CharacterRuntimeCommandPatch{CurrentHP: &hp}},
		},
	}
	_, _, err := validateCharacterRuntimeCommand(request)
	var commandErr *characterRuntimeCommandError
	if !errors.As(err, &commandErr) || commandErr.Code != "invalid_runtime_command" {
		t.Fatalf("error=%v, want invalid_runtime_command", err)
	}
}

func TestRuntimeCommandUpdatesRejectsResourceAboveDeclaredMaximum(t *testing.T) {
	resources := JSONMap{"spell_slot_1": 2}
	maximums := JSONMap{"spell_slot_1": 1}
	_, err := runtimeCommandUpdates(CharacterV3{MaxHP: 10}, CharacterRuntimeCommandPatch{
		Resources: &resources, MaxResources: &maximums,
	})
	var commandErr *characterRuntimeCommandError
	if !errors.As(err, &commandErr) || commandErr.Code != "invalid_runtime_command" {
		t.Fatalf("error=%v, want invalid_runtime_command", err)
	}
}

func TestRuntimeCommandValidationRejectsNullNumericRuntimeValuesAndUnstableRulesetIDs(t *testing.T) {
	characterID := uuid.NewString()
	hp := 1
	base := CharacterRuntimeCommandRequest{
		CommandID: uuid.NewString(), RulesetRef: testRuntimeCommandRuleset(),
		Participants: []CharacterRuntimeCommandParticipant{{
			CharacterID: characterID,
			Patch:       CharacterRuntimeCommandPatch{CurrentHP: &hp},
		}},
	}

	for name, mutate := range map[string]func(*CharacterRuntimeCommandRequest){
		"null resource": func(request *CharacterRuntimeCommandRequest) {
			values := JSONMap{"spell_slot_1": nil}
			request.Participants[0].Patch = CharacterRuntimeCommandPatch{Resources: &values}
		},
		"null maximum": func(request *CharacterRuntimeCommandRequest) {
			values := JSONMap{"spell_slot_1": nil}
			request.Participants[0].Patch = CharacterRuntimeCommandPatch{MaxResources: &values}
		},
		"null currency": func(request *CharacterRuntimeCommandRequest) {
			values := JSONMap{"gp": nil}
			request.Participants[0].Patch = CharacterRuntimeCommandPatch{Currency: &values}
		},
		"padded release": func(request *CharacterRuntimeCommandRequest) {
			request.RulesetRef.ReleaseID = " " + request.RulesetRef.ReleaseID
		},
		"padded errata": func(request *CharacterRuntimeCommandRequest) {
			request.RulesetRef.ErrataVersion += " "
		},
	} {
		t.Run(name, func(t *testing.T) {
			request := base
			request.Participants = append([]CharacterRuntimeCommandParticipant(nil), base.Participants...)
			mutate(&request)
			_, _, err := validateCharacterRuntimeCommand(request)
			var commandErr *characterRuntimeCommandError
			if !errors.As(err, &commandErr) || commandErr.Code != "invalid_runtime_command" {
				t.Fatalf("error=%v, want invalid_runtime_command", err)
			}
		})
	}
}

func TestDecodeCharacterRuntimeCommandHasDefenseInDepthBodyBound(t *testing.T) {
	_, _, err := decodeCharacterRuntimeCommand(bytes.Repeat(
		[]byte(" "), int(maxCharacterRuntimeCommandBodyBytes+1),
	))
	var commandErr *characterRuntimeCommandError
	if !errors.As(err, &commandErr) || commandErr.Status != 413 || commandErr.Code != "runtime_command_too_large" {
		t.Fatalf("oversized error=%v, want runtime_command_too_large/413", err)
	}
}

func TestRuntimeCommandTurnStateMergePreservesSiblingsAndUsesNullAsDelete(t *testing.T) {
	current := JSONMap{
		"death_saves":           map[string]any{"successes": 1},
		"sheet_canonical_world": map[string]any{"revision": 1},
	}
	patch := JSONMap{
		"death_saves": nil,
		"temp_hp":     4,
	}
	merged := mergeRuntimeCommandTurnState(&current, &patch)
	if _, exists := (*merged)["death_saves"]; exists {
		t.Fatal("null turn_state patch did not delete the requested key")
	}
	if (*merged)["sheet_canonical_world"] == nil || (*merged)["temp_hp"] != 4 {
		t.Fatalf("turn_state merge lost a sibling or new value: %#v", *merged)
	}
	if current["death_saves"] == nil || current["temp_hp"] != nil {
		t.Fatalf("turn_state merge mutated the caller's current map: %#v", current)
	}
}
