package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestLevelTwoRuntimeRepairPinsExactContracts(t *testing.T) {
	raw, err := os.ReadFile("repair_level_two_runtime_contracts.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`'ACT-font-convert-slot-1'`,
		`"cost":[{"resource":"spell_slot_1"}]`,
		`"id":"action_surge_action"`,
		`"context":"in_play","resolution":"on_use"`,
		`"id":"rat"`, `"id":"riding_horse"`, `"id":"spider"`, `"id":"wolf"`,
		`"kind":"grant_effect","value":"EFFECT-wild-shape-wolf"`,
		`"requires_active_effect":"EFFECT-wild-shape-wolf"`,
		`"attack_bonus_override":4`,
		`"kind":"modifier","op":"deny","applies_to":{"roll":"spellcasting"}`,
		`"stack_id":"wild_shape_form"`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("level-2 repair is missing %q", required)
		}
	}
	if strings.Contains(source, `"id":"panther"`) || strings.Contains(source, `"id":"draft_horse"`) {
		t.Fatal("Wild Shape repair retained the non-recommended legacy form list")
	}
}
