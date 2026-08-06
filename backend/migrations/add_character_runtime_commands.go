package migrations

import (
	"database/sql"
	"fmt"
)

// characterRuntimeCommandsDDL adds an optimistic revision to CharacterV3 and
// an append-only idempotency ledger for atomic multi-character runtime
// persistence. The ledger stores the exact committed response so a retry does
// not re-run events or depend on participant revisions that have since moved.
const characterRuntimeCommandsDDL = `
ALTER TABLE characters_v3
	ADD COLUMN IF NOT EXISTS runtime_revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS character_runtime_commands (
	user_id UUID NOT NULL,
	command_id UUID NOT NULL,
	request_hash VARCHAR(71) NOT NULL,
	ruleset_ref JSONB NOT NULL,
	response JSONB NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, command_id),
	CONSTRAINT ck_character_runtime_commands_request_hash
		CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_character_runtime_commands_ruleset_ref
		CHECK (jsonb_typeof(ruleset_ref) = 'object'),
	CONSTRAINT ck_character_runtime_commands_response
		CHECK (jsonb_typeof(response) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_character_runtime_commands_created_at
	ON character_runtime_commands(created_at);

CREATE OR REPLACE FUNCTION reject_character_runtime_command_mutation()
RETURNS TRIGGER AS $$
BEGIN
	RAISE EXCEPTION 'character runtime command receipts are append-only'
		USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS character_runtime_commands_append_only
	ON character_runtime_commands;
CREATE TRIGGER character_runtime_commands_append_only
	BEFORE UPDATE OR DELETE ON character_runtime_commands
	FOR EACH ROW EXECUTE FUNCTION reject_character_runtime_command_mutation();
`

func addCharacterRuntimeCommands(db *sql.DB) error {
	if _, err := db.Exec(characterRuntimeCommandsDDL); err != nil {
		return fmt.Errorf("add character runtime commands: %w", err)
	}
	return nil
}
