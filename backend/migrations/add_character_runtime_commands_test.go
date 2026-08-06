package migrations

import (
	"strings"
	"testing"
)

func TestCharacterRuntimeCommandsMigrationIsRegisteredAfter094(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "095_add_character_runtime_commands" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("095 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("095_add_character_runtime_commands is not registered")
	}
	if previous := migrations[index-1].Version; previous != "094_harden_canonical_transport" {
		t.Fatalf("migration before 095 = %q, want 094", previous)
	}
}

func TestCharacterRuntimeCommandsDDLIsAdditiveAndFailClosed(t *testing.T) {
	ddl := normalizeDDL(characterRuntimeCommandsDDL)
	for label, fragment := range map[string]string{
		"runtime revision": "add column if not exists runtime_revision bigint not null default 0",
		"ledger":           "create table if not exists character_runtime_commands",
		"caller command":   "primary key (user_id, command_id)",
		"request identity": "request_hash varchar(71) not null",
		"ruleset evidence": "ruleset_ref jsonb not null",
		"exact response":   "response jsonb not null",
		"append only":      "before update or delete on character_runtime_commands",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
	for _, forbidden := range []string{"drop table", "truncate table", "delete from"} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("runtime command migration contains destructive DDL %q", forbidden)
		}
	}
}

func TestCharacterRuntimeCommandsDDLExecutesIdempotently(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE characters_v3 (id UUID PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := addCharacterRuntimeCommands(db); err != nil {
		t.Fatal(err)
	}
	if err := addCharacterRuntimeCommands(db); err != nil {
		t.Fatalf("095 is not idempotent: %v", err)
	}
	var nullable string
	if err := db.QueryRow(`
		SELECT is_nullable FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'characters_v3' AND column_name = 'runtime_revision'
	`).Scan(&nullable); err != nil {
		t.Fatal(err)
	}
	if nullable != "NO" {
		t.Fatalf("runtime_revision nullable=%q, want NO", nullable)
	}
	const requestHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	var userID, commandID string
	if err := db.QueryRow(`
		INSERT INTO character_runtime_commands (
			user_id, command_id, request_hash, ruleset_ref, response
		) VALUES (
			gen_random_uuid(), gen_random_uuid(), $1, '{}'::jsonb, '{}'::jsonb
		) RETURNING user_id, command_id
	`, requestHash).Scan(&userID, &commandID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		UPDATE character_runtime_commands SET response = '{"replayed":true}'::jsonb
		WHERE user_id = $1::uuid AND command_id = $2::uuid
	`, userID, commandID); err == nil {
		t.Fatal("append-only runtime command receipt was mutable")
	}
}
