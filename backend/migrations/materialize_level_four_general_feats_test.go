package migrations

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestLevelFourGeneralFeatDenominatorAndVersion(t *testing.T) {
	if levelFourGeneralFeatsMigrationVersion != "170_materialize_level_four_general_feats" {
		t.Fatalf("unexpected migration version %q", levelFourGeneralFeatsMigrationVersion)
	}
	if levelFourGeneralHalfFeatCount != 42 {
		t.Fatalf("general half-feat denominator = %d, want 42 plus ASI", levelFourGeneralHalfFeatCount)
	}
	allowedActionTypes := map[string]bool{"base_action": true, "class_feature": true, "item_property": true, "species_ability": true}
	if !allowedActionTypes[slowFallActionType] {
		t.Fatalf("Slow Fall action_type %q violates actions_action_type_check", slowFallActionType)
	}
}

func TestLevelFourGeneralFeatsMigrationAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("LEVEL4_GENERAL_FEATS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LEVEL4_GENERAL_FEATS_TEST_DATABASE_URL for integration coverage")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeLevelFourGeneralFeats(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var actionType, resource string
	if err = db.QueryRow(`SELECT action_type,resource FROM actions WHERE card_number='ACT-monk-slow-fall' AND deleted_at IS NULL`).Scan(&actionType, &resource); err != nil {
		t.Fatal(err)
	}
	if actionType != slowFallActionType || resource != "reaction" {
		t.Fatalf("Slow Fall shape action_type=%q resource=%q", actionType, resource)
	}
}
