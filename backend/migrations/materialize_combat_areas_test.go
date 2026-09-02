package migrations

import "testing"

func TestCombatAreaEquipmentDeclarations(t *testing.T) {
	byCard := map[string]map[string]any{}
	for _, row := range utilityItems2024() {
		byCard[row.CardNumber] = row.Mechanics
	}
	for _, cardNumber := range []string{"CARD-0799", "CARD-0790", "CARD-0411", "CARD-0723"} {
		mechanics := byCard[cardNumber]
		targeting, ok := mechanics["targeting"].(map[string]any)
		if !ok || targeting["domain"] != "world" || targeting["shape"] != "area" || targeting["actor_targets"] != false {
			t.Fatalf("%s targeting=%#v", cardNumber, targeting)
		}
	}
}

func TestCombatAreaItemEffectsAreLibraryBacked(t *testing.T) {
	refs := map[string]bool{}
	for _, effect := range areaLibraryEffects() {
		if refs[effect.cardNumber] {
			t.Fatalf("duplicate effect %s", effect.cardNumber)
		}
		refs[effect.cardNumber] = true
	}
	for _, required := range []string{
		"EFFECT-item-perfume-check", "EFFECT-item-caltrops-speed", "EFFECT-item-hunting-trap-speed",
	} {
		if !refs[required] {
			t.Fatalf("missing %s", required)
		}
	}
}
