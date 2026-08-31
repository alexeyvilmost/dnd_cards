package migrations

import (
	"strings"
	"testing"
)

func TestMiniMVPLimitedActionUsesMigrationRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != miniMVPLimitedActionUsesMigrationVersion {
		t.Fatalf("last migration = %q, want %q", last.Version, miniMVPLimitedActionUsesMigrationVersion)
	}
	if last.Up == nil || last.Down == nil {
		t.Fatal("migration 125 must register Up and a safe Down")
	}
}

func TestMiniMVPLimitedActionUsesMigrationRepairsEveryLimitedAction(t *testing.T) {
	source := repairMiniMVPLimitedActionUsesSQL
	for _, cardNumber := range []string{
		"ACTION-0005",
		"ACT-feat-musician-song",
		"ACT-feat-crafter-fast-craft",
	} {
		if !strings.Contains(source, cardNumber) {
			t.Fatalf("migration contract is missing %s", cardNumber)
		}
	}
	if !strings.Contains(source, `"resource":"self_uses","amount":1`) {
		t.Fatal("migration contract is missing the explicit self_uses cost")
	}
}
