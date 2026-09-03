package migrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSpeciesTransformationRuntimeDeclarations(t *testing.T) {
	if speciesTransformationRuntimeVersion != "189_repair_species_transformation_runtime" {
		t.Fatalf("unexpected version %q", speciesTransformationRuntimeVersion)
	}
	if len(aasimarTransformationRuntimeRepairs) != 3 {
		t.Fatalf("Aasimar transformation repairs=%d, want 3", len(aasimarTransformationRuntimeRepairs))
	}
	for _, repair := range aasimarTransformationRuntimeRepairs {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(repair.mechanics), &mechanics); err != nil {
			t.Fatalf("%s: %v", repair.card, err)
		}
		for _, want := range []string{
			`"kind":"damage_rider"`,
			`"trigger":"damage_by_attack_or_spell"`,
			`"once_per_turn":"aasimar:celestial-revelation:damage"`,
		} {
			if !strings.Contains(repair.mechanics, want) {
				t.Errorf("%s lacks %s", repair.card, want)
			}
		}
		if strings.TrimSpace(repair.note) == "" {
			t.Errorf("%s must disclose remaining runtime boundaries", repair.card)
		}
	}
}
