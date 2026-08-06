package migrations

import (
	"regexp"
	"strings"
	"testing"
)

func normalizeDDL(ddl string) string {
	return strings.ToLower(strings.Join(strings.Fields(ddl), " "))
}

func TestCanonicalRuntimeDDLHasNoDuplicateColumnDeclarations(t *testing.T) {
	tablePattern := regexp.MustCompile(`(?is)create table if not exists\s+([a-z_][a-z0-9_]*)\s*\((.*?)\n\);`)
	columnPattern := regexp.MustCompile(`(?im)^\s*([a-z_][a-z0-9_]*)\s+(uuid|varchar|integer|bigint|boolean|jsonb|bytea|timestamp)\b`)
	for _, table := range tablePattern.FindAllStringSubmatch(canonicalRuntimeDDL, -1) {
		seen := map[string]bool{}
		for _, column := range columnPattern.FindAllStringSubmatch(table[2], -1) {
			name := strings.ToLower(column[1])
			if seen[name] {
				t.Errorf("table %s declares column %s more than once", table[1], name)
			}
			seen[name] = true
		}
	}
}

func TestCanonicalRuntimeMigrationIsRegisteredAfterCurrentHead(t *testing.T) {
	migrations := GetAllMigrations()
	if len(migrations) < 2 {
		t.Fatalf("expected at least two migrations, got %d", len(migrations))
	}

	seen := make(map[string]struct{}, len(migrations))
	canonicalIndex := -1
	for index, migration := range migrations {
		if _, duplicate := seen[migration.Version]; duplicate {
			t.Fatalf("duplicate migration version %q", migration.Version)
		}
		seen[migration.Version] = struct{}{}
		if migration.Version == "090_create_canonical_runtime" {
			canonicalIndex = index
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("canonical runtime migration must register both Up and safe Down functions")
			}
		}
	}

	if canonicalIndex < 1 {
		t.Fatal("090_create_canonical_runtime is not registered")
	}
	if previous := migrations[canonicalIndex-1].Version; previous != "089_repair_spell_targeting_certifications" {
		t.Fatalf("migration before canonical runtime = %q, want current head 089", previous)
	}
}

func TestCanonicalRuntimeDDLDefinesAllFirstSliceTables(t *testing.T) {
	ddl := normalizeDDL(canonicalRuntimeDDL)
	for _, table := range []string{
		"ruleset_releases",
		"game_sessions",
		"game_session_members",
		"game_session_actors",
		"game_commands",
		"command_execution_jobs",
		"game_events",
		"session_snapshots",
		"spatial_fact_sets",
		"decision_requests",
		"transactional_outbox",
	} {
		if !strings.Contains(ddl, "create table if not exists "+table+" (") {
			t.Errorf("missing additive table %s", table)
		}
	}

	for _, forbidden := range []string{
		"alter table characters_v3",
		"alter table encounters",
		"alter table encounter_events",
		"drop table",
		"truncate table",
	} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("canonical runtime migration must not contain legacy/destructive DDL %q", forbidden)
		}
	}
}

func TestCanonicalRuntimeDDLGuardsCommandAndEventIdentity(t *testing.T) {
	ddl := normalizeDDL(canonicalRuntimeDDL)
	required := map[string]string{
		"unique command id per session":       "constraint uq_game_commands_session_command unique (session_id, command_id)",
		"unique semantic command per session": "constraint uq_game_commands_session_semantic_command unique (session_id, semantic_command_id)",
		"unique event seq per session":        "constraint uq_game_events_session_seq unique (session_id, seq)",
		"unique event command index":          "constraint uq_game_events_command_index unique (session_id, command_id, event_index)",
		"job unique per command":              "constraint uq_command_execution_jobs_command unique (session_id, command_id)",
		"job command foreign key":             "constraint fk_command_execution_jobs_command foreign key (session_id, command_id) references game_commands(session_id, command_id) on delete restrict",
		"event job fencing foreign key":       "constraint fk_game_events_job_fencing foreign key (session_id, command_id, command_fencing_token) references command_execution_jobs(session_id, command_id, fencing_token) on delete restrict",
		"outbox deduplication":                "constraint uq_transactional_outbox_dedup_key unique (dedup_key)",
	}
	for label, fragment := range required {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
}

func TestCanonicalRuntimeDDLHasLeaseHeartbeatAndFencingContract(t *testing.T) {
	ddl := normalizeDDL(canonicalRuntimeDDL)
	for label, fragment := range map[string]string{
		"lease owner":              "lease_owner varchar(255)",
		"lease deadline":           "lease_until timestamp with time zone",
		"heartbeat":                "heartbeat_at timestamp with time zone",
		"monotonic fencing token":  "fencing_token bigint not null default 0",
		"fencing lower bound":      "constraint ck_command_execution_jobs_fencing check (fencing_token >= 0)",
		"event fencing evidence":   "command_fencing_token bigint not null",
		"commit fencing evidence":  "committed_fencing_token bigint",
		"fencing tuple uniqueness": "constraint uq_command_execution_jobs_fencing unique (session_id, command_id, fencing_token)",
		"leased job shape":         "constraint ck_command_execution_jobs_lease check ( status <> 'leased' or ( lease_owner is not null and lease_acquired_at is not null and heartbeat_at is not null and lease_until is not null and fencing_token > 0 and lease_until > heartbeat_at ) )",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
}

func TestCanonicalRuntimeDDLProtectsCanonicalInputsAndAppendOnlyRows(t *testing.T) {
	ddl := normalizeDDL(canonicalRuntimeDDL)
	for label, fragment := range map[string]string{
		"canonical manifest bytes":  "manifest_canonical_bytes bytea not null",
		"canonical command bytes":   "canonical_bytes bytea not null",
		"immutable execution input": "execution_input_canonical_bytes bytea not null",
		"canonical result bytes":    "result_canonical_bytes bytea",
		"command request hash":      "request_hash varchar(71) not null",
		"event hash":                "event_hash varchar(71) not null",
		"state hash":                "state_hash_after varchar(71) not null",
		"rules artifact hash":       "rules_artifact_hash varchar(71) not null",
		"append-only guard":         "create or replace function reject_canonical_runtime_append_only_mutation()",
		"release append-only":       "before update or delete on ruleset_releases",
		"facts append-only":         "before update or delete on spatial_fact_sets",
		"events append-only":        "before update or delete on game_events",
		"snapshots append-only":     "before update or delete on session_snapshots",
		"immutable command input":   "before update on game_commands",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
}

func TestCanonicalRuntimeDDLSerializesOpenDecisionsAndProtectsResolutionShape(t *testing.T) {
	ddl := normalizeDDL(canonicalRuntimeDDL)
	for label, fragment := range map[string]string{
		"single open decision":   "create unique index if not exists uq_decision_requests_single_open on decision_requests(session_id) where status = 'open'",
		"resolved iff metadata":  "(status = 'resolved') = (resolved_by_command_id is not null and resolved_at is not null)",
		"release artifact guard": "create or replace function protect_ruleset_release_artifact()",
		"unique resolution id":   "constraint uq_decision_requests_session_resolution unique (session_id, resolution_id)",
		"string request id":      "request_id varchar(128) not null",
		"exact request schema":   "constraint ck_decision_requests_schema check (request_schema_version = 1)",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
}

func TestCanonicalRuntimeDDLTripleBindsReleaseArtifactAndSerializer(t *testing.T) {
	ddl := normalizeDDL(canonicalRuntimeDDL)
	for label, fragment := range map[string]string{
		"release tuple":       "constraint uq_ruleset_releases_id_artifact_serializer unique (id, rules_artifact_hash, serializer_version)",
		"session tuple":       "constraint uq_game_sessions_release_artifact_serializer unique (id, ruleset_release_id, rules_artifact_hash, serializer_version)",
		"session release FK":  "constraint fk_game_sessions_release_artifact_serializer foreign key (ruleset_release_id, rules_artifact_hash, serializer_version) references ruleset_releases(id, rules_artifact_hash, serializer_version) on delete restrict",
		"command session FK":  "constraint fk_game_commands_session_release_serializer foreign key (session_id, ruleset_release_id, rules_artifact_hash, serializer_version) references game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) on delete restrict",
		"snapshot event FK":   "constraint fk_session_snapshots_last_event foreign key (session_id, last_event_hash) references game_events(session_id, event_hash) on delete restrict",
		"elevated role guard": "constraint ck_game_session_members_elevated_role check (not can_control_unowned_actors or role in ('owner', 'gm'))",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
}
