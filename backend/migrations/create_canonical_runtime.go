package migrations

import (
	"database/sql"
	"fmt"
)

// canonicalRuntimeDDL introduces the isolated server-side runtime described by
// RE6. It is intentionally additive: legacy character and encounter tables are
// referenced where ownership matters, but are neither altered nor backfilled.
//
// Hashes use the same canonical sha256:<hex> representation as rules-core. The
// canonical byte columns retain the exact bytes which were hashed, so replay
// does not depend on PostgreSQL JSONB key ordering.
const canonicalRuntimeDDL = `
CREATE TABLE IF NOT EXISTS ruleset_releases (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	system_id VARCHAR(100) NOT NULL,
	ruleset_version VARCHAR(100) NOT NULL,
	errata_version VARCHAR(100) NOT NULL,
	manifest_schema_version INTEGER NOT NULL,
	protocol_schema_version INTEGER NOT NULL,
	artifact_version VARCHAR(100) NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	content_hash VARCHAR(71) NOT NULL,
	manifest_hash VARCHAR(71) NOT NULL,
	manifest JSONB NOT NULL,
	manifest_canonical_bytes BYTEA NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'active',
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	released_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT ck_ruleset_releases_manifest_schema CHECK (manifest_schema_version > 0),
	CONSTRAINT ck_ruleset_releases_protocol_schema CHECK (protocol_schema_version > 0),
	CONSTRAINT ck_ruleset_releases_artifact_hash CHECK (rules_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_ruleset_releases_content_hash CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_ruleset_releases_manifest_hash CHECK (manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_ruleset_releases_manifest_object CHECK (jsonb_typeof(manifest) = 'object'),
	CONSTRAINT ck_ruleset_releases_manifest_bytes CHECK (octet_length(manifest_canonical_bytes) > 0),
	CONSTRAINT ck_ruleset_releases_status CHECK (status IN ('draft', 'active', 'retired')),
	CONSTRAINT uq_ruleset_releases_manifest_hash UNIQUE (manifest_hash),
	CONSTRAINT uq_ruleset_releases_identity UNIQUE (system_id, ruleset_version, errata_version, rules_artifact_hash, content_hash),
	CONSTRAINT uq_ruleset_releases_id_artifact UNIQUE (id, rules_artifact_hash),
	CONSTRAINT uq_ruleset_releases_id_artifact_serializer UNIQUE (id, rules_artifact_hash, serializer_version)
);

CREATE INDEX IF NOT EXISTS idx_ruleset_releases_lookup
	ON ruleset_releases(system_id, ruleset_version, errata_version, status);

CREATE TABLE IF NOT EXISTS game_sessions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	ruleset_release_id UUID NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	created_by_user_id UUID NOT NULL,
	mode VARCHAR(20) NOT NULL DEFAULT 'exploration',
	authority_mode VARCHAR(30) NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'active',
	current_snapshot JSONB NOT NULL,
	snapshot_canonical_bytes BYTEA NOT NULL,
	snapshot_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	snapshot_seq BIGINT NOT NULL DEFAULT 0,
	revision BIGINT NOT NULL DEFAULT 0,
	state_hash VARCHAR(71) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	closed_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT fk_game_sessions_release_artifact
		FOREIGN KEY (ruleset_release_id, rules_artifact_hash)
		REFERENCES ruleset_releases(id, rules_artifact_hash) ON DELETE RESTRICT,
	CONSTRAINT fk_game_sessions_release_artifact_serializer
		FOREIGN KEY (ruleset_release_id, rules_artifact_hash, serializer_version)
		REFERENCES ruleset_releases(id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT,
	CONSTRAINT fk_game_sessions_creator
		FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
	CONSTRAINT ck_game_sessions_mode CHECK (mode IN ('exploration', 'encounter')),
	CONSTRAINT ck_game_sessions_authority CHECK (authority_mode IN ('local', 'server', 'legacy_shadow')),
	CONSTRAINT ck_game_sessions_status CHECK (status IN ('active', 'frozen', 'closed')),
	CONSTRAINT ck_game_sessions_snapshot_object CHECK (jsonb_typeof(current_snapshot) = 'object'),
	CONSTRAINT ck_game_sessions_snapshot_bytes CHECK (octet_length(snapshot_canonical_bytes) > 0),
	CONSTRAINT ck_game_sessions_snapshot_schema CHECK (snapshot_schema_version > 0),
	CONSTRAINT ck_game_sessions_serializer CHECK (btrim(serializer_version) <> ''),
	CONSTRAINT ck_game_sessions_snapshot_seq CHECK (snapshot_seq >= 0),
	CONSTRAINT ck_game_sessions_revision CHECK (revision >= 0),
	CONSTRAINT ck_game_sessions_state_hash CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_sessions_closed_at CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
	CONSTRAINT uq_game_sessions_release_artifact UNIQUE (id, ruleset_release_id, rules_artifact_hash),
	CONSTRAINT uq_game_sessions_release_artifact_serializer UNIQUE (id, ruleset_release_id, rules_artifact_hash, serializer_version)
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_creator_status
	ON game_sessions(created_by_user_id, status);
CREATE INDEX IF NOT EXISTS idx_game_sessions_ruleset_status
	ON game_sessions(ruleset_release_id, status);

CREATE TABLE IF NOT EXISTS game_session_members (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	user_id UUID NOT NULL,
	role VARCHAR(20) NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'active',
	can_control_unowned_actors BOOLEAN NOT NULL DEFAULT FALSE,
	joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	ended_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT fk_game_session_members_session
		FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE RESTRICT,
	CONSTRAINT fk_game_session_members_user
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
	CONSTRAINT ck_game_session_members_role CHECK (role IN ('owner', 'gm', 'player', 'observer')),
	CONSTRAINT ck_game_session_members_status CHECK (status IN ('active', 'left', 'revoked')),
	CONSTRAINT ck_game_session_members_lifecycle CHECK ((status = 'active') = (ended_at IS NULL)),
	CONSTRAINT ck_game_session_members_elevated_role CHECK (NOT can_control_unowned_actors OR role IN ('owner', 'gm')),
	CONSTRAINT uq_game_session_members_session_user UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_session_members_user_status
	ON game_session_members(user_id, status);

CREATE TABLE IF NOT EXISTS game_session_actors (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	ruleset_release_id UUID NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	character_id UUID,
	owner_user_id UUID,
	controller_user_id UUID,
	actor_kind VARCHAR(30) NOT NULL,
	lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'active',
	build_snapshot JSONB NOT NULL,
	build_canonical_bytes BYTEA NOT NULL,
	build_hash VARCHAR(71) NOT NULL,
	state_projection JSONB NOT NULL,
	state_hash VARCHAR(71) NOT NULL,
	projection_schema_version INTEGER NOT NULL,
	projection_seq BIGINT NOT NULL DEFAULT 0,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_game_session_actors_session_release
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT,
	CONSTRAINT fk_game_session_actors_character
		FOREIGN KEY (character_id) REFERENCES characters_v3(id) ON DELETE RESTRICT,
	CONSTRAINT fk_game_session_actors_owner_member
		FOREIGN KEY (session_id, owner_user_id)
		REFERENCES game_session_members(session_id, user_id) ON DELETE RESTRICT,
	CONSTRAINT fk_game_session_actors_controller_member
		FOREIGN KEY (session_id, controller_user_id)
		REFERENCES game_session_members(session_id, user_id) ON DELETE RESTRICT,
	CONSTRAINT ck_game_session_actors_kind CHECK (actor_kind IN ('player_character', 'npc', 'summoned_actor', 'external_actor', 'world_object')),
	CONSTRAINT ck_game_session_actors_status CHECK (lifecycle_status IN ('active', 'inactive', 'removed')),
	CONSTRAINT ck_game_session_actors_build_object CHECK (jsonb_typeof(build_snapshot) = 'object'),
	CONSTRAINT ck_game_session_actors_build_bytes CHECK (octet_length(build_canonical_bytes) > 0),
	CONSTRAINT ck_game_session_actors_build_hash CHECK (build_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_session_actors_state_object CHECK (jsonb_typeof(state_projection) = 'object'),
	CONSTRAINT ck_game_session_actors_state_hash CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_session_actors_projection_schema CHECK (projection_schema_version > 0),
	CONSTRAINT ck_game_session_actors_projection_seq CHECK (projection_seq >= 0),
	CONSTRAINT uq_game_session_actors_session_actor UNIQUE (session_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_game_session_actors_active_character
	ON game_session_actors(character_id)
	WHERE character_id IS NOT NULL AND lifecycle_status = 'active';
CREATE INDEX IF NOT EXISTS idx_game_session_actors_controller_status
	ON game_session_actors(session_id, controller_user_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_game_session_actors_projection
	ON game_session_actors(session_id, projection_seq);

CREATE TABLE IF NOT EXISTS spatial_fact_sets (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	provided_by_user_id UUID,
	facts_source VARCHAR(40) NOT NULL,
	board_revision BIGINT,
	facts_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	canonical_body JSONB NOT NULL,
	canonical_bytes BYTEA NOT NULL,
	facts_hash VARCHAR(71) NOT NULL,
	signature_key_id VARCHAR(255),
	signature BYTEA,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_spatial_fact_sets_session
		FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE RESTRICT,
	CONSTRAINT fk_spatial_fact_sets_provider_member
		FOREIGN KEY (session_id, provided_by_user_id)
		REFERENCES game_session_members(session_id, user_id) ON DELETE RESTRICT,
	CONSTRAINT ck_spatial_fact_sets_source CHECK (facts_source IN ('server_board', 'signed_gm_adjudication', 'local_fixture')),
	CONSTRAINT ck_spatial_fact_sets_board_revision CHECK (board_revision IS NULL OR board_revision >= 0),
	CONSTRAINT ck_spatial_fact_sets_schema CHECK (facts_schema_version > 0),
	CONSTRAINT ck_spatial_fact_sets_body_object CHECK (jsonb_typeof(canonical_body) = 'object'),
	CONSTRAINT ck_spatial_fact_sets_bytes CHECK (octet_length(canonical_bytes) > 0),
	CONSTRAINT ck_spatial_fact_sets_hash CHECK (facts_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_spatial_fact_sets_signature_pair CHECK ((signature_key_id IS NULL) = (signature IS NULL)),
	CONSTRAINT uq_spatial_fact_sets_session_hash UNIQUE (session_id, facts_hash),
	CONSTRAINT uq_spatial_fact_sets_session_id UNIQUE (session_id, id)
);

CREATE INDEX IF NOT EXISTS idx_spatial_fact_sets_session_created
	ON spatial_fact_sets(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_commands (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	command_id UUID NOT NULL,
	semantic_command_id VARCHAR(128) NOT NULL,
	ruleset_release_id UUID NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	source_actor_id UUID,
	controller_user_id UUID NOT NULL,
	spatial_fact_set_id UUID,
	command_type VARCHAR(100) NOT NULL,
	status VARCHAR(30) NOT NULL DEFAULT 'admitted',
	expected_revision BIGINT NOT NULL,
	base_snapshot_seq BIGINT NOT NULL,
	base_state_hash VARCHAR(71) NOT NULL,
	command_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	canonical_body JSONB NOT NULL,
	canonical_bytes BYTEA NOT NULL,
	request_hash VARCHAR(71) NOT NULL,
	execution_input JSONB NOT NULL,
	execution_input_canonical_bytes BYTEA NOT NULL,
	execution_input_hash VARCHAR(71) NOT NULL,
	result_body JSONB,
	result_canonical_bytes BYTEA,
	result_hash VARCHAR(71),
	rejection_code VARCHAR(100),
	committed_fencing_token BIGINT,
	admitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	started_at TIMESTAMP WITH TIME ZONE,
	completed_at TIMESTAMP WITH TIME ZONE,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_game_commands_session_release
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT,
	CONSTRAINT fk_game_commands_session_release_serializer
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT,
	CONSTRAINT fk_game_commands_source_actor
		FOREIGN KEY (session_id, source_actor_id)
		REFERENCES game_session_actors(session_id, id) ON DELETE RESTRICT,
	CONSTRAINT fk_game_commands_controller_member
		FOREIGN KEY (session_id, controller_user_id)
		REFERENCES game_session_members(session_id, user_id) ON DELETE RESTRICT,
	CONSTRAINT fk_game_commands_spatial_facts
		FOREIGN KEY (session_id, spatial_fact_set_id)
		REFERENCES spatial_fact_sets(session_id, id) ON DELETE RESTRICT,
	CONSTRAINT ck_game_commands_status CHECK (status IN ('admitted', 'executing', 'awaiting_decision', 'committed', 'rejected', 'stale', 'failed', 'dead_letter')),
	CONSTRAINT ck_game_commands_expected_revision CHECK (expected_revision >= 0),
	CONSTRAINT ck_game_commands_base_snapshot_seq CHECK (base_snapshot_seq >= 0),
	CONSTRAINT ck_game_commands_base_state_hash CHECK (base_state_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_commands_schema CHECK (command_schema_version > 0),
	CONSTRAINT ck_game_commands_semantic_id CHECK (
		semantic_command_id = btrim(semantic_command_id)
		AND semantic_command_id <> ''
		AND octet_length(semantic_command_id) <= 128
	),
	CONSTRAINT ck_game_commands_body_object CHECK (jsonb_typeof(canonical_body) = 'object'),
	CONSTRAINT ck_game_commands_bytes CHECK (octet_length(canonical_bytes) > 0),
	CONSTRAINT ck_game_commands_request_hash CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_commands_execution_input_object CHECK (jsonb_typeof(execution_input) = 'object'),
	CONSTRAINT ck_game_commands_execution_input_bytes CHECK (octet_length(execution_input_canonical_bytes) > 0),
	CONSTRAINT ck_game_commands_execution_input_hash CHECK (execution_input_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_commands_result_pair CHECK (
		(result_body IS NULL) = (result_canonical_bytes IS NULL)
		AND (result_body IS NULL) = (result_hash IS NULL)
	),
	CONSTRAINT ck_game_commands_result_bytes CHECK (result_canonical_bytes IS NULL OR octet_length(result_canonical_bytes) > 0),
	CONSTRAINT ck_game_commands_result_hash CHECK (result_hash IS NULL OR result_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_commands_fencing_token CHECK (committed_fencing_token IS NULL OR committed_fencing_token > 0),
	CONSTRAINT ck_game_commands_committed_fencing CHECK (status <> 'committed' OR committed_fencing_token IS NOT NULL),
	CONSTRAINT uq_game_commands_session_command UNIQUE (session_id, command_id),
	CONSTRAINT uq_game_commands_session_semantic_command UNIQUE (session_id, semantic_command_id)
);

CREATE INDEX IF NOT EXISTS idx_game_commands_session_status
	ON game_commands(session_id, status, admitted_at);
CREATE INDEX IF NOT EXISTS idx_game_commands_actor
	ON game_commands(session_id, source_actor_id, admitted_at);
CREATE INDEX IF NOT EXISTS idx_game_commands_request_hash
	ON game_commands(session_id, request_hash);

CREATE TABLE IF NOT EXISTS command_execution_jobs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	command_id UUID NOT NULL,
	status VARCHAR(30) NOT NULL DEFAULT 'queued',
	lease_owner VARCHAR(255),
	lease_acquired_at TIMESTAMP WITH TIME ZONE,
	lease_until TIMESTAMP WITH TIME ZONE,
	heartbeat_at TIMESTAMP WITH TIME ZONE,
	fencing_token BIGINT NOT NULL DEFAULT 0,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	max_attempts INTEGER NOT NULL DEFAULT 5,
	next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_error_code VARCHAR(100),
	last_error_details JSONB,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	completed_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT fk_command_execution_jobs_command
		FOREIGN KEY (session_id, command_id)
		REFERENCES game_commands(session_id, command_id) ON DELETE RESTRICT,
	CONSTRAINT ck_command_execution_jobs_status CHECK (status IN ('queued', 'leased', 'retry_wait', 'succeeded', 'dead_letter', 'cancelled')),
	CONSTRAINT ck_command_execution_jobs_fencing CHECK (fencing_token >= 0),
	CONSTRAINT ck_command_execution_jobs_attempts CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
	CONSTRAINT ck_command_execution_jobs_lease CHECK (
		status <> 'leased' OR (
			lease_owner IS NOT NULL
			AND lease_acquired_at IS NOT NULL
			AND heartbeat_at IS NOT NULL
			AND lease_until IS NOT NULL
			AND fencing_token > 0
			AND lease_until > heartbeat_at
		)
	),
	CONSTRAINT uq_command_execution_jobs_command UNIQUE (session_id, command_id),
	CONSTRAINT uq_command_execution_jobs_fencing UNIQUE (session_id, command_id, fencing_token)
);

CREATE INDEX IF NOT EXISTS idx_command_execution_jobs_claim
	ON command_execution_jobs(status, next_attempt_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_command_execution_jobs_heartbeat
	ON command_execution_jobs(status, heartbeat_at)
	WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS game_events (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	seq BIGINT NOT NULL,
	command_id UUID NOT NULL,
	event_index INTEGER NOT NULL,
	command_fencing_token BIGINT NOT NULL,
	ruleset_release_id UUID NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	source_actor_id UUID,
	target_actor_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
	event_type VARCHAR(100) NOT NULL,
	event_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	logical_time BIGINT NOT NULL,
	payload JSONB NOT NULL,
	canonical_bytes BYTEA NOT NULL,
	event_hash VARCHAR(71) NOT NULL,
	state_hash_before VARCHAR(71) NOT NULL,
	state_hash_after VARCHAR(71) NOT NULL,
	occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
	recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_game_events_session_release
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT,
	CONSTRAINT fk_game_events_session_release_serializer
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT,
	CONSTRAINT fk_game_events_command
		FOREIGN KEY (session_id, command_id)
		REFERENCES game_commands(session_id, command_id) ON DELETE RESTRICT,
	CONSTRAINT fk_game_events_job_fencing
		FOREIGN KEY (session_id, command_id, command_fencing_token)
		REFERENCES command_execution_jobs(session_id, command_id, fencing_token) ON DELETE RESTRICT,
	CONSTRAINT fk_game_events_source_actor
		FOREIGN KEY (session_id, source_actor_id)
		REFERENCES game_session_actors(session_id, id) ON DELETE RESTRICT,
	CONSTRAINT ck_game_events_seq CHECK (seq > 0),
	CONSTRAINT ck_game_events_event_index CHECK (event_index >= 0),
	CONSTRAINT ck_game_events_fencing CHECK (command_fencing_token > 0),
	CONSTRAINT ck_game_events_targets_array CHECK (jsonb_typeof(target_actor_ids) = 'array'),
	CONSTRAINT ck_game_events_schema CHECK (event_schema_version > 0),
	CONSTRAINT ck_game_events_logical_time CHECK (logical_time >= 0),
	CONSTRAINT ck_game_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
	CONSTRAINT ck_game_events_bytes CHECK (octet_length(canonical_bytes) > 0),
	CONSTRAINT ck_game_events_event_hash CHECK (event_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_events_state_hash_before CHECK (state_hash_before ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_game_events_state_hash_after CHECK (state_hash_after ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT uq_game_events_session_seq UNIQUE (session_id, seq),
	CONSTRAINT uq_game_events_command_index UNIQUE (session_id, command_id, event_index),
	CONSTRAINT uq_game_events_session_hash UNIQUE (session_id, event_hash),
	CONSTRAINT uq_game_events_session_id UNIQUE (session_id, id)
);

CREATE INDEX IF NOT EXISTS idx_game_events_command
	ON game_events(session_id, command_id, event_index);
CREATE INDEX IF NOT EXISTS idx_game_events_type
	ON game_events(session_id, event_type, seq);

CREATE TABLE IF NOT EXISTS session_snapshots (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	seq BIGINT NOT NULL,
	revision BIGINT NOT NULL,
	ruleset_release_id UUID NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	snapshot_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	snapshot JSONB NOT NULL,
	canonical_bytes BYTEA NOT NULL,
	state_hash VARCHAR(71) NOT NULL,
	last_event_hash VARCHAR(71),
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_session_snapshots_session_release
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT,
	CONSTRAINT fk_session_snapshots_session_release_serializer
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT,
	CONSTRAINT fk_session_snapshots_last_event
		FOREIGN KEY (session_id, last_event_hash)
		REFERENCES game_events(session_id, event_hash) ON DELETE RESTRICT,
	CONSTRAINT ck_session_snapshots_seq CHECK (seq >= 0),
	CONSTRAINT ck_session_snapshots_revision CHECK (revision >= 0),
	CONSTRAINT ck_session_snapshots_schema CHECK (snapshot_schema_version > 0),
	CONSTRAINT ck_session_snapshots_snapshot_object CHECK (jsonb_typeof(snapshot) = 'object'),
	CONSTRAINT ck_session_snapshots_bytes CHECK (octet_length(canonical_bytes) > 0),
	CONSTRAINT ck_session_snapshots_state_hash CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_session_snapshots_event_hash CHECK (last_event_hash IS NULL OR last_event_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_session_snapshots_genesis CHECK ((seq = 0 AND last_event_hash IS NULL) OR (seq > 0 AND last_event_hash IS NOT NULL)),
	CONSTRAINT uq_session_snapshots_session_seq UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_session_snapshots_latest
	ON session_snapshots(session_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_session_snapshots_state_hash
	ON session_snapshots(session_id, state_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_snapshots_last_event
	ON session_snapshots(session_id, last_event_hash)
	WHERE last_event_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS decision_requests (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	request_id VARCHAR(128) NOT NULL,
	resolution_id VARCHAR(128) NOT NULL,
	source_command_id UUID NOT NULL,
	resolved_by_command_id UUID,
	ruleset_release_id UUID NOT NULL,
	rules_artifact_hash VARCHAR(71) NOT NULL,
	deciding_actor_id UUID,
	assigned_controller_user_id UUID NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'open',
	opened_seq BIGINT NOT NULL,
	expected_revision BIGINT NOT NULL,
	projection_seq BIGINT NOT NULL,
	request_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	request_body JSONB NOT NULL,
	canonical_bytes BYTEA NOT NULL,
	request_hash VARCHAR(71) NOT NULL,
	deadline JSONB,
	default_decision JSONB,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	resolved_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT fk_decision_requests_session_release
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT,
	CONSTRAINT fk_decision_requests_session_release_serializer
		FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version)
		REFERENCES game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT,
	CONSTRAINT fk_decision_requests_source_command
		FOREIGN KEY (session_id, source_command_id)
		REFERENCES game_commands(session_id, command_id) ON DELETE RESTRICT,
	CONSTRAINT fk_decision_requests_resolved_command
		FOREIGN KEY (session_id, resolved_by_command_id)
		REFERENCES game_commands(session_id, command_id) ON DELETE RESTRICT,
	CONSTRAINT fk_decision_requests_actor
		FOREIGN KEY (session_id, deciding_actor_id)
		REFERENCES game_session_actors(session_id, id) ON DELETE RESTRICT,
	CONSTRAINT fk_decision_requests_controller_member
		FOREIGN KEY (session_id, assigned_controller_user_id)
		REFERENCES game_session_members(session_id, user_id) ON DELETE RESTRICT,
	CONSTRAINT ck_decision_requests_status CHECK (status IN ('open', 'resolved', 'expired', 'cancelled')),
	CONSTRAINT ck_decision_requests_opened_seq CHECK (opened_seq >= 0),
	CONSTRAINT ck_decision_requests_expected_revision CHECK (expected_revision >= 0),
	CONSTRAINT ck_decision_requests_projection_seq CHECK (projection_seq >= opened_seq),
	CONSTRAINT ck_decision_requests_schema CHECK (request_schema_version = 1),
	CONSTRAINT ck_decision_requests_request_id CHECK (
		request_id = btrim(request_id) AND request_id <> '' AND octet_length(request_id) <= 128
	),
	CONSTRAINT ck_decision_requests_resolution_id CHECK (
		resolution_id = btrim(resolution_id) AND resolution_id <> '' AND octet_length(resolution_id) <= 128
	),
	CONSTRAINT ck_decision_requests_distinct_ids CHECK (request_id <> resolution_id),
	CONSTRAINT ck_decision_requests_body_object CHECK (jsonb_typeof(request_body) = 'object'),
	CONSTRAINT ck_decision_requests_bytes CHECK (octet_length(canonical_bytes) > 0),
	CONSTRAINT ck_decision_requests_hash CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_decision_requests_resolution CHECK (
		(status = 'resolved') = (resolved_by_command_id IS NOT NULL AND resolved_at IS NOT NULL)
	),
	CONSTRAINT uq_decision_requests_session_request UNIQUE (session_id, request_id),
	CONSTRAINT uq_decision_requests_session_resolution UNIQUE (session_id, resolution_id)
);

CREATE INDEX IF NOT EXISTS idx_decision_requests_open_controller
	ON decision_requests(session_id, assigned_controller_user_id, opened_seq)
	WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_decision_requests_resolution
	ON decision_requests(session_id, resolution_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_requests_single_open
	ON decision_requests(session_id)
	WHERE status = 'open';

CREATE TABLE IF NOT EXISTS transactional_outbox (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id UUID NOT NULL,
	event_id UUID,
	topic VARCHAR(255) NOT NULL,
	aggregate_type VARCHAR(100) NOT NULL,
	aggregate_id UUID NOT NULL,
	dedup_key VARCHAR(255) NOT NULL,
	payload_schema_version INTEGER NOT NULL,
	serializer_version VARCHAR(100) NOT NULL,
	payload JSONB NOT NULL,
	canonical_bytes BYTEA NOT NULL,
	payload_hash VARCHAR(71) NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'pending',
	lease_owner VARCHAR(255),
	lease_until TIMESTAMP WITH TIME ZONE,
	heartbeat_at TIMESTAMP WITH TIME ZONE,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	max_attempts INTEGER NOT NULL DEFAULT 10,
	next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_error_code VARCHAR(100),
	last_error_details JSONB,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	published_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT fk_transactional_outbox_session
		FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE RESTRICT,
	CONSTRAINT fk_transactional_outbox_event
		FOREIGN KEY (session_id, event_id)
		REFERENCES game_events(session_id, id) ON DELETE RESTRICT,
	CONSTRAINT ck_transactional_outbox_schema CHECK (payload_schema_version > 0),
	CONSTRAINT ck_transactional_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object'),
	CONSTRAINT ck_transactional_outbox_bytes CHECK (octet_length(canonical_bytes) > 0),
	CONSTRAINT ck_transactional_outbox_hash CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT ck_transactional_outbox_status CHECK (status IN ('pending', 'leased', 'published', 'dead_letter')),
	CONSTRAINT ck_transactional_outbox_attempts CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
	CONSTRAINT ck_transactional_outbox_lease CHECK (
		status <> 'leased' OR (
			lease_owner IS NOT NULL
			AND heartbeat_at IS NOT NULL
			AND lease_until IS NOT NULL
			AND lease_until > heartbeat_at
		)
	),
	CONSTRAINT ck_transactional_outbox_published CHECK (status <> 'published' OR published_at IS NOT NULL),
	CONSTRAINT uq_transactional_outbox_dedup_key UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_transactional_outbox_claim
	ON transactional_outbox(status, next_attempt_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_transactional_outbox_session_created
	ON transactional_outbox(session_id, created_at);

CREATE OR REPLACE FUNCTION reject_canonical_runtime_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
	RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
		USING ERRCODE = '55000';
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_ruleset_release_artifact()
RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'ruleset_releases is retained; DELETE is not permitted'
			USING ERRCODE = '55000';
	END IF;
	IF ROW(
		NEW.system_id, NEW.ruleset_version, NEW.errata_version,
		NEW.manifest_schema_version, NEW.protocol_schema_version,
		NEW.artifact_version, NEW.serializer_version,
		NEW.rules_artifact_hash, NEW.content_hash, NEW.manifest_hash,
		NEW.manifest, NEW.manifest_canonical_bytes, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.system_id, OLD.ruleset_version, OLD.errata_version,
		OLD.manifest_schema_version, OLD.protocol_schema_version,
		OLD.artifact_version, OLD.serializer_version,
		OLD.rules_artifact_hash, OLD.content_hash, OLD.manifest_hash,
		OLD.manifest, OLD.manifest_canonical_bytes, OLD.created_at
	) THEN
		RAISE EXCEPTION 'immutable ruleset release artifact % cannot be changed', OLD.id
			USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ruleset_releases_append_only ON ruleset_releases;
CREATE TRIGGER ruleset_releases_append_only
	BEFORE UPDATE OR DELETE ON ruleset_releases
	FOR EACH ROW EXECUTE FUNCTION protect_ruleset_release_artifact();

DROP TRIGGER IF EXISTS spatial_fact_sets_append_only ON spatial_fact_sets;
CREATE TRIGGER spatial_fact_sets_append_only
	BEFORE UPDATE OR DELETE ON spatial_fact_sets
	FOR EACH ROW EXECUTE FUNCTION reject_canonical_runtime_append_only_mutation();

DROP TRIGGER IF EXISTS game_events_append_only ON game_events;
CREATE TRIGGER game_events_append_only
	BEFORE UPDATE OR DELETE ON game_events
	FOR EACH ROW EXECUTE FUNCTION reject_canonical_runtime_append_only_mutation();

DROP TRIGGER IF EXISTS session_snapshots_append_only ON session_snapshots;
CREATE TRIGGER session_snapshots_append_only
	BEFORE UPDATE OR DELETE ON session_snapshots
	FOR EACH ROW EXECUTE FUNCTION reject_canonical_runtime_append_only_mutation();

CREATE OR REPLACE FUNCTION reject_game_command_input_mutation()
RETURNS TRIGGER AS $$
BEGIN
	IF ROW(
		NEW.session_id,
		NEW.command_id,
		NEW.semantic_command_id,
		NEW.ruleset_release_id,
		NEW.rules_artifact_hash,
		NEW.source_actor_id,
		NEW.controller_user_id,
		NEW.spatial_fact_set_id,
		NEW.command_type,
		NEW.expected_revision,
		NEW.base_snapshot_seq,
		NEW.base_state_hash,
		NEW.command_schema_version,
		NEW.serializer_version,
		NEW.canonical_body,
		NEW.canonical_bytes,
		NEW.request_hash,
		NEW.execution_input,
		NEW.execution_input_canonical_bytes,
		NEW.execution_input_hash,
		NEW.admitted_at
	) IS DISTINCT FROM ROW(
		OLD.session_id,
		OLD.command_id,
		OLD.semantic_command_id,
		OLD.ruleset_release_id,
		OLD.rules_artifact_hash,
		OLD.source_actor_id,
		OLD.controller_user_id,
		OLD.spatial_fact_set_id,
		OLD.command_type,
		OLD.expected_revision,
		OLD.base_snapshot_seq,
		OLD.base_state_hash,
		OLD.command_schema_version,
		OLD.serializer_version,
		OLD.canonical_body,
		OLD.canonical_bytes,
		OLD.request_hash,
		OLD.execution_input,
		OLD.execution_input_canonical_bytes,
		OLD.execution_input_hash,
		OLD.admitted_at
	) THEN
		RAISE EXCEPTION 'immutable input of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	IF OLD.result_hash IS NOT NULL AND ROW(
		NEW.result_body,
		NEW.result_canonical_bytes,
		NEW.result_hash
	) IS DISTINCT FROM ROW(
		OLD.result_body,
		OLD.result_canonical_bytes,
		OLD.result_hash
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

DROP TRIGGER IF EXISTS game_commands_immutable_input ON game_commands;
CREATE TRIGGER game_commands_immutable_input
	BEFORE UPDATE ON game_commands
	FOR EACH ROW EXECUTE FUNCTION reject_game_command_input_mutation();
`

func createCanonicalRuntime(db *sql.DB) error {
	if _, err := db.Exec(canonicalRuntimeDDL); err != nil {
		return fmt.Errorf("create canonical runtime: %w", err)
	}
	return nil
}
