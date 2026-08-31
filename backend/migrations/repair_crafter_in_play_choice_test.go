package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestCrafterInPlayChoiceMigrationRegisteredBeforeWeaponAndSpeciesRepairs(t *testing.T) {
	migrations := GetAllMigrations()
	registered := migrations[len(migrations)-4]
	if registered.Version != crafterInPlayChoiceMigrationVersion {
		t.Fatalf("registered migration = %q, want %q", registered.Version, crafterInPlayChoiceMigrationVersion)
	}
	if registered.Up == nil || registered.Down == nil {
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
