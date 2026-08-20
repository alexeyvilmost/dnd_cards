package migrations

import (
	"encoding/json"
	"testing"
)

func TestActiveActionTargetingMigrationIsRegisteredAfter104(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "105_repair_active_action_targeting" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("105 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("105_repair_active_action_targeting is not registered")
	}
	if previous := migrations[index-1].Version; previous != "104_seed_recommended_skill_choices" {
		t.Fatalf("migration before 105 = %q, want 104", previous)
	}
}

func TestActiveActionTargetingRepairCatalogIsCompleteAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, repair := range activeActionTargetingRepairs {
		key := repair.Table + ":" + repair.CardNumber
		if seen[key] {
			t.Fatalf("duplicate targeting repair %s", key)
		}
		seen[key] = true
		if repair.Targeting["domain"] != "actor" || repair.Targeting["actor_targets"] != true {
			t.Fatalf("%s is not an explicit actor target", key)
		}
		if repair.Targeting["min_targets"] != 1 || repair.Targeting["max_targets"] != 1 {
			t.Fatalf("%s is not exactly-one targeting", key)
		}
	}
	if len(seen) != 9 {
		t.Fatalf("targeting repairs = %d, want 9", len(seen))
	}
}

func TestActiveActionTargetingRepairExecutesIdempotently(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE actions (
			card_number TEXT PRIMARY KEY,
			mechanics JSONB NOT NULL,
			deleted_at TIMESTAMPTZ
		);
		CREATE TABLE cards (
			card_number TEXT PRIMARY KEY,
			mechanics JSONB NOT NULL,
			deleted_at TIMESTAMPTZ
		);
	`); err != nil {
		t.Fatal(err)
	}
	for _, repair := range activeActionTargetingRepairs {
		mechanics := `{"activation":{"mode":"active","cost":[{"resource":"action"}]},"effects":[{"resolution":"auto","result":[{"kind":"narrative"}] }]}`
		if repair.ExpectedLegacyTargeting != nil {
			encoded, err := json.Marshal(repair.ExpectedLegacyTargeting)
			if err != nil {
				t.Fatal(err)
			}
			mechanics = `{"activation":{"mode":"active","cost":[{"resource":"action"}]},"effects":[{"resolution":"auto","result":[{"kind":"narrative"}]}],"targeting":` + string(encoded) + `}`
		}
		if _, err := db.Exec(`INSERT INTO `+repair.Table+` (card_number, mechanics) VALUES ($1, $2::jsonb)`, repair.CardNumber, mechanics); err != nil {
			t.Fatal(err)
		}
	}
	if err := repairActiveActionTargeting(db); err != nil {
		t.Fatal(err)
	}
	if err := repairActiveActionTargeting(db); err != nil {
		t.Fatalf("105 is not idempotent: %v", err)
	}
	for _, repair := range activeActionTargetingRepairs {
		var domain, who string
		query := `SELECT mechanics #>> '{targeting,domain}', COALESCE(mechanics #>> '{effects,0,who}', '') FROM ` + repair.Table + ` WHERE card_number=$1`
		if err := db.QueryRow(query, repair.CardNumber).Scan(&domain, &who); err != nil {
			t.Fatal(err)
		}
		if domain != "actor" || (repair.EnsureWhoTarget && who != "target") {
			t.Fatalf("%s:%s domain=%q who=%q", repair.Table, repair.CardNumber, domain, who)
		}
	}
}
