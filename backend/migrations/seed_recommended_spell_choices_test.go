package migrations

import "testing"

func TestRecommendedSpellChoicesMatchDeclaredCounts(t *testing.T) {
	if len(recommendedSpellChoices) < 10 {
		t.Fatalf("recommended spell seeds = %d, want at least paladin+other casters", len(recommendedSpellChoices))
	}
	seen := map[string]bool{}
	for _, seed := range recommendedSpellChoices {
		key := seed.EntityReference + ":" + seed.ChoiceID
		if seen[key] {
			t.Fatalf("duplicate seed %s", key)
		}
		seen[key] = true
		if seed.EntityType != "effect" {
			t.Fatalf("%s: entity type %q", key, seed.EntityType)
		}
		if _, err := normalizedRecommendedOptions(seed.Options); err != nil {
			t.Fatalf("%s: %v", key, err)
		}
	}
	if !seen["EFF-paladin-spellcasting:paladin_spells_l1"] {
		t.Fatal("missing paladin spell recommendations")
	}
}
