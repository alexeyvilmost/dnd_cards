package migrations

import (
	"encoding/json"
	"testing"
)

func TestWildCompanionVariantsUseCanonicalPrimitiveAndExactResource(t *testing.T) {
	for name, raw := range map[string]string{
		"wild shape": wildCompanionWildShapeMechanics,
		"spell slot": wildCompanionSpellSlotMechanics,
	} {
		var mechanics struct {
			Activation struct {
				Cost []struct {
					Resource string `json:"resource"`
					Level    int    `json:"level"`
				} `json:"cost"`
			} `json:"activation"`
			Targeting struct {
				MaxTargets int `json:"max_targets"`
			} `json:"targeting"`
			Primitive struct {
				Type   string         `json:"type"`
				Policy map[string]any `json:"policy"`
			} `json:"primitive"`
			Effects []any `json:"effects"`
		}
		if err := json.Unmarshal([]byte(raw), &mechanics); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if mechanics.Primitive.Type != "wild_companion" || mechanics.Targeting.MaxTargets != 0 {
			t.Fatalf("%s has invalid primitive/targeting: %#v", name, mechanics)
		}
		if len(mechanics.Primitive.Policy) != 3 || len(mechanics.Effects) != 0 {
			t.Fatalf("%s must use only its canonical primitive: %#v", name, mechanics)
		}
		if len(mechanics.Activation.Cost) != 2 || mechanics.Activation.Cost[0].Resource != "action" {
			t.Fatalf("%s activation=%#v", name, mechanics.Activation.Cost)
		}
	}
}
