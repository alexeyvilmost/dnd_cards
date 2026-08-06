package main

import (
	"errors"
	"strings"
	"testing"
)

func completeRollPayload() JSONMap {
	return JSONMap{
		"type":  "roll",
		"label": "Attack roll",
		"roll": map[string]any{
			"kind":      "d20",
			"dice":      []any{map[string]any{"sides": float64(20), "result": float64(15), "discarded": false, "source": "base", "sign": float64(1)}},
			"advantage": "none",
			"modifiers": []any{map[string]any{"value": float64(2), "source": "DEX", "reason": "ability modifier"}},
			"total":     float64(17),
			"target":    map[string]any{"type": "ac", "value": float64(14)},
			"outcome":   "hit",
			"text":      "d20: 15 +2 = 17",
			"triggered": []any{map[string]any{"kind": "modifier", "value": float64(1)}},
		},
	}
}

func TestValidateCharacterEventAcceptsCurrentEngineEventUnion(t *testing.T) {
	valid := []JSONMap{
		completeRollPayload(),
		{"type": "damage", "amount": float64(7), "damageType": "fire", "source": "Wizard"},
		{"type": "healing", "amount": float64(4), "source": "Cleric"},
		{"type": "damage_reduction", "amount": float64(2)},
		{"type": "temp_hp", "amount": float64(5), "source": "Spell"},
		{"type": "resource_spent", "resource": "spell_slot_1", "amount": float64(1), "remaining": float64(0)},
		{"type": "resource_restored", "resource": "second_wind", "amount": float64(1), "current": float64(1)},
		{"type": "item_consumed", "cardId": "potion", "amount": float64(1), "remaining": float64(0), "name": "Potion"},
		{"type": "item_added", "cardId": "arrow", "qty": float64(2), "total": float64(20), "name": "Arrow"},
		{"type": "effect_applied", "name": "Bless", "sourceAction": "Cast", "source": "Cleric"},
		{"type": "effect_expired", "name": "Bless"},
		{"type": "condition_applied", "condition": "prone", "source": "Topple"},
		{"type": "condition_immune", "condition": "poisoned", "sourceEntityIds": []any{}, "source": "Dwarf"},
		{"type": "movement", "mode": "push", "distanceFt": float64(10), "source": "Push"},
		{"type": "turn_started"},
		{"type": "turn_ended"},
		{"type": "short_rest"},
		{"type": "long_rest"},
		{"type": "narrative", "text": "Fire resistance", "damageAdjustment": map[string]any{
			"damageType": "fire", "adjustment": "resistance", "before": float64(9), "after": float64(4), "sourceEntityIds": []any{"effect:dwarf"},
		}},
	}

	for _, payload := range valid {
		eventType := payload["type"].(string)
		t.Run(eventType, func(t *testing.T) {
			if err := validateCharacterEvent(eventType, payload); err != nil {
				t.Fatalf("valid %s rejected: %v", eventType, err)
			}
		})
	}
}

func TestValidateCharacterEventRejectsMalformedOrAmbiguousPayloads(t *testing.T) {
	tooLong := strings.Repeat("x", maxCharacterEventStringBytes+1)
	tests := []struct {
		name      string
		eventType string
		payload   JSONMap
		want      string
	}{
		{name: "nil payload", eventType: "damage", payload: nil, want: "must be a JSON object"},
		{name: "outer type mismatch", eventType: "healing", payload: JSONMap{"type": "damage", "amount": float64(1), "damageType": "fire"}, want: "must exactly match"},
		{name: "unsupported type", eventType: "custom", payload: JSONMap{"type": "custom"}, want: "not a supported"},
		{name: "unknown field", eventType: "damage", payload: JSONMap{"type": "damage", "amount": float64(1), "damageType": "fire", "effectId": "injected"}, want: "is not allowed"},
		{name: "missing damage type", eventType: "damage", payload: JSONMap{"type": "damage", "amount": float64(1)}, want: "damageType: is required"},
		{name: "fractional damage", eventType: "damage", payload: JSONMap{"type": "damage", "amount": 1.5, "damageType": "fire"}, want: "non-negative safe integer"},
		{name: "null optional source", eventType: "healing", payload: JSONMap{"type": "healing", "amount": float64(1), "source": nil}, want: "bounded string"},
		{name: "empty condition", eventType: "condition_applied", payload: JSONMap{"type": "condition_applied", "condition": "  "}, want: "bounded string"},
		{name: "empty item quantity", eventType: "item_added", payload: JSONMap{"type": "item_added", "cardId": "arrow", "qty": float64(0), "total": float64(0)}, want: "positive safe integer"},
		{name: "turn payload injection", eventType: "turn_started", payload: JSONMap{"type": "turn_started", "actor": "other"}, want: "is not allowed"},
		{name: "oversized narrative", eventType: "narrative", payload: JSONMap{"type": "narrative", "text": tooLong}, want: "bounded string"},
		{name: "invalid damage adjustment", eventType: "narrative", payload: JSONMap{"type": "narrative", "text": "audit", "damageAdjustment": map[string]any{
			"damageType": "fire", "adjustment": "double", "before": float64(4), "after": float64(8), "sourceEntityIds": []any{},
		}}, want: "is unsupported"},
		{name: "roll missing shape", eventType: "roll", payload: JSONMap{"type": "roll", "label": "Save", "roll": map[string]any{"kind": "save"}}, want: "dice: is required"},
		{name: "roll die outside sides", eventType: "roll", payload: JSONMap{"type": "roll", "label": "Attack", "roll": map[string]any{
			"kind": "d20", "dice": []any{map[string]any{"sides": float64(20), "result": float64(21)}}, "advantage": "none", "modifiers": []any{}, "total": float64(21), "text": "21",
		}}, want: "between 1 and sides"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateCharacterEvent(test.eventType, test.payload)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v, want substring %q", err, test.want)
			}
			var validationErr *characterEventValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("error must retain validation type: %T", err)
			}
		})
	}
}

func TestCharacterEventModelHookUsesSameValidator(t *testing.T) {
	event := CharacterEvent{Type: "damage", Payload: JSONMap{"type": "healing", "amount": float64(1)}}
	var validationErr *characterEventValidationError
	if err := event.BeforeCreate(nil); !errors.As(err, &validationErr) {
		t.Fatalf("BeforeCreate error=%v, want characterEventValidationError", err)
	}
}
