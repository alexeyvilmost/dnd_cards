package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestLevelTwoRuntimeReapplyPinsFreshWildShapeContract(t *testing.T) {
	raw, err := os.ReadFile("reapply_level_two_runtime_contracts.go")
	if err != nil {
		t.Fatal(err)
	}
	reapplySource := string(raw)
	if !strings.Contains(reapplySource, `163_reapply_level_two_runtime_contracts`) ||
		!strings.Contains(reapplySource, `return repairLevelTwoRuntimeContracts(db)`) {
		t.Fatal("fresh migration identity must rerun the complete idempotent level-two repair")
	}
	raw, err = os.ReadFile("repair_level_two_runtime_contracts.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`"context":"in_play","resolution":"on_use"`,
		`"id":"rat"`, `"id":"riding_horse"`, `"id":"spider"`, `"id":"wolf"`,
		`"kind":"grant_effect","value":"EFFECT-wild-shape-wolf"`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("level-2 reapply is missing %q", required)
		}
	}
	if strings.Contains(source, `"id":"panther"`) || strings.Contains(source, `"id":"draft_horse"`) {
		t.Fatal("Wild Shape reapply retained the stale legacy form list")
	}
}
