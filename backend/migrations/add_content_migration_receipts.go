package migrations

import (
	"database/sql"
	"fmt"
)

// contentMigrationReceiptsDDL is the server-issued proof that a catalog row
// was created by one exact guarded migration bundle. The receipt is retained
// after rollback, so the administrative hard-delete primitive cannot be used
// against an arbitrary pre-existing row even by a caller holding both secrets.
const contentMigrationReceiptsDDL = `
CREATE TABLE IF NOT EXISTS content_migration_create_receipts (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	bundle_id UUID NOT NULL,
	plan_hash VARCHAR(71) NOT NULL,
	operation_id VARCHAR(255) NOT NULL,
	entity_type VARCHAR(20) NOT NULL,
	entity_id UUID NOT NULL,
	card_number VARCHAR(255) NOT NULL,
	postimage_hash VARCHAR(71) NOT NULL,
	postimage JSONB NOT NULL,
	created_by_user_id UUID NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'active',
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	rolled_back_at TIMESTAMP WITH TIME ZONE,
	rolled_back_by_user_id UUID,
	CONSTRAINT ck_content_migration_receipts_plan_hash
		CHECK (plan_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_content_migration_receipts_postimage_hash
		CHECK (postimage_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_content_migration_receipts_entity_type
		CHECK (entity_type = 'effect'),
	CONSTRAINT ck_content_migration_receipts_card_number
		CHECK (btrim(card_number) <> ''),
	CONSTRAINT ck_content_migration_receipts_operation_id
		CHECK (btrim(operation_id) <> ''),
	CONSTRAINT ck_content_migration_receipts_postimage
		CHECK (jsonb_typeof(postimage) = 'object'),
	CONSTRAINT ck_content_migration_receipts_status
		CHECK (status IN ('active', 'rolled_back')),
	CONSTRAINT ck_content_migration_receipts_lifecycle
		CHECK (
			(status = 'active' AND rolled_back_at IS NULL AND rolled_back_by_user_id IS NULL)
			OR
			(status = 'rolled_back' AND rolled_back_at IS NOT NULL AND rolled_back_by_user_id IS NOT NULL)
		),
	CONSTRAINT uq_content_migration_receipts_bundle_entity
		UNIQUE (bundle_id, plan_hash, entity_type, card_number),
	CONSTRAINT uq_content_migration_receipts_bundle_operation
		UNIQUE (bundle_id, plan_hash, operation_id),
	CONSTRAINT uq_content_migration_receipts_entity
		UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_content_migration_receipts_bundle_status
	ON content_migration_create_receipts(bundle_id, plan_hash, status);
`

func addContentMigrationReceipts(db *sql.DB) error {
	if _, err := db.Exec(contentMigrationReceiptsDDL); err != nil {
		return fmt.Errorf("add content migration create receipts: %w", err)
	}
	return nil
}
