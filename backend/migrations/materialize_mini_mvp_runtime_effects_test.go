package migrations

import (
	"reflect"
	"testing"
)

func TestRewriteDurableTargetPayloadsMaterializesOnlyTargetRuntimeEffects(t *testing.T) {
	source := runtimeEffectSource{table: "spells", id: "source-id", cardNumber: "SPELL-test", name: "Тест"}
	mechanics := map[string]any{
		"effects": []any{
			map[string]any{"who": "target", "result": []any{
				map[string]any{"kind": "modifier", "op": "disadvantage", "duration": map[string]any{"type": "rounds", "amount": float64(1)}},
				map[string]any{"kind": "condition", "value": "blinded", "duration": map[string]any{"type": "rounds", "amount": float64(1)}},
			}},
			map[string]any{"who": "self", "result": []any{
				map[string]any{"kind": "modifier", "op": "advantage", "duration": map[string]any{"type": "rounds", "amount": float64(1)}},
			}},
		},
	}
	rewritten, effects, changed := rewriteDurableTargetPayloads(mechanics, "mechanics", false, source)
	if !changed || len(effects) != 1 {
		t.Fatalf("changed=%v effects=%d, want true/1", changed, len(effects))
	}
	got := rewritten.(map[string]any)["effects"].([]any)[0].(map[string]any)["result"].([]any)[0]
	want := map[string]any{"kind": "grant_effect", "value": effects[0].cardNumber}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewritten payload=%#v, want %#v", got, want)
	}
	condition := rewritten.(map[string]any)["effects"].([]any)[0].(map[string]any)["result"].([]any)[1].(map[string]any)
	if condition["kind"] != "condition" {
		t.Fatalf("condition was rewritten: %#v", condition)
	}
	self := rewritten.(map[string]any)["effects"].([]any)[1].(map[string]any)["result"].([]any)[0].(map[string]any)
	if self["kind"] != "modifier" {
		t.Fatalf("self effect was rewritten: %#v", self)
	}
}

func TestRuntimeEffectIdentityIsDeterministic(t *testing.T) {
	source := runtimeEffectSource{table: "spells", id: "source-id", cardNumber: "SPELL-test", name: "Тест"}
	payload := map[string]any{"kind": "modifier", "duration": map[string]any{"type": "rounds"}}
	left := runtimeEffectFromPayload(source, "mechanics.effects[0]", payload)
	right := runtimeEffectFromPayload(source, "mechanics.effects[0]", payload)
	if left.id != right.id || left.cardNumber != right.cardNumber {
		t.Fatalf("identity is not deterministic: %#v vs %#v", left, right)
	}
}

func TestRewriteDurableTargetPayloadsAcceptsEmptyHistoricalMechanics(t *testing.T) {
	source := runtimeEffectSource{table: "actions", id: "legacy-id", cardNumber: "ACTION-0003", name: "Legacy"}
	rewritten, effects, changed := rewriteDurableTargetPayloads(map[string]any{}, "mechanics", false, source)
	if changed || len(effects) != 0 || len(rewritten.(map[string]any)) != 0 {
		t.Fatalf("empty historical mechanics changed: rewritten=%#v effects=%#v changed=%v", rewritten, effects, changed)
	}
}
