package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestLevelTwoClassCertificationScopeAndTurnUndeadContract(t *testing.T) {
	if len(levelTwoCertifiedClassCards) != 12 {
		t.Fatalf("certified base classes = %d, want 12", len(levelTwoCertifiedClassCards))
	}
	seen := map[string]bool{}
	for _, card := range levelTwoCertifiedClassCards {
		if seen[card] || card == "CLASS-pugilist" {
			t.Fatalf("invalid certified class scope: %q", card)
		}
		seen[card] = true
	}
	for _, card := range []string{"CLASS-druid", "CLASS-warrior", "CLASS-monk", "CLASS-sorcerer"} {
		if len(levelTwoClassLimitations[card]) == 0 {
			t.Fatalf("partial class %s has no explicit limitation", card)
		}
	}
	if hash := levelTwoCertificationHash("stable"); !strings.HasPrefix(hash, "sha256:") || len(hash) != 71 {
		t.Fatalf("invalid certification hash %q", hash)
	}
	raw, err := os.ReadFile("certify_level_two_classes.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`164_certify_level_two_classes`,
		`"kind":"emanation","radius_ft":30`,
		`status := "verified_mechanical"`,
		`status = "verified_partial"`,
		`"scope":          "mini-mvp-level2"`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("level-2 certification migration is missing %q", required)
		}
	}
}
