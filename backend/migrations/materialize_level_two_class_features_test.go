package migrations

import (
	"encoding/json"
	"testing"
)

func TestLevelTwoActionDeclarationsAreJSONAndUnique(t *testing.T) {
	seen := map[string]bool{}
	if len(levelTwoActions) != 19 {
		t.Fatalf("level-two action count=%d, want 19", len(levelTwoActions))
	}
	for _, action := range levelTwoActions {
		if seen[action.card] {
			t.Fatalf("duplicate action %s", action.card)
		}
		seen[action.card] = true
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(action.mechanics), &mechanics); err != nil {
			t.Fatalf("%s: %v", action.card, err)
		}
		if mechanics["activation"] == nil || mechanics["effects"] == nil || mechanics["targeting"] == nil {
			t.Fatalf("%s is missing an executable contract", action.card)
		}
	}
}

func TestLevelTwoMigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != levelTwoClassFeaturesMigrationVersion || last.Up == nil || last.Down == nil {
		t.Fatalf("last migration=%s", last.Version)
	}
}
