package migrations

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestLevelFiveSpellAreaRuntimeDeclaration(t *testing.T) {
	if levelFiveSpellAreaRuntimeVersion != "191_repair_level_five_spell_area_runtime" {
		t.Fatalf("unexpected version %q", levelFiveSpellAreaRuntimeVersion)
	}
	raw, err := os.ReadFile("repair_level_five_spell_area_runtime_191.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, want := range []string{
		`{"resource":"action"}`,
		`{"resource":"spell_slot","level":2,"amount":1}`,
		`'{targeting,area,kind}','"cylinder"'`,
		`payload#>>'{geometry,shape}'='cylinder'`,
		`'status','untested'`,
	} {
		if !strings.Contains(source, want) {
			t.Errorf("migration misses %s", want)
		}
	}
}

func TestLevelFiveSpellAreaRuntimeAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("LEVEL5_SPELL_AREA_191_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("LEVEL5_SPELL_AREA_191_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairLevelFiveSpellAreaRuntime(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
}
