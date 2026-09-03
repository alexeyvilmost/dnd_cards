package migrations

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestOwnedSummonMigrationDeclaration(t *testing.T) {
	if ownedSummonsMigrationVersion != "195_materialize_owned_summon_lifecycle" {
		t.Fatal(ownedSummonsMigrationVersion)
	}
	patches := ownedSummonPatches()
	if len(patches) != 4 {
		t.Fatalf("patches=%d, want 4", len(patches))
	}
	seen := map[string]bool{}
	for _, patch := range patches {
		seen[patch.cardNumber] = true
		if patch.primitive["type"] != "owned_summon" || patch.primitive["replace_existing"] != true {
			t.Errorf("%s has an unsafe lifecycle policy: %#v", patch.cardNumber, patch.primitive)
		}
		if patch.primitive["initiative"] != "immediately_after_owner" {
			t.Errorf("%s lacks initiative ownership", patch.cardNumber)
		}
	}
	for _, card := range []string{"SPELL-0178", "SPELL-0240", "summon_fey", "summon_undead"} {
		if !seen[card] {
			t.Errorf("missing %s", card)
		}
	}
	raw, err := os.ReadFile("materialize_owned_summons_195.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		`'status','untested'`, "form-specific actions", "certifiedContentMechanicsOnlyLockDDL",
	} {
		if !strings.Contains(string(raw), required) {
			t.Errorf("migration misses %q", required)
		}
	}
}

func TestOwnedSummonMigrationAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("OWNED_SUMMONS_195_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("OWNED_SUMMONS_195_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeOwnedSummons(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
}
