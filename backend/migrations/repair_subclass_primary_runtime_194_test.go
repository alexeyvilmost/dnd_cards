package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestSubclassPrimaryRuntimeDeclarations(t *testing.T) {
	if subclassPrimaryRuntimeVersion != "194_repair_subclass_primary_runtime" {
		t.Fatal(subclassPrimaryRuntimeVersion)
	}
	for name, raw := range map[string]string{
		"berserker frenzy": berserkerFrenzyMechanics,
		"tides of chaos":   tidesOfChaosActionMechanics,
	} {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(raw), &mechanics); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	for _, required := range []string{
		`"once_per_turn":"berserker:frenzy"`,
		`"kind":"you_have_effect_stack"`,
		`"kind":"attack_advantage_state"`,
	} {
		if !strings.Contains(berserkerFrenzyMechanics, required) {
			t.Errorf("Frenzy misses %s", required)
		}
	}
	for _, required := range []string{
		`"resource":"self_uses"`, `"op":"advantage"`, `"consume":"next"`,
	} {
		if !strings.Contains(tidesOfChaosActionMechanics, required) {
			t.Errorf("Tides of Chaos misses %s", required)
		}
	}
}

func TestSubclassPrimaryRuntimeAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("SUBCLASS_PRIMARY_194_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SUBCLASS_PRIMARY_194_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairSubclassPrimaryRuntime(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
}
