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
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT UNIQUE NOT NULL,
			mechanics JSONB NOT NULL,
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMPTZ
		);
		CREATE TABLE cards (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT UNIQUE NOT NULL,
			mechanics JSONB NOT NULL,
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
			deleted_at TIMESTAMPTZ
		);
		CREATE TABLE effects (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE spells (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
		var support any
		if repair.CardNumber == "ACT-bardic-inspiration" {
			support = `{"status":"verified_mechanical","certification_version":"micro-mvp-l1-rules-core-v4","mechanics_locked":true,"content_hash":"sha256:old"}`
		} else if repair.CardNumber == "action_help" {
			support = `{"status":"verified_partial","certification_version":"micro-mvp-basic-actions-v2","mechanics_locked":false}`
		}
		if _, err := db.Exec(`INSERT INTO `+repair.Table+` (card_number, mechanics, support) VALUES ($1, $2::jsonb, $3::jsonb)`, repair.CardNumber, mechanics, support); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(certifiedContentMechanicsLockDDL); err != nil {
		t.Fatal(err)
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
	for _, cardNumber := range []string{"ACT-bardic-inspiration", "action_help"} {
		var status string
		var mechanicsLocked bool
		if err := db.QueryRow(`
			SELECT support->>'status', (support->>'mechanics_locked')::boolean
			FROM actions WHERE card_number=$1
		`, cardNumber).Scan(&status, &mechanicsLocked); err != nil {
			t.Fatal(err)
		}
		if status != "untested" || mechanicsLocked {
			t.Fatalf("%s retained stale certification: status=%q locked=%v", cardNumber, status, mechanicsLocked)
		}
	}
	var revocations int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM content_certification_revocations
		WHERE migration_version='105_repair_active_action_targeting'
	`).Scan(&revocations); err != nil {
		t.Fatal(err)
	}
	if revocations != 2 {
		t.Fatalf("targeting certification revocations = %d, want 2", revocations)
	}
	var priorStatus string
	if err := db.QueryRow(`
		SELECT prior_support->>'status'
		FROM content_certification_revocations
		WHERE migration_version='105_repair_active_action_targeting'
		  AND card_number='ACT-bardic-inspiration'
	`).Scan(&priorStatus); err != nil {
		t.Fatal(err)
	}
	if priorStatus != "verified_mechanical" {
		t.Fatalf("bardic inspiration revocation lost its preimage: %q", priorStatus)
	}
	var nullSupport bool
	if err := db.QueryRow(`
		SELECT support IS NULL FROM actions WHERE card_number='ACT-goliath-fire'
	`).Scan(&nullSupport); err != nil {
		t.Fatal(err)
	}
	if !nullSupport {
		t.Fatal("targeting repair invented certification support for an unreviewed action")
	}
	if _, err := db.Exec(`
		UPDATE actions
		SET support='{"status":"verified_mechanical","mechanics_locked":true}'::jsonb
		WHERE card_number='ACT-bardic-inspiration'
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		UPDATE actions SET mechanics='{}'::jsonb
		WHERE card_number='ACT-bardic-inspiration'
	`); err == nil {
		t.Fatal("restored certification guard accepted a mechanics update")
	}
}
