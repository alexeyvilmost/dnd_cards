package migrations

import (
	"strings"
	"testing"
)

func TestWorldRuntimeV5MigrationIsRegisteredAfterAttackRuntime(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for i, migration := range migrations {
		if migration.Version == "092_add_world_runtime_v5" {
			index = i
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("world runtime v5 migration must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("092_add_world_runtime_v5 is not registered")
	}
	if previous := migrations[index-1].Version; previous != "091_add_attack_runtime_v4" {
		t.Fatalf("migration before world runtime v5 = %q, want 091", previous)
	}
}

func TestWorldRuntimeV5DDLGuardsLiveAndHistoricalSnapshotsAdditively(t *testing.T) {
	ddl := normalizeDDL(worldRuntimeV5DDL)
	for label, fragment := range map[string]string{
		"safe schema helper":            "canonical_snapshot_schema_matches( snapshot jsonb, expected_schema_version integer )",
		"revision-bound validator":      "canonical_world_state_v5_is_valid( snapshot jsonb, expected_schema_version integer, expected_revision bigint )",
		"explicit SQL-null guard":       "if snapshot is null",
		"exact v5 boundary":             "expected_schema_version is distinct from 5",
		"live constraint":               "ck_game_sessions_world_runtime_v5",
		"historical constraint":         "ck_session_snapshots_world_runtime_v5",
		"legacy rollout boundary":       "snapshot_schema_version < 5 or ( snapshot_schema_version = 5",
		"check null fails closed":       "and coalesce(canonical_world_state_v5_is_valid",
		"existing-row preflight":        "existing game_sessions schema-v5+ snapshot failed canonical preflight",
		"initial not-valid attachment":  "not valid",
		"live immediate validation":     "validate constraint ck_game_sessions_world_runtime_v5",
		"history immediate validation":  "validate constraint ck_session_snapshots_world_runtime_v5",
		"qualified live lookup":         "conrelid = 'game_sessions'::regclass",
		"qualified history lookup":      "conrelid = 'session_snapshots'::regclass",
		"release-binding validator":     "canonical_world_state_release_binding_is_valid",
		"release artifact projection":   "release_row.artifact_version",
		"live release trigger":          "game_sessions_world_release_binding_v5",
		"history release trigger":       "session_snapshots_world_release_binding_v5",
		"required root clock":           "snapshot->'logicalclock'",
		"required actor runtime":        "actor->'runtime'",
		"required attack profile":       "actor->'attackprofile'",
		"actor lifecycle":               "actor->'lifecycle'",
		"strong death authority":        "canonical_actor_lifecycle",
		"death content pin":             "rulesetcontenthash",
		"unknown Pact rejection":        "pact_key not in ('blade', 'chain', 'tome')",
		"Pact source ownership":         "feature_sources->'warlock.pact.blade'",
		"Pact action ownership":         "blade->'bondactionid'",
		"conjured Pact provenance":      "weapon->'tags' ? 'pact_weapon'",
		"duplicate Pact bond rejection": "duplicate_bond",
		"Chain identity":                "findfamiliaractionid",
		"Tome identity":                 "book_of_shadows",
		"card/item bridge":              "itemcardid",
		"held hand pair":                "heldbyactorid",
		"duplicate hand rejection":      "having count(*) > 1",
		"active blade bond":             "warlockpacts,blade,activebond",
		"pending pact projection":       "pactbladeprojection",
		"system weapon action":          "core.attack.weapon",
		"pending continuation kind":     "attackcontinuationkind",
		"pending expected damage":       "expected_damage_type",
		"live actors index":             "idx_game_sessions_actors_v5",
		"live objects index":            "idx_game_sessions_objects_v5",
		"historical actors index":       "idx_session_snapshots_actors_v5",
		"historical objects index":      "idx_session_snapshots_objects_v5",
		"malformed JSON catch":          "exception when others then",
		"malformed JSON fails closed":   "return false;",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
	for _, forbidden := range []string{
		"drop table", "drop column", "truncate table", "delete from",
		"alter table characters_v3", "alter table encounters", "immutable strict",
	} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("world runtime migration contains destructive/legacy DDL %q", forbidden)
		}
	}
}
