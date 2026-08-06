package migrations

import (
	"strings"
	"testing"
)

func TestContentMigrationReceiptsIsRegisteredAfterWorldRuntime(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for i, migration := range migrations {
		if migration.Version == "093_add_content_migration_receipts" {
			index = i
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("content migration receipt must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("093_add_content_migration_receipts is not registered")
	}
	if previous := migrations[index-1].Version; previous != "092_add_world_runtime_v5" {
		t.Fatalf("migration before receipts = %q, want 092", previous)
	}
}

func TestContentMigrationReceiptsDDLIsAdditiveAndFailClosed(t *testing.T) {
	ddl := normalizeDDL(contentMigrationReceiptsDDL)
	for label, fragment := range map[string]string{
		"ledger table":       "content_migration_create_receipts",
		"bundle identity":    "bundle_id uuid not null",
		"plan identity":      "plan_hash varchar(71) not null",
		"operation identity": "operation_id varchar(255) not null",
		"effect-only scope":  "check (entity_type = 'effect')",
		"postimage evidence": "postimage_hash varchar(71) not null",
		"exact postimage":    "postimage jsonb not null",
		"receipt lifecycle":  "status in ('active', 'rolled_back')",
		"one entity receipt": "unique (entity_type, entity_id)",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
	for _, forbidden := range []string{"drop table", "truncate table", "delete from"} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("receipt migration contains destructive DDL %q", forbidden)
		}
	}
}

func TestContentMigrationReceiptsDDLExecutesAndEnforcesLedgerOnIsolatedPostgres(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	var err error
	if err = addContentMigrationReceipts(db); err != nil {
		t.Fatal(err)
	}
	if err = addContentMigrationReceipts(db); err != nil {
		t.Fatalf("receipt migration is not idempotent: %v", err)
	}

	const planHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const postimageHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	var receiptID string
	err = db.QueryRow(`
		INSERT INTO content_migration_create_receipts (
			bundle_id, plan_hash, operation_id, entity_type, entity_id, card_number,
			postimage_hash, postimage, created_by_user_id
		) VALUES (
			gen_random_uuid(), $1, 'effects:EFF-ledger-integration:create', 'effect', gen_random_uuid(),
			'EFF-ledger-integration', $2, '{"id":"effect:test"}'::jsonb,
			gen_random_uuid()
		) RETURNING id
	`, planHash, postimageHash).Scan(&receiptID)
	if err != nil {
		t.Fatalf("insert valid receipt: %v", err)
	}

	if _, err = db.Exec(`
		INSERT INTO content_migration_create_receipts (
			bundle_id, plan_hash, operation_id, entity_type, entity_id, card_number,
			postimage_hash, postimage, created_by_user_id
		) VALUES (
			gen_random_uuid(), 'not-a-hash', 'effects:EFF-ledger-invalid:create', 'effect', gen_random_uuid(),
			'EFF-ledger-invalid', $1, '{}'::jsonb, gen_random_uuid()
		)
	`, postimageHash); err == nil {
		t.Fatal("invalid plan hash unexpectedly entered receipt ledger")
	}

	if _, err = db.Exec(`
		UPDATE content_migration_create_receipts
		SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP,
			rolled_back_by_user_id = gen_random_uuid()
		WHERE id = $1
	`, receiptID); err != nil {
		t.Fatalf("mark receipt rolled back: %v", err)
	}
	var status string
	var rolledBack bool
	if err = db.QueryRow(`
		SELECT status, rolled_back_at IS NOT NULL
		FROM content_migration_create_receipts WHERE id = $1
	`, receiptID).Scan(&status, &rolledBack); err != nil {
		t.Fatal(err)
	}
	if status != "rolled_back" || !rolledBack {
		t.Fatalf("unexpected receipt lifecycle: %s rolled_back=%v", status, rolledBack)
	}
}
