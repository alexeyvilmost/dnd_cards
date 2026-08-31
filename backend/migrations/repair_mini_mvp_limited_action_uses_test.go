package migrations

import (
	"strings"
	"testing"
)

func TestMiniMVPLimitedActionUsesMigrationRegistered(t *testing.T) {
	for _, migration := range GetAllMigrations() {
		if migration.Version != miniMVPLimitedActionUsesMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("migration 125 must register Up and a safe Down")
		}
		return
	}
	t.Fatalf("migration %q is not registered", miniMVPLimitedActionUsesMigrationVersion)
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
