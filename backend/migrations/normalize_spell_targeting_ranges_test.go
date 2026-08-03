package migrations

import (
	"strings"
	"testing"
)

func TestSpellTargetingRepairsAreCompleteAndUnique(t *testing.T) {
	expected := map[string]string{
		"SPELL-0230": "Касание",
		"SPELL-0163": "30 футов",
		"SPELL-0311": "60 футов",
	}
	if len(spellTargetingRepairs) != len(expected) {
		t.Fatalf("expected %d spell repairs, got %d", len(expected), len(spellTargetingRepairs))
	}
	for _, repair := range spellTargetingRepairs {
		want, ok := expected[repair.CardNumber]
		if !ok {
			t.Fatalf("unexpected spell repair %s", repair.CardNumber)
		}
		if repair.Range != want {
			t.Fatalf("%s range = %q, want %q", repair.CardNumber, repair.Range, want)
		}
		delete(expected, repair.CardNumber)
	}
	if len(expected) != 0 {
		t.Fatalf("missing spell repairs: %v", expected)
	}
}

func TestSpellTargetingCertificationRepairsAreValidAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, certification := range spellTargetingCertificationRepairs {
		key := certification.Table + ":" + certification.CardNumber
		if seen[key] {
			t.Fatalf("duplicate certification repair %s", key)
		}
		seen[key] = true
		for field, hash := range map[string]string{
			"content":    certification.ContentHash,
			"dependency": certification.DependencyHash,
		} {
			if !strings.HasPrefix(hash, "sha256:") || len(hash) != len("sha256:")+64 {
				t.Fatalf("%s has invalid %s hash %q", key, field, hash)
			}
		}
	}
	for _, spell := range spellTargetingRepairs {
		if !seen["spells:"+spell.CardNumber] {
			t.Errorf("missing certification repair for %s", spell.CardNumber)
		}
	}
}
