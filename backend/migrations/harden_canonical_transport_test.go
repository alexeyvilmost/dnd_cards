package migrations

import (
	"strings"
	"testing"
)

func TestCanonicalTransportHardeningMigrationIsRegisteredAfter093(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "094_harden_canonical_transport" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("094 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("094_harden_canonical_transport is not registered")
	}
	if previous := migrations[index-1].Version; previous != "093_add_content_migration_receipts" {
		t.Fatalf("migration before 094 = %q, want 093", previous)
	}
}

func TestCanonicalTransportHardeningDDLContainsIdentityAndBindingGuards(t *testing.T) {
	ddl := normalizeDDL(hardenCanonicalTransportDDL)
	for label, fragment := range map[string]string{
		"semantic id column":         "add column if not exists semantic_command_id varchar(128)",
		"semantic id backfill":       "set semantic_command_id = command_id::text",
		"semantic uniqueness":        "unique (session_id, semantic_command_id)",
		"string decision request":    "alter column request_id type varchar(128) using request_id::text",
		"string decision resolution": "alter column resolution_id type varchar(128) using resolution_id::text",
		"resolution uniqueness":      "unique (session_id, resolution_id)",
		"exact decision schema":      "check (request_schema_version = 1) not valid",
		"elevated role guard":        "check (not can_control_unowned_actors or role in ('owner', 'gm')) not valid",
		"release serializer tuple":   "unique (id, rules_artifact_hash, serializer_version)",
		"session serializer tuple":   "unique (id, ruleset_release_id, rules_artifact_hash, serializer_version)",
		"snapshot event FK":          "foreign key (session_id, last_event_hash) references game_events(session_id, event_hash)",
		"last event uniqueness":      "on session_snapshots(session_id, last_event_hash) where last_event_hash is not null",
		"immutable semantic input":   "new.session_id, new.command_id, new.semantic_command_id",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
}

func TestCanonicalTransportHardeningUpgradesRecorded090Shape(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE ruleset_releases (
			id UUID PRIMARY KEY, rules_artifact_hash VARCHAR(71) NOT NULL,
			serializer_version VARCHAR(100) NOT NULL,
			UNIQUE (id, rules_artifact_hash)
		);
		CREATE TABLE game_sessions (
			id UUID PRIMARY KEY, ruleset_release_id UUID NOT NULL,
			rules_artifact_hash VARCHAR(71) NOT NULL, serializer_version VARCHAR(100) NOT NULL,
			UNIQUE (id, ruleset_release_id, rules_artifact_hash)
		);
		CREATE TABLE game_session_members (
			session_id UUID NOT NULL, user_id UUID NOT NULL, role VARCHAR(20) NOT NULL,
			status VARCHAR(20) NOT NULL, can_control_unowned_actors BOOLEAN NOT NULL
		);
		CREATE TABLE game_commands (
			id UUID PRIMARY KEY, session_id UUID NOT NULL, command_id UUID NOT NULL,
			ruleset_release_id UUID NOT NULL, rules_artifact_hash VARCHAR(71) NOT NULL,
			source_actor_id UUID, controller_user_id UUID, spatial_fact_set_id UUID,
			command_type VARCHAR(100), expected_revision BIGINT, base_snapshot_seq BIGINT,
			base_state_hash VARCHAR(71), command_schema_version INTEGER,
			serializer_version VARCHAR(100), canonical_body JSONB, canonical_bytes BYTEA,
			request_hash VARCHAR(71), execution_input JSONB,
			execution_input_canonical_bytes BYTEA, execution_input_hash VARCHAR(71),
			result_body JSONB, result_canonical_bytes BYTEA, result_hash VARCHAR(71),
			committed_fencing_token BIGINT, admitted_at TIMESTAMPTZ,
			UNIQUE (session_id, command_id)
		);
		CREATE TABLE game_events (
			session_id UUID NOT NULL, ruleset_release_id UUID NOT NULL,
			rules_artifact_hash VARCHAR(71) NOT NULL, serializer_version VARCHAR(100) NOT NULL,
			event_hash VARCHAR(71) NOT NULL, UNIQUE (session_id, event_hash)
		);
		CREATE TABLE session_snapshots (
			session_id UUID NOT NULL, ruleset_release_id UUID NOT NULL,
			rules_artifact_hash VARCHAR(71) NOT NULL, serializer_version VARCHAR(100) NOT NULL,
			last_event_hash VARCHAR(71)
		);
		CREATE TABLE decision_requests (
			session_id UUID NOT NULL, request_id UUID NOT NULL, resolution_id UUID NOT NULL,
			ruleset_release_id UUID NOT NULL, rules_artifact_hash VARCHAR(71) NOT NULL,
			serializer_version VARCHAR(100) NOT NULL, request_schema_version INTEGER NOT NULL,
			CONSTRAINT ck_decision_requests_schema CHECK (request_schema_version > 0),
			UNIQUE (session_id, request_id)
		);
		CREATE FUNCTION reject_game_command_input_mutation() RETURNS TRIGGER AS $$
		BEGIN RETURN NEW; END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER game_commands_immutable_input BEFORE UPDATE ON game_commands
			FOR EACH ROW EXECUTE FUNCTION reject_game_command_input_mutation();

		INSERT INTO ruleset_releases VALUES (
			'00000000-0000-0000-0000-000000000001',
			'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'serializer-v1'
		);
		INSERT INTO game_sessions VALUES (
			'00000000-0000-0000-0000-000000000002',
			'00000000-0000-0000-0000-000000000001',
			'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'serializer-v1'
		);
		INSERT INTO game_session_members VALUES (
			'00000000-0000-0000-0000-000000000002',
			'00000000-0000-0000-0000-000000000003', 'owner', 'active', TRUE
		);
		INSERT INTO game_commands (
			id, session_id, command_id, ruleset_release_id, rules_artifact_hash,
			controller_user_id, command_type, expected_revision, base_snapshot_seq,
			base_state_hash, command_schema_version, serializer_version,
			canonical_body, canonical_bytes, request_hash, execution_input,
			execution_input_canonical_bytes, execution_input_hash, admitted_at
		) VALUES (
			'00000000-0000-0000-0000-000000000004',
			'00000000-0000-0000-0000-000000000002',
			'00000000-0000-0000-0000-000000000005',
			'00000000-0000-0000-0000-000000000001',
			'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'00000000-0000-0000-0000-000000000003', 'legacy', 0, 0,
			'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			1, 'serializer-v1', '{}'::jsonb, '{}'::bytea,
			'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
			'{}'::jsonb, '{}'::bytea,
			'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', NOW()
		);
		INSERT INTO decision_requests VALUES (
			'00000000-0000-0000-0000-000000000002',
			'00000000-0000-0000-0000-000000000006',
			'00000000-0000-0000-0000-000000000007',
			'00000000-0000-0000-0000-000000000001',
			'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'serializer-v1', 1
		);
	`); err != nil {
		t.Fatalf("bootstrap recorded-090 shape: %v", err)
	}
	if err := hardenCanonicalTransport(db); err != nil {
		t.Fatal(err)
	}
	if err := hardenCanonicalTransport(db); err != nil {
		t.Fatalf("second hardening pass: %v", err)
	}

	var semanticID, requestID, resolutionID, requestType, resolutionType string
	if err := db.QueryRow(`SELECT semantic_command_id FROM game_commands`).Scan(&semanticID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT request_id, resolution_id FROM decision_requests`).Scan(&requestID, &resolutionID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT data_type FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'decision_requests' AND column_name = 'request_id'
	`).Scan(&requestType); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT data_type FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'decision_requests' AND column_name = 'resolution_id'
	`).Scan(&resolutionType); err != nil {
		t.Fatal(err)
	}
	if semanticID != "00000000-0000-0000-0000-000000000005" ||
		requestID != "00000000-0000-0000-0000-000000000006" ||
		resolutionID != "00000000-0000-0000-0000-000000000007" ||
		requestType != "character varying" || resolutionType != "character varying" {
		t.Fatalf("unexpected upgraded identities: semantic=%q request=%q/%q resolution=%q/%q",
			semanticID, requestID, requestType, resolutionID, resolutionType)
	}
	if _, err := db.Exec(`UPDATE game_commands SET semantic_command_id = 'rewritten'`); err == nil {
		t.Fatal("semantic command identity remained mutable after 094")
	}
}
