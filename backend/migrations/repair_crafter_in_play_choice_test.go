package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestCrafterInPlayChoiceMigrationRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != crafterInPlayChoiceMigrationVersion {
		t.Fatalf("last migration = %q, want %q", last.Version, crafterInPlayChoiceMigrationVersion)
	}
	if last.Up == nil || last.Down == nil {
		t.Fatal("migration 126 must register Up and a safe Down")
	}
}

func TestCrafterInPlayChoiceMigrationRepairsAndInvalidatesOnlyCrafterAction(t *testing.T) {
	source, err := os.ReadFile("repair_crafter_in_play_choice.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, required := range []string{
		"ACT-feat-crafter-fast-craft",
		"'{effects,0,result,0,context}'",
		"'\"in_play\"'::jsonb",
		"support = NULL",
		"certifiedContentMechanicsOnlyLockDDL",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("migration is missing %q", required)
		}
	}
}
