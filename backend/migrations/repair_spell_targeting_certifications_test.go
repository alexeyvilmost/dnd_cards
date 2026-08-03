package migrations

import (
	"strings"
	"testing"
)

func TestRepairedSpellTargetingCertificationsAreValidAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, certification := range repairedSpellTargetingCertifications {
		key := certification.Table + ":" + certification.CardNumber
		if seen[key] {
			t.Fatalf("duplicate repaired certification %s", key)
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
		key := "spells:" + spell.CardNumber
		if !seen[key] {
			t.Errorf("missing repaired certification for %s", key)
		}
		if len(repairedSpellTargetingLimitations[spell.CardNumber]) == 0 {
			t.Errorf("missing limitations for %s", key)
		}
	}
}
