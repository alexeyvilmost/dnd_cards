package migrations

import (
	"database/sql"
	"strings"
	"testing"
)

func TestRevokeInvalidFeatherFallCertificationMigrationIsRegisteredAfter101(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "102_revoke_invalid_feather_fall_certification" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("102 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("102_revoke_invalid_feather_fall_certification is not registered")
	}
	if previous := migrations[index-1].Version; previous != "101_pin_tactical_basic_action_targets" {
		t.Fatalf("migration before 102 = %q, want 101", previous)
	}
}

func staleFeatherFallSupport() string {
	return `{
		"status":"verified_mechanical",
		"certification_version":"micro-mvp-l1-rules-core-v4",
		"content_hash":"sha256:57849ad30bd2bf525296f7563bdc6e13f7be4a77706c18fe34f901a5127a7df5",
		"evidence_id":"9eb65494-a050-46dd-80d9-612cdfc73a96",
		"mechanics_locked":true,
		"test_coverage":{"scope":"micro-mvp-l1","required":282,"passed":282,"percent":100}
	}`
}

func prepareFeatherFallRevocationSchema(t *testing.T) *sql.DB {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE actions (id UUID PRIMARY KEY, support JSONB, updated_at TIMESTAMPTZ);
		CREATE TABLE effects (id UUID PRIMARY KEY, support JSONB, updated_at TIMESTAMPTZ);
		CREATE TABLE spells (
			id UUID PRIMARY KEY,
			card_number TEXT NOT NULL UNIQUE,
			mechanics JSONB,
			support JSONB,
			deleted_at TIMESTAMPTZ,
			updated_at TIMESTAMPTZ
		);
	`); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRevokeInvalidFeatherFallCertificationIsExactAuditedAndIdempotent(t *testing.T) {
	db := prepareFeatherFallRevocationSchema(t)
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics, support)
		VALUES ('00000000-0000-4000-8000-000000000253', $1, $2::jsonb, $3::jsonb)
	`, featherFallCardNumber, featherFallLegacyMechanics, staleFeatherFallSupport()); err != nil {
		t.Fatal(err)
	}
	if err := lockCertifiedContentMechanics(db); err != nil {
		t.Fatal(err)
	}
	if err := revokeInvalidFeatherFallCertification(db); err != nil {
		t.Fatal(err)
	}
	if err := revokeInvalidFeatherFallCertification(db); err != nil {
		t.Fatalf("102 is not idempotent: %v", err)
	}

	var status, version string
	var locked bool
	if err := db.QueryRow(`
		SELECT support->>'status', support->>'certification_version', (support->>'mechanics_locked')::boolean
		FROM spells WHERE card_number=$1
	`, featherFallCardNumber).Scan(&status, &version, &locked); err != nil {
		t.Fatal(err)
	}
	if status != "untested" || version != featherFallRevocationVersion || locked {
		t.Fatalf("revoked support = status %q version %q locked %v", status, version, locked)
	}
	var ledgerCount int
	var priorLocked bool
	if err := db.QueryRow(`
		SELECT count(*), bool_and((prior_support->>'mechanics_locked')::boolean)
		FROM content_certification_revocations
		WHERE card_number=$1 AND migration_version='102_revoke_invalid_feather_fall_certification'
	`, featherFallCardNumber).Scan(&ledgerCount, &priorLocked); err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 1 || !priorLocked {
		t.Fatalf("revocation ledger count=%d priorLocked=%v", ledgerCount, priorLocked)
	}
	if _, err := db.Exec(`UPDATE spells SET mechanics='{}'::jsonb WHERE card_number=$1`, featherFallCardNumber); err != nil {
		t.Fatalf("revoked row remained locked: %v", err)
	}
}

func TestRevokeInvalidFeatherFallCertificationRejectsMechanicsDrift(t *testing.T) {
	db := prepareFeatherFallRevocationSchema(t)
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics, support)
		VALUES ('00000000-0000-4000-8000-000000000253', $1, '{}'::jsonb, $2::jsonb)
	`, featherFallCardNumber, staleFeatherFallSupport()); err != nil {
		t.Fatal(err)
	}
	err := revokeInvalidFeatherFallCertification(db)
	if err == nil || !strings.Contains(err.Error(), "drifted") {
		t.Fatalf("expected drift rejection, got %v", err)
	}
}
