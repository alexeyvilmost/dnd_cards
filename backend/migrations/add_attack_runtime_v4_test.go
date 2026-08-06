package migrations

import (
	"strings"
	"testing"
)

func TestAttackRuntimeV4MigrationIsRegisteredAfterCanonicalRuntime(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for i, migration := range migrations {
		if migration.Version == "091_add_attack_runtime_v4" {
			index = i
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("attack runtime v4 migration must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("091_add_attack_runtime_v4 is not registered")
	}
	if previous := migrations[index-1].Version; previous != "090_create_canonical_runtime" {
		t.Fatalf("migration before attack runtime v4 = %q, want 090", previous)
	}
}

func TestAttackRuntimeV4DDLIsAdditiveAndGuardsBothSnapshotStores(t *testing.T) {
	ddl := normalizeDDL(attackRuntimeV4DDL)
	for label, fragment := range map[string]string{
		"live attack ledger":               "jsonb_typeof(current_snapshot->'attackactions') = 'object'",
		"live grapple ledger":              "jsonb_typeof(current_snapshot->'grapples') = 'object'",
		"history attack ledger":            "jsonb_typeof(snapshot->'attackactions') = 'object'",
		"history grapple ledger":           "jsonb_typeof(snapshot->'grapples') = 'object'",
		"live attack index":                "idx_game_sessions_attack_actions_v4",
		"live grapple index":               "idx_game_sessions_grapples_v4",
		"history attack index":             "idx_session_snapshots_attack_actions_v4",
		"history grapple index":            "idx_session_snapshots_grapples_v4",
		"legacy rollout boundary":          "snapshot_schema_version < 4 or",
		"existing-row safe rollout":        "not valid",
		"missing live keys fail closed":    "coalesce(jsonb_typeof(current_snapshot->'attackactions') = 'object', false)",
		"missing history keys fail closed": "coalesce(jsonb_typeof(snapshot->'attackactions') = 'object', false)",
		"live constraint table scope":      "conrelid = 'game_sessions'::regclass",
		"history constraint table scope":   "conrelid = 'session_snapshots'::regclass",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
	for _, forbidden := range []string{
		"drop table", "drop column", "truncate table", "delete from",
		"alter table characters_v3", "alter table encounters",
	} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("attack runtime migration contains destructive/legacy DDL %q", forbidden)
		}
	}
}
