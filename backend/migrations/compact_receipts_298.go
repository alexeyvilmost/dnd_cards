package migrations

import (
	"database/sql"
	"fmt"
)

const compactReceipts298Version = "298_compact_command_receipts"

// No historical receipt UPDATE, trigger removal, TTL or destructive rollback.
func addCompactReceipts298(db *sql.DB) error {
	return addCompactReceipts298On(db)
}

func addCompactReceipts298On(db additiveExecer) error {
	for _, table := range []string{"roguelike_command_receipts", "character_runtime_commands"} {
		if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s
			ADD COLUMN IF NOT EXISTS response_version integer NOT NULL DEFAULT 1,
			ADD COLUMN IF NOT EXISTS response_payload bytea,
			ADD COLUMN IF NOT EXISTS response_sha256 varchar(64) NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS response_length integer NOT NULL DEFAULT 0;
			DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='%s_storage_version' AND conrelid='%s'::regclass) THEN
			ALTER TABLE %s ADD CONSTRAINT %s_storage_version CHECK (
			(response_version=1 AND response_payload IS NULL AND response_sha256='' AND response_length=0)
			OR (response_version=2 AND response='{}'::jsonb AND response_payload IS NOT NULL AND octet_length(response_payload) BETWEEN 1 AND 67108864
			AND response_sha256 ~ '^[a-f0-9]{64}$' AND response_length BETWEEN 1 AND 67108864));
			END IF; END $$;`, table, table, table, table, table)); err != nil {
			return fmt.Errorf("add receipt storage to %s: %w", table, err)
		}
	}
	return nil
}
