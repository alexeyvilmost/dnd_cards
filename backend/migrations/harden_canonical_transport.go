package migrations

import (
	"database/sql"
	"fmt"
)

// hardenCanonicalTransportDDL upgrades installations where migration 090 has
// already been recorded. It is additive/idempotent and deliberately validates
// every new invariant so an inconsistent runtime fails closed at deploy time.
const hardenCanonicalTransportDDL = `
ALTER TABLE game_commands
	ADD COLUMN IF NOT EXISTS semantic_command_id VARCHAR(128);

UPDATE game_commands
	SET semantic_command_id = command_id::text
	WHERE semantic_command_id IS NULL;

ALTER TABLE game_commands
	ALTER COLUMN semantic_command_id TYPE VARCHAR(128),
	ALTER COLUMN semantic_command_id SET NOT NULL;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'decision_requests'
			AND column_name = 'request_id'
			AND data_type = 'uuid'
	) THEN
		ALTER TABLE decision_requests
			ALTER COLUMN request_id TYPE VARCHAR(128) USING request_id::text;
	END IF;
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'decision_requests'
			AND column_name = 'resolution_id'
			AND data_type = 'uuid'
	) THEN
		ALTER TABLE decision_requests
			ALTER COLUMN resolution_id TYPE VARCHAR(128) USING resolution_id::text;
	END IF;
END
$$;

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ruleset_releases'::regclass AND conname = 'uq_ruleset_releases_id_artifact_serializer') THEN
		ALTER TABLE ruleset_releases ADD CONSTRAINT uq_ruleset_releases_id_artifact_serializer
			UNIQUE (id, rules_artifact_hash, serializer_version);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_sessions'::regclass AND conname = 'uq_game_sessions_release_artifact_serializer') THEN
		ALTER TABLE game_sessions ADD CONSTRAINT uq_game_sessions_release_artifact_serializer
			UNIQUE (id, ruleset_release_id, rules_artifact_hash, serializer_version);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_commands'::regclass AND conname = 'uq_game_commands_session_semantic_command') THEN
		ALTER TABLE game_commands ADD CONSTRAINT uq_game_commands_session_semantic_command
			UNIQUE (session_id, semantic_command_id);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'decision_requests'::regclass AND conname = 'uq_decision_requests_session_resolution') THEN
		ALTER TABLE decision_requests ADD CONSTRAINT uq_decision_requests_session_resolution
			UNIQUE (session_id, resolution_id);
	END IF;
END
$$;

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_sessions'::regclass AND conname = 'ck_game_sessions_serializer') THEN
		ALTER TABLE game_sessions ADD CONSTRAINT ck_game_sessions_serializer
			CHECK (btrim(serializer_version) <> '') NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_session_members'::regclass AND conname = 'ck_game_session_members_elevated_role') THEN
		ALTER TABLE game_session_members ADD CONSTRAINT ck_game_session_members_elevated_role
			CHECK (NOT can_control_unowned_actors OR role IN ('owner', 'gm')) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_commands'::regclass AND conname = 'ck_game_commands_semantic_id') THEN
		ALTER TABLE game_commands ADD CONSTRAINT ck_game_commands_semantic_id
			CHECK (semantic_command_id = btrim(semantic_command_id) AND semantic_command_id <> ''
				AND octet_length(semantic_command_id) <= 128) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'decision_requests'::regclass AND conname = 'ck_decision_requests_request_id') THEN
		ALTER TABLE decision_requests ADD CONSTRAINT ck_decision_requests_request_id
			CHECK (request_id = btrim(request_id) AND request_id <> ''
				AND octet_length(request_id) <= 128) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'decision_requests'::regclass AND conname = 'ck_decision_requests_resolution_id') THEN
		ALTER TABLE decision_requests ADD CONSTRAINT ck_decision_requests_resolution_id
			CHECK (resolution_id = btrim(resolution_id) AND resolution_id <> ''
				AND octet_length(resolution_id) <= 128) NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'decision_requests'::regclass AND conname = 'ck_decision_requests_distinct_ids') THEN
		ALTER TABLE decision_requests ADD CONSTRAINT ck_decision_requests_distinct_ids
			CHECK (request_id <> resolution_id) NOT VALID;
	END IF;
END
$$;

ALTER TABLE decision_requests DROP CONSTRAINT IF EXISTS ck_decision_requests_schema;
ALTER TABLE decision_requests ADD CONSTRAINT ck_decision_requests_schema
	CHECK (request_schema_version = 1) NOT VALID;

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_sessions'::regclass AND conname = 'fk_game_sessions_release_artifact_serializer') THEN
		ALTER TABLE game_sessions ADD CONSTRAINT fk_game_sessions_release_artifact_serializer
			FOREIGN KEY (ruleset_release_id, rules_artifact_hash, serializer_version)
			REFERENCES ruleset_releases(id, rules_artifact_hash, serializer_version)
			ON DELETE RESTRICT NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_commands'::regclass AND conname = 'fk_game_commands_session_release_serializer') THEN
		ALTER TABLE game_commands ADD CONSTRAINT fk_game_commands_session_release_serializer
			FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
			REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version)
			ON DELETE RESTRICT NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'game_events'::regclass AND conname = 'fk_game_events_session_release_serializer') THEN
		ALTER TABLE game_events ADD CONSTRAINT fk_game_events_session_release_serializer
			FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
			REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version)
			ON DELETE RESTRICT NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'session_snapshots'::regclass AND conname = 'fk_session_snapshots_session_release_serializer') THEN
		ALTER TABLE session_snapshots ADD CONSTRAINT fk_session_snapshots_session_release_serializer
			FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
			REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version)
			ON DELETE RESTRICT NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'decision_requests'::regclass AND conname = 'fk_decision_requests_session_release_serializer') THEN
		ALTER TABLE decision_requests ADD CONSTRAINT fk_decision_requests_session_release_serializer
			FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
			REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version)
			ON DELETE RESTRICT NOT VALID;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'session_snapshots'::regclass AND conname = 'fk_session_snapshots_last_event') THEN
		ALTER TABLE session_snapshots ADD CONSTRAINT fk_session_snapshots_last_event
			FOREIGN KEY (session_id, last_event_hash)
			REFERENCES game_events(session_id, event_hash)
			ON DELETE RESTRICT NOT VALID;
	END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_snapshots_last_event
	ON session_snapshots(session_id, last_event_hash)
	WHERE last_event_hash IS NOT NULL;

ALTER TABLE game_sessions VALIDATE CONSTRAINT ck_game_sessions_serializer;
ALTER TABLE game_session_members VALIDATE CONSTRAINT ck_game_session_members_elevated_role;
ALTER TABLE game_commands VALIDATE CONSTRAINT ck_game_commands_semantic_id;
ALTER TABLE decision_requests VALIDATE CONSTRAINT ck_decision_requests_schema;
ALTER TABLE decision_requests VALIDATE CONSTRAINT ck_decision_requests_request_id;
ALTER TABLE decision_requests VALIDATE CONSTRAINT ck_decision_requests_resolution_id;
ALTER TABLE decision_requests VALIDATE CONSTRAINT ck_decision_requests_distinct_ids;
ALTER TABLE game_sessions VALIDATE CONSTRAINT fk_game_sessions_release_artifact_serializer;
ALTER TABLE game_commands VALIDATE CONSTRAINT fk_game_commands_session_release_serializer;
ALTER TABLE game_events VALIDATE CONSTRAINT fk_game_events_session_release_serializer;
ALTER TABLE session_snapshots VALIDATE CONSTRAINT fk_session_snapshots_session_release_serializer;
ALTER TABLE decision_requests VALIDATE CONSTRAINT fk_decision_requests_session_release_serializer;
ALTER TABLE session_snapshots VALIDATE CONSTRAINT fk_session_snapshots_last_event;

CREATE OR REPLACE FUNCTION reject_game_command_input_mutation()
RETURNS TRIGGER AS $$
BEGIN
	IF ROW(
		NEW.session_id, NEW.command_id, NEW.semantic_command_id,
		NEW.ruleset_release_id, NEW.rules_artifact_hash,
		NEW.source_actor_id, NEW.controller_user_id, NEW.spatial_fact_set_id,
		NEW.command_type, NEW.expected_revision, NEW.base_snapshot_seq,
		NEW.base_state_hash, NEW.command_schema_version, NEW.serializer_version,
		NEW.canonical_body, NEW.canonical_bytes, NEW.request_hash,
		NEW.execution_input, NEW.execution_input_canonical_bytes,
		NEW.execution_input_hash, NEW.admitted_at
	) IS DISTINCT FROM ROW(
		OLD.session_id, OLD.command_id, OLD.semantic_command_id,
		OLD.ruleset_release_id, OLD.rules_artifact_hash,
		OLD.source_actor_id, OLD.controller_user_id, OLD.spatial_fact_set_id,
		OLD.command_type, OLD.expected_revision, OLD.base_snapshot_seq,
		OLD.base_state_hash, OLD.command_schema_version, OLD.serializer_version,
		OLD.canonical_body, OLD.canonical_bytes, OLD.request_hash,
		OLD.execution_input, OLD.execution_input_canonical_bytes,
		OLD.execution_input_hash, OLD.admitted_at
	) THEN
		RAISE EXCEPTION 'immutable input of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	IF OLD.result_hash IS NOT NULL AND ROW(
		NEW.result_body, NEW.result_canonical_bytes, NEW.result_hash
	) IS DISTINCT FROM ROW(
		OLD.result_body, OLD.result_canonical_bytes, OLD.result_hash
	) THEN
		RAISE EXCEPTION 'canonical result of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	IF OLD.committed_fencing_token IS NOT NULL
		AND NEW.committed_fencing_token IS DISTINCT FROM OLD.committed_fencing_token THEN
		RAISE EXCEPTION 'fencing token of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`

func hardenCanonicalTransport(db *sql.DB) error {
	if _, err := db.Exec(hardenCanonicalTransportDDL); err != nil {
		return fmt.Errorf("harden canonical transport: %w", err)
	}
	return nil
}
