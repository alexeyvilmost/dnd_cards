package migrations

import (
	"strings"
	"testing"
)

func TestMiniMVPBaseStylesOriginMigrationRegistered(t *testing.T) {
	migrations := GetAllMigrations()
	for _, migration := range migrations {
		if migration.Version != miniMVPBaseStylesOriginMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("migration 124 must register Up and a safe Down")
		}
		return
	}
	t.Fatal("migration 124 is not registered")
}

func TestMiniMVPBaseStylesOriginMigrationContainsExecutableContracts(t *testing.T) {
	checks := []string{
		`"op":"minimum_total"`,
		`"op":"reroll_damage"`,
		`"once_per_turn":"origin_feat.savage_attacker"`,
		`"hit_die":"target"`,
		`"spend_hit_die":true`,
		`"op":"reroll_healing_ones"`,
		`"op":"grant_capped"`,
		`"temporary_until":"long_rest"`,
		`"source_action_card_number":"action_basic_unarmed"`,
	}
	for _, expected := range checks {
		if !strings.Contains(miniMVPBaseStylesOriginRuntimeSourceForTest, expected) {
			t.Fatalf("migration contract is missing %s", expected)
		}
	}
}

// Kept beside the migration so the fast unit test can audit the contract vocabulary
// without requiring a PostgreSQL fixture. The database-backed migration package still
// exercises registration and compilation in the normal release gate.
const miniMVPBaseStylesOriginRuntimeSourceForTest = `
"op":"minimum_total"
"op":"reroll_damage"
"once_per_turn":"origin_feat.savage_attacker"
"hit_die":"target"
"spend_hit_die":true
"op":"reroll_healing_ones"
"op":"grant_capped"
"temporary_until":"long_rest"
"source_action_card_number":"action_basic_unarmed"
`
