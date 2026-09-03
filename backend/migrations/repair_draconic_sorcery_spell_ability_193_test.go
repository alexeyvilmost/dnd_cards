package migrations

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestDraconicSorcerySpellAbilityRepairDeclaration(t *testing.T) {
	if draconicSorcerySpellAbilityVersion != "193_repair_draconic_sorcery_spell_ability" {
		t.Fatal(draconicSorcerySpellAbilityVersion)
	}
	raw, err := os.ReadFile("repair_draconic_sorcery_spell_ability_193.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`item || '{"ability":"cha"}'::jsonb`,
		`card_number=$1`,
		`grants != 6`,
		`certifiedContentMechanicsOnlyLockDDL`,
		`'status','untested'`,
	} {
		if !strings.Contains(source, required) {
			t.Errorf("migration misses %s", required)
		}
	}
}

func TestDraconicSorcerySpellAbilityRepairAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("DRACONIC_SORCERY_193_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRACONIC_SORCERY_193_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairDraconicSorcerySpellAbility(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
}
