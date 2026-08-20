package migrations

import (
	"strings"
	"testing"
)

func TestRevokeInvalidMageHandCertificationMigrationIsRegisteredAfter102(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "103_revoke_invalid_mage_hand_certification" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("103 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("103_revoke_invalid_mage_hand_certification is not registered")
	}
	if previous := migrations[index-1].Version; previous != "102_revoke_invalid_feather_fall_certification" {
		t.Fatalf("migration before 103 = %q, want 102", previous)
	}
}

func staleMageHandSupport() string {
	return `{
		"status":"verified_mechanical",
		"certification_version":"micro-mvp-l1-rules-core-v4",
		"content_hash":"sha256:87e73b651e3e881551a26fdfe91cfc6cc1ad116fddea2ec31c899a63cf7b81db",
		"evidence_id":"9eb65494-a050-46dd-80d9-612cdfc73a96",
		"mechanics_locked":true,
		"test_coverage":{"scope":"micro-mvp-l1","required":282,"passed":282,"percent":100}
	}`
}

func TestRevokeInvalidMageHandCertificationIsExactAuditedAndIdempotent(t *testing.T) {
	db := prepareFeatherFallRevocationSchema(t)
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics, support)
		VALUES ('00000000-0000-4000-8000-000000000173', $1, $2::jsonb, $3::jsonb)
	`, mageHandCardNumber, mageHandLegacyMechanics, staleMageHandSupport()); err != nil {
		t.Fatal(err)
	}
	if err := lockCertifiedContentMechanics(db); err != nil {
		t.Fatal(err)
	}
	if err := revokeInvalidMageHandCertification(db); err != nil {
		t.Fatal(err)
	}
	if err := revokeInvalidMageHandCertification(db); err != nil {
		t.Fatalf("103 is not idempotent: %v", err)
	}

	var status, version string
	var locked bool
	if err := db.QueryRow(`
		SELECT support->>'status', support->>'certification_version', (support->>'mechanics_locked')::boolean
		FROM spells WHERE card_number=$1
	`, mageHandCardNumber).Scan(&status, &version, &locked); err != nil {
		t.Fatal(err)
	}
	if status != "untested" || version != mageHandRevocationVersion || locked {
		t.Fatalf("revoked support = status %q version %q locked %v", status, version, locked)
	}
	var ledgerCount int
	var priorLocked bool
	if err := db.QueryRow(`
		SELECT count(*), bool_and((prior_support->>'mechanics_locked')::boolean)
		FROM content_certification_revocations
		WHERE card_number=$1 AND migration_version='103_revoke_invalid_mage_hand_certification'
	`, mageHandCardNumber).Scan(&ledgerCount, &priorLocked); err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 1 || !priorLocked {
		t.Fatalf("revocation ledger count=%d priorLocked=%v", ledgerCount, priorLocked)
	}
	if _, err := db.Exec(`UPDATE spells SET mechanics='{}'::jsonb WHERE card_number=$1`, mageHandCardNumber); err != nil {
		t.Fatalf("revoked row remained locked: %v", err)
	}
}

func TestRevokeInvalidMageHandCertificationRejectsMechanicsDrift(t *testing.T) {
	db := prepareFeatherFallRevocationSchema(t)
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics, support)
		VALUES ('00000000-0000-4000-8000-000000000173', $1, '{}'::jsonb, $2::jsonb)
	`, mageHandCardNumber, staleMageHandSupport()); err != nil {
		t.Fatal(err)
	}
	err := revokeInvalidMageHandCertification(db)
	if err == nil || !strings.Contains(err.Error(), "drifted") {
		t.Fatalf("expected drift rejection, got %v", err)
	}
}
