package migrations

import (
	"encoding/json"
	"testing"
)

func mutateRuntimeSnapshot(
	t *testing.T,
	source string,
	mutate func(map[string]any),
) string {
	t.Helper()
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(source), &snapshot); err != nil {
		t.Fatalf("decode runtime snapshot fixture: %v", err)
	}
	mutate(snapshot)
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("encode runtime snapshot fixture: %v", err)
	}
	return string(encoded)
}

func runtimeMapAt(t *testing.T, root map[string]any, keys ...string) map[string]any {
	t.Helper()
	current := root
	for _, key := range keys {
		value, found := current[key]
		if !found {
			t.Fatalf("runtime fixture path %v is missing %q", keys, key)
		}
		next, ok := value.(map[string]any)
		if !ok {
			t.Fatalf("runtime fixture path %v key %q is %T, want object", keys, key, value)
		}
		current = next
	}
	return current
}

func cloneRuntimeMap(t *testing.T, source map[string]any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(source)
	if err != nil {
		t.Fatalf("clone runtime fixture: %v", err)
	}
	var clone map[string]any
	if err = json.Unmarshal(encoded, &clone); err != nil {
		t.Fatalf("decode cloned runtime fixture: %v", err)
	}
	return clone
}

// This is the compact, type-complete createWorld/schema-v5 shape, not merely
// the smaller set of fields that worldMigration.ts currently happens to read.
// The Pact Blade branch additionally carries actor-owned source/action proof and
// an immutable Card-to-concrete-item bridge.
func typeCompleteV5Snapshot(digest string) string {
	return `{
		"schemaVersion":5,
		"id":"world:v5",
		"ruleset":{
			"systemId":"dnd5e-2024",
			"releaseId":"test",
			"contentHash":"` + digest + `",
			"errataVersion":"test"
		},
		"revision":0,
		"logicalClock":0,
		"actors":{
			"actor:warlock":{
				"id":"actor:warlock",
				"name":"Test Warlock",
				"kind":"playerCharacter",
				"controllerId":"controller:test",
				"capabilities":{
					"actionIds":["action:pact-blade"],
					"featureSources":{"warlock.pact.blade":["EFF-pact-blade"]}
				},
				"character":{
					"abilityMods":{"str":0,"dex":0,"con":0,"int":0,"wis":0,"cha":3},
					"profBonus":2,
					"level":1
				},
				"runtime":{
					"hp":{"current":9,"max":9,"temp":0},
					"resources":{},
					"maxResources":{},
					"equipment":{"main_hand":"card:longsword"},
					"inventory":[],
					"activeEffects":[]
				},
				"lifecycle":{"status":"alive"},
				"attackProfile":{
					"attacksPerAction":1,
					"size":2,
					"reachFt":5,
					"graspingParts":["main_hand","off_hand"],
					"sourceEntityIds":["system:dnd5e-2024:attack-action"]
				},
				"warlockPacts":{"blade":{
					"kind":"blade",
					"sourceEntityId":"EFF-pact-blade",
					"ownerActorId":"actor:warlock",
					"bondActionId":"action:pact-blade",
					"activeBond":{
						"sourceEntityId":"EFF-pact-blade",
						"warlockActorId":"actor:warlock",
						"weaponObjectId":"object:pact-blade",
						"weaponCardId":"card:longsword",
						"weaponType":"longsword",
						"normalDamageType":"slashing",
						"conjured":true,
						"bondedAtRevision":0,
						"secondsBeyondFiveFeet":0,
						"lastDistanceBoardRevision":null
					}
				}}
			},
			"actor:target":{
				"id":"actor:target",
				"name":"Test Target",
				"kind":"monster",
				"controllerId":"controller:gm",
				"capabilities":{"actionIds":[]},
				"character":{
					"abilityMods":{"str":0,"dex":0,"con":0,"int":0,"wis":0,"cha":0},
					"profBonus":2,
					"level":1
				},
				"runtime":{
					"hp":{"current":5,"max":5,"temp":0},
					"resources":{},
					"maxResources":{},
					"equipment":{},
					"inventory":[],
					"activeEffects":[]
				},
				"lifecycle":{"status":"alive"},
				"attackProfile":{
					"attacksPerAction":1,
					"size":2,
					"reachFt":5,
					"graspingParts":["main_hand"],
					"sourceEntityIds":["system:dnd5e-2024:attack-action"]
				}
			}
		},
		"objects":{
			"object:pact-blade":{
				"id":"object:pact-blade",
				"name":"Pact Longsword",
				"kind":"item",
				"size":"small",
				"itemCardId":"card:longsword",
				"ownerActorId":"actor:warlock",
				"carriedByActorId":"actor:warlock",
				"heldByActorId":"actor:warlock",
				"heldInHand":"main_hand",
				"sourceActorId":"actor:warlock",
				"sourceActionId":"EFF-pact-blade",
				"tags":["melee","pact_weapon","spellcasting_focus","weapon"]
			}
		},
		"scene":{"mode":"exploration"},
		"processedCommandIds":[],
		"pendingResolution":null,
		"concentrations":{},
		"attackActions":{},
		"grapples":{}
	}`
}

func validPendingPactBladeV5(t *testing.T, source string) string {
	t.Helper()
	return mutateRuntimeSnapshot(t, source, func(snapshot map[string]any) {
		snapshot["pendingResolution"] = map[string]any{
			"id":                     "resolution:pact-blade",
			"type":                   "attack_reaction",
			"actionId":               "core.attack.weapon",
			"attackContinuationKind": "weapon_melee",
			"sourceActorId":          "actor:warlock",
			"targetActorId":          "actor:target",
			"weaponCardId":           "card:longsword",
			"weaponHand":             "main",
			"pactBladeProjection": map[string]any{
				"weaponObjectId":     "object:pact-blade",
				"weaponCardId":       "card:longsword",
				"weaponHand":         "main",
				"abilityChoice":      "cha",
				"attackAbility":      "cha",
				"damageAbility":      "cha",
				"damageChoice":       "psychic",
				"resolvedDamageType": "psychic",
			},
		}
	})
}

type invalidRuntimeSnapshotCase struct {
	label               string
	snapshot            string
	schemaVersion       int
	revision            int64
	checkReleaseBinding bool
}

// Run with CANONICAL_RUNTIME_TEST_DSN against a fresh, isolated PostgreSQL 16
// database. The two legacy tables are the explicit bootstrap boundary of
// migrations 090-092.
func TestCanonicalRuntimeDDLExecutesTwiceOnIsolatedPostgres(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	var err error
	if _, err = db.Exec(`
		CREATE EXTENSION IF NOT EXISTS pgcrypto;
		CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY);
		CREATE TABLE IF NOT EXISTS characters_v3 (id UUID PRIMARY KEY);
	`); err != nil {
		t.Fatalf("bootstrap legacy boundary: %v", err)
	}
	if err = createCanonicalRuntime(db); err != nil {
		t.Fatal(err)
	}
	if err = createCanonicalRuntime(db); err != nil {
		t.Fatalf("canonical runtime migration is not idempotent: %v", err)
	}
	if err = addAttackRuntimeV4(db); err != nil {
		t.Fatal(err)
	}
	if err = addAttackRuntimeV4(db); err != nil {
		t.Fatalf("attack runtime v4 migration is not idempotent: %v", err)
	}

	const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const otherDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	var releaseID string
	err = db.QueryRow(`
		INSERT INTO ruleset_releases (
			system_id, ruleset_version, errata_version,
			manifest_schema_version, protocol_schema_version,
			artifact_version, serializer_version,
			rules_artifact_hash, content_hash, manifest_hash,
			manifest, manifest_canonical_bytes, status
		) VALUES ('dnd5e-2024', '2024', 'test', 1, 1, 'test', 'test',
			$1, $1, $1, '{}'::jsonb, '{}'::bytea, 'draft')
		RETURNING id
	`, digest).Scan(&releaseID)
	if err != nil {
		t.Fatalf("insert release: %v", err)
	}
	if _, err = db.Exec(
		`UPDATE ruleset_releases SET status = 'active', released_at = now() WHERE id = $1`,
		releaseID,
	); err != nil {
		t.Fatalf("allowed release lifecycle update failed: %v", err)
	}
	if _, err = db.Exec(
		`UPDATE ruleset_releases SET content_hash = $1 WHERE id = $2`,
		otherDigest,
		releaseID,
	); err == nil {
		t.Fatal("immutable release artifact update unexpectedly succeeded")
	}

	var userID string
	if err = db.QueryRow(
		`INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`,
	).Scan(&userID); err != nil {
		t.Fatalf("insert isolated user: %v", err)
	}
	insertV4Session := `
		INSERT INTO game_sessions (
			ruleset_release_id, rules_artifact_hash, created_by_user_id,
			authority_mode, current_snapshot, snapshot_canonical_bytes,
			snapshot_schema_version, serializer_version, state_hash
		) VALUES ($1, $2, $3, 'local', $4::text::jsonb, convert_to($4::text, 'UTF8'), 4, 'test', $2)
		RETURNING id
	`
	if _, err = db.Exec(insertV4Session, releaseID, digest, userID, `{}`); err == nil {
		t.Fatal("schema-v4 game session without Attack/grapple ledgers unexpectedly succeeded")
	}
	validV4Snapshot := `{"attackActions":{},"grapples":{}}`
	var v4SessionID string
	if err = db.QueryRow(
		insertV4Session, releaseID, digest, userID, validV4Snapshot,
	).Scan(&v4SessionID); err != nil {
		t.Fatalf("insert valid schema-v4 game session: %v", err)
	}
	insertV4Snapshot := `
		INSERT INTO session_snapshots (
			session_id, seq, revision, ruleset_release_id, rules_artifact_hash,
			snapshot_schema_version, serializer_version, snapshot, canonical_bytes, state_hash
		) VALUES ($1, 0, 0, $2, $3, 4, 'test', $4::text::jsonb, convert_to($4::text, 'UTF8'), $3)
	`
	if _, err = db.Exec(
		insertV4Snapshot, v4SessionID, releaseID, digest, `{}`,
	); err == nil {
		t.Fatal("schema-v4 historical snapshot without Attack/grapple ledgers unexpectedly succeeded")
	}
	if _, err = db.Exec(
		insertV4Snapshot, v4SessionID, releaseID, digest, validV4Snapshot,
	); err != nil {
		t.Fatalf("insert valid schema-v4 historical snapshot: %v", err)
	}

	// Constraint names are only table-local. A migration that looks up conname
	// globally would silently skip both authoritative-table constraints here.
	if _, err = db.Exec(`
		CREATE TABLE world_runtime_live_constraint_collision (
			id INTEGER,
			CONSTRAINT ck_game_sessions_world_runtime_v5 CHECK (TRUE)
		);
		CREATE TABLE world_runtime_history_constraint_collision (
			id INTEGER,
			CONSTRAINT ck_session_snapshots_world_runtime_v5 CHECK (TRUE)
		);
	`); err != nil {
		t.Fatalf("create constraint-name collision fixtures: %v", err)
	}

	// Before 092, v4 only checks the two ledgers and therefore permits a malformed
	// row labelled schema 5. Hardened 092 must stop instead of leaving it behind
	// under a permanently NOT VALID constraint.
	var invalidExistingSessionID string
	err = db.QueryRow(`
		INSERT INTO game_sessions (
			ruleset_release_id, rules_artifact_hash, created_by_user_id,
			authority_mode, current_snapshot, snapshot_canonical_bytes,
			snapshot_schema_version, serializer_version, state_hash
		) VALUES ($1, $2, $3, 'local', $4::text::jsonb, convert_to($4::text, 'UTF8'), 5, 'test', $2)
		RETURNING id
	`, releaseID, digest, userID, `{"attackActions":{},"grapples":{}}`).Scan(&invalidExistingSessionID)
	if err != nil {
		t.Fatalf("insert pre-092 invalid schema-v5 fixture: %v", err)
	}
	if err = addWorldRuntimeV5(db); err == nil {
		t.Fatal("world runtime v5 migration ignored an existing invalid v5 snapshot")
	}
	if _, err = db.Exec(`DELETE FROM game_sessions WHERE id = $1`, invalidExistingSessionID); err != nil {
		t.Fatalf("remove isolated preflight fixture: %v", err)
	}
	if err = addWorldRuntimeV5(db); err != nil {
		t.Fatal(err)
	}
	if err = addWorldRuntimeV5(db); err != nil {
		t.Fatalf("world runtime v5 migration is not idempotent: %v", err)
	}
	if err = hardenCanonicalTransport(db); err != nil {
		t.Fatal(err)
	}
	if err = hardenCanonicalTransport(db); err != nil {
		t.Fatalf("canonical transport hardening is not idempotent: %v", err)
	}

	for _, constraintName := range []string{
		"ck_game_sessions_world_runtime_v5",
		"ck_session_snapshots_world_runtime_v5",
	} {
		var validated bool
		if err = db.QueryRow(`
			SELECT convalidated
			FROM pg_constraint
			WHERE conname = $1
				AND conrelid IN ('game_sessions'::regclass, 'session_snapshots'::regclass)
		`, constraintName).Scan(&validated); err != nil {
			t.Fatalf("inspect %s: %v", constraintName, err)
		}
		if !validated {
			t.Errorf("constraint %s remains NOT VALID", constraintName)
		}
	}

	var legacyImplicit, legacyExplicit, legacyMismatch bool
	if err = db.QueryRow(`
		SELECT
			canonical_snapshot_schema_matches('{}'::jsonb, 4),
			canonical_snapshot_schema_matches('{"schemaVersion":4}'::jsonb, 4),
			canonical_snapshot_schema_matches('{"schemaVersion":5}'::jsonb, 4)
	`).Scan(&legacyImplicit, &legacyExplicit, &legacyMismatch); err != nil {
		t.Fatalf("validate legacy schema matching: %v", err)
	}
	if !legacyImplicit || !legacyExplicit || legacyMismatch {
		t.Fatalf(
			"legacy schema matching = implicit:%v explicit:%v mismatch:%v",
			legacyImplicit, legacyExplicit, legacyMismatch,
		)
	}
	var nullSchemaValid, nullWorldValid bool
	if err = db.QueryRow(`
		SELECT
			canonical_snapshot_schema_matches(NULL::jsonb, 5),
			canonical_world_state_v5_is_valid(NULL::jsonb, 5, 0)
	`).Scan(&nullSchemaValid, &nullWorldValid); err != nil {
		t.Fatalf("validate SQL NULL fail-closed behavior: %v", err)
	}
	if nullSchemaValid || nullWorldValid {
		t.Fatalf("SQL NULL unexpectedly valid: schema=%v world=%v", nullSchemaValid, nullWorldValid)
	}

	validV5Snapshot := typeCompleteV5Snapshot(digest)
	var directValid, releaseBindingValid bool
	if err = db.QueryRow(`
		SELECT
			canonical_world_state_v5_is_valid($1::text::jsonb, 5, 0),
			canonical_world_state_release_binding_is_valid($1::text::jsonb, $2, $3)
	`, validV5Snapshot, releaseID, digest).Scan(&directValid, &releaseBindingValid); err != nil {
		t.Fatalf("validate type-complete schema-v5 fixture: %v", err)
	}
	if !directValid || !releaseBindingValid {
		t.Fatalf("type-complete v5 fixture rejected: world=%v release=%v", directValid, releaseBindingValid)
	}

	insertV5Session := `
		INSERT INTO game_sessions (
			ruleset_release_id, rules_artifact_hash, created_by_user_id,
			authority_mode, current_snapshot, snapshot_canonical_bytes,
			snapshot_schema_version, serializer_version, revision, state_hash
		) VALUES (
			$1, $2, $3, 'local', $4::text::jsonb, convert_to($4::text, 'UTF8'),
			$5, 'test', $6, $2
		)
		RETURNING id
	`
	var v5SessionID string
	if err = db.QueryRow(
		insertV5Session, releaseID, digest, userID, validV5Snapshot, 5, 0,
	).Scan(&v5SessionID); err != nil {
		t.Fatalf("insert valid schema-v5 game session: %v", err)
	}
	insertV5Snapshot := `
		INSERT INTO session_snapshots (
			session_id, seq, revision, ruleset_release_id, rules_artifact_hash,
			snapshot_schema_version, serializer_version, snapshot, canonical_bytes,
			state_hash, last_event_hash
		) VALUES (
			$1, $2, $3, $4, $5, $6, 'test', $7::text::jsonb,
			convert_to($7::text, 'UTF8'), $5, $8
		)
	`
	if _, err = db.Exec(
		insertV5Snapshot, v5SessionID, 0, 0, releaseID, digest, 5, validV5Snapshot, nil,
	); err != nil {
		t.Fatalf("insert valid schema-v5 historical snapshot: %v", err)
	}

	validPendingV5 := validPendingPactBladeV5(t, validV5Snapshot)
	if err = db.QueryRow(
		`SELECT canonical_world_state_v5_is_valid($1::text::jsonb, 5, 0)`,
		validPendingV5,
	).Scan(&directValid); err != nil || !directValid {
		t.Fatalf("valid Pact Blade continuation rejected: valid=%v err=%v", directValid, err)
	}

	validChainV5 := mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
		actor := runtimeMapAt(t, snapshot, "actors", "actor:warlock")
		capabilities := runtimeMapAt(t, actor, "capabilities")
		capabilities["actionIds"] = append(
			capabilities["actionIds"].([]any), "action:find-familiar",
		)
		featureSources := runtimeMapAt(t, capabilities, "featureSources")
		featureSources["warlock.pact.chain"] = []any{"EFF-pact-chain"}
		pacts := runtimeMapAt(t, actor, "warlockPacts")
		pacts["chain"] = map[string]any{
			"kind":           "chain",
			"sourceEntityId": "EFF-pact-chain",
			"ownerActorId":   "actor:warlock",
			"template": map[string]any{
				"findFamiliarActionId": "action:find-familiar",
				"normalFormSource":     "find_familiar_spell",
				"specialFormIds": []any{
					"imp", "pseudodragon", "quasit", "skeleton", "slaad_tadpole",
					"sphinx_of_wonder", "sprite", "venomous_snake",
				},
			},
			"activeFamiliar": nil,
		}
	})
	if err = db.QueryRow(
		`SELECT canonical_world_state_v5_is_valid($1::text::jsonb, 5, 0)`,
		validChainV5,
	).Scan(&directValid); err != nil || !directValid {
		t.Fatalf("valid Pact Chain identity rejected: valid=%v err=%v", directValid, err)
	}
	validTomeV5 := mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
		actor := runtimeMapAt(t, snapshot, "actors", "actor:warlock")
		capabilities := runtimeMapAt(t, actor, "capabilities")
		capabilities["actionIds"] = append(
			capabilities["actionIds"].([]any), "c1", "c2", "c3", "r1", "r2",
		)
		featureSources := runtimeMapAt(t, capabilities, "featureSources")
		featureSources["warlock.pact.tome"] = []any{"EFF-pact-tome"}
		runtime := runtimeMapAt(t, actor, "runtime")
		runtimeMapAt(t, runtime, "resources")["spell_slot_1"] = float64(1)
		runtimeMapAt(t, runtime, "maxResources")["spell_slot_1"] = float64(1)
		actor["spellcastingAccess"] = map[string]any{
			"preparedSources": map[string]any{},
			"grants": []any{
				map[string]any{
					"grantId": "g1", "actionId": "c1", "sourceId": "object:book",
					"access": "cantrip", "level": float64(0), "spellcastingAbility": "cha",
				},
				map[string]any{
					"grantId": "g2", "actionId": "c2", "sourceId": "object:book",
					"access": "cantrip", "level": float64(0), "spellcastingAbility": "cha",
				},
				map[string]any{
					"grantId": "g3", "actionId": "c3", "sourceId": "object:book",
					"access": "cantrip", "level": float64(0), "spellcastingAbility": "cha",
				},
				map[string]any{
					"grantId": "g4", "actionId": "r1", "sourceId": "object:book",
					"access": "always_prepared", "level": float64(1),
					"spellcastingAbility": "cha", "ritual": true, "slotResource": "spell_slot_1",
				},
				map[string]any{
					"grantId": "g5", "actionId": "r2", "sourceId": "object:book",
					"access": "always_prepared", "level": float64(1),
					"spellcastingAbility": "cha", "ritual": true, "slotResource": "spell_slot_1",
				},
			},
		}
		pacts := runtimeMapAt(t, actor, "warlockPacts")
		pacts["tome"] = map[string]any{
			"kind":           "tome",
			"sourceEntityId": "EFF-pact-tome",
			"ownerActorId":   "actor:warlock",
			"tome": map[string]any{
				"sourceEntityId":   "EFF-pact-tome",
				"ownerActorId":     "actor:warlock",
				"bookObjectId":     "object:book",
				"cantripActionIds": []any{"c1", "c2", "c3"},
				"ritualActionIds":  []any{"r1", "r2"},
				"spellGrantIds":    []any{"g1", "g2", "g3", "g4", "g5"},
				"createdAfterRest": "short",
			},
		}
		objects := runtimeMapAt(t, snapshot, "objects")
		objects["object:book"] = map[string]any{
			"id":               "object:book",
			"name":             "Book of Shadows",
			"kind":             "item",
			"size":             "small",
			"ownerActorId":     "actor:warlock",
			"carriedByActorId": "actor:warlock",
			"sourceActorId":    "actor:warlock",
			"sourceActionId":   "EFF-pact-tome",
			"tags":             []any{"book_of_shadows", "spellcasting_focus"},
		}
	})
	if err = db.QueryRow(
		`SELECT canonical_world_state_v5_is_valid($1::text::jsonb, 5, 0)`,
		validTomeV5,
	).Scan(&directValid); err != nil || !directValid {
		t.Fatalf("valid Pact Tome identity rejected: valid=%v err=%v", directValid, err)
	}

	validDeadV5 := mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
		snapshot["revision"] = float64(1)
		snapshot["logicalClock"] = float64(1)
		actor := runtimeMapAt(t, snapshot, "actors", "actor:warlock")
		delete(actor, "warlockPacts")
		actor["lifecycle"] = map[string]any{
			"status": "dead",
			"adjudication": map[string]any{
				"type":                    "ActorDeathAdjudicated",
				"provenance":              "canonical_actor_lifecycle",
				"factId":                  "fact:death",
				"actorId":                 "actor:warlock",
				"adjudicatedBy":           "gm:test",
				"observedAtWorldRevision": 0,
				"rulesetContentHash":      digest,
			},
		}
		snapshot["objects"] = map[string]any{}
	})
	if err = db.QueryRow(
		`SELECT canonical_world_state_v5_is_valid($1::text::jsonb, 5, 1)`,
		validDeadV5,
	).Scan(&directValid); err != nil || !directValid {
		t.Fatalf("valid committed actor-death snapshot rejected: valid=%v err=%v", directValid, err)
	}

	invalidCases := []invalidRuntimeSnapshotCase{
		{
			label: "column 4 declares JSON schema 5", snapshot: validV5Snapshot,
			schemaVersion: 4, revision: 0,
		},
		{
			label: "JSON schema 6 on column 5",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				snapshot["schemaVersion"] = float64(6)
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "future column and JSON schema 6",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				snapshot["schemaVersion"] = float64(6)
			}),
			schemaVersion: 6, revision: 0,
		},
		{
			label: "column 6 with JSON schema 5", snapshot: validV5Snapshot,
			schemaVersion: 6, revision: 0,
		},
		{
			label: "relational revision mismatch", snapshot: validV5Snapshot,
			schemaVersion: 5, revision: 1,
		},
		{
			label: "root id JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				snapshot["id"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "actor runtime JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "actors", "actor:warlock")["runtime"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "object name JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "objects", "object:pact-blade")["name"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "empty Pact state",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "actors", "actor:warlock")["warlockPacts"] = map[string]any{}
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Chain Pact JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "actors", "actor:warlock", "warlockPacts")["chain"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Tome Pact JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "actors", "actor:warlock", "warlockPacts")["tome"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Chain familiar references a non-summoned actor",
			snapshot: mutateRuntimeSnapshot(t, validChainV5, func(snapshot map[string]any) {
				chain := runtimeMapAt(
					t, snapshot, "actors", "actor:warlock", "warlockPacts", "chain",
				)
				chain["activeFamiliar"] = map[string]any{
					"actorId":           "actor:target",
					"ownerActorId":      "actor:warlock",
					"formId":            "imp",
					"sourceEntityId":    "EFF-pact-chain",
					"reactionAvailable": true,
				}
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Tome grant points outside its Book of Shadows",
			snapshot: mutateRuntimeSnapshot(t, validTomeV5, func(snapshot map[string]any) {
				actor := runtimeMapAt(t, snapshot, "actors", "actor:warlock")
				access := runtimeMapAt(t, actor, "spellcastingAccess")
				grants := access["grants"].([]any)
				grants[0].(map[string]any)["sourceId"] = "object:forged"
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "unknown Pact branch",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "actors", "actor:warlock", "warlockPacts")["forged"] = map[string]any{}
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Blade bond action JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "actors", "actor:warlock", "warlockPacts", "blade")["bondActionId"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Blade source is not actor-owned",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				featureSources := runtimeMapAt(
					t, snapshot, "actors", "actor:warlock", "capabilities", "featureSources",
				)
				featureSources["warlock.pact.blade"] = []any{"EFF-other"}
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Blade weapon type JSON null",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				bond := runtimeMapAt(
					t, snapshot, "actors", "actor:warlock", "warlockPacts", "blade", "activeBond",
				)
				bond["weaponType"] = nil
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Blade distance revision missing",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				bond := runtimeMapAt(
					t, snapshot, "actors", "actor:warlock", "warlockPacts", "blade", "activeBond",
				)
				delete(bond, "lastDistanceBoardRevision")
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "forged conjured Blade provenance",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				weapon := runtimeMapAt(t, snapshot, "objects", "object:pact-blade")
				weapon["sourceActorId"] = "actor:target"
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "Pact weapon attuned to another actor",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "objects", "object:pact-blade")["attunedToActorId"] = "actor:target"
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "same object bonded by two Warlocks",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				actors := runtimeMapAt(t, snapshot, "actors")
				second := cloneRuntimeMap(t, runtimeMapAt(t, actors, "actor:warlock"))
				second["id"] = "actor:second"
				second["name"] = "Second Warlock"
				second["controllerId"] = "controller:second"
				blade := runtimeMapAt(t, second, "warlockPacts", "blade")
				blade["ownerActorId"] = "actor:second"
				bond := runtimeMapAt(t, blade, "activeBond")
				bond["warlockActorId"] = "actor:second"
				bond["conjured"] = false
				actors["actor:second"] = second
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "release content hash mismatch",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "ruleset")["contentHash"] = otherDigest
			}),
			schemaVersion: 5, revision: 0, checkReleaseBinding: true,
		},
		{
			label: "release artifact projection mismatch",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "ruleset")["releaseId"] = "forged"
			}),
			schemaVersion: 5, revision: 0, checkReleaseBinding: true,
		},
		{
			label: "release system mismatch",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "ruleset")["systemId"] = "forged"
			}),
			schemaVersion: 5, revision: 0, checkReleaseBinding: true,
		},
		{
			label: "release errata mismatch",
			snapshot: mutateRuntimeSnapshot(t, validV5Snapshot, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "ruleset")["errataVersion"] = "forged"
			}),
			schemaVersion: 5, revision: 0, checkReleaseBinding: true,
		},
		{
			label: "pending weapon card mirror missing",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				delete(runtimeMapAt(t, snapshot, "pendingResolution"), "weaponCardId")
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "pending weapon hand mirror missing",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				delete(runtimeMapAt(t, snapshot, "pendingResolution"), "weaponHand")
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "pending system action mismatch",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "pendingResolution")["actionId"] = "forged"
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "pending continuation kind missing",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				delete(runtimeMapAt(t, snapshot, "pendingResolution"), "attackContinuationKind")
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "pending continuation kind invalid",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				runtimeMapAt(t, snapshot, "pendingResolution")["attackContinuationKind"] = "spell"
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "pending selected damage mismatch",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				projection := runtimeMapAt(t, snapshot, "pendingResolution", "pactBladeProjection")
				projection["resolvedDamageType"] = "fire"
			}),
			schemaVersion: 5, revision: 0,
		},
		{
			label: "pending normal damage mismatch",
			snapshot: mutateRuntimeSnapshot(t, validPendingV5, func(snapshot map[string]any) {
				projection := runtimeMapAt(t, snapshot, "pendingResolution", "pactBladeProjection")
				projection["damageChoice"] = "normal"
				projection["resolvedDamageType"] = "psychic"
			}),
			schemaVersion: 5, revision: 0,
		},
	}

	insertInvalidSession := `
		INSERT INTO game_sessions (
			ruleset_release_id, rules_artifact_hash, created_by_user_id,
			authority_mode, current_snapshot, snapshot_canonical_bytes,
			snapshot_schema_version, serializer_version, revision, state_hash
		) VALUES (
			$1, $2, $3, 'local', $4::text::jsonb, convert_to($4::text, 'UTF8'),
			$5, 'test', $6, $2
		)
	`
	updateV5Session := `
		UPDATE game_sessions
		SET current_snapshot = $1::text::jsonb,
			snapshot_canonical_bytes = convert_to($1::text, 'UTF8'),
			snapshot_schema_version = $2,
			revision = $3
		WHERE id = $4
	`
	for index, invalidCase := range invalidCases {
		t.Run(invalidCase.label, func(t *testing.T) {
			var valid bool
			if invalidCase.checkReleaseBinding {
				err = db.QueryRow(`
					SELECT canonical_world_state_release_binding_is_valid(
						$1::text::jsonb, $2, $3
					)
				`, invalidCase.snapshot, releaseID, digest).Scan(&valid)
			} else {
				err = db.QueryRow(`
					SELECT canonical_world_state_v5_is_valid(
						$1::text::jsonb, $2, $3
					)
				`, invalidCase.snapshot, invalidCase.schemaVersion, invalidCase.revision).Scan(&valid)
			}
			if err != nil {
				t.Fatalf("direct validator failed: %v", err)
			}
			if valid {
				t.Error("invalid snapshot accepted by direct validator")
			}

			if _, insertErr := db.Exec(
				insertInvalidSession,
				releaseID, digest, userID, invalidCase.snapshot,
				invalidCase.schemaVersion, invalidCase.revision,
			); insertErr == nil {
				t.Error("invalid snapshot persisted in game_sessions")
			}
			if _, updateErr := db.Exec(
				updateV5Session,
				invalidCase.snapshot, invalidCase.schemaVersion,
				invalidCase.revision, v5SessionID,
			); updateErr == nil {
				t.Error("invalid snapshot updated into game_sessions")
			}
			if _, historyErr := db.Exec(
				insertV5Snapshot,
				v5SessionID, index+1, invalidCase.revision, releaseID, digest,
				invalidCase.schemaVersion, invalidCase.snapshot, digest,
			); historyErr == nil {
				t.Error("invalid snapshot persisted in session_snapshots")
			}
		})
	}

	var persistedSnapshot string
	var persistedSchema int
	var persistedRevision int64
	if err = db.QueryRow(`
		SELECT current_snapshot::text, snapshot_schema_version, revision
		FROM game_sessions
		WHERE id = $1
	`, v5SessionID).Scan(&persistedSnapshot, &persistedSchema, &persistedRevision); err != nil {
		t.Fatalf("read live v5 state after rejected updates: %v", err)
	}
	if persistedSchema != 5 || persistedRevision != 0 {
		t.Fatalf(
			"rejected updates changed relational envelope: schema=%d revision=%d",
			persistedSchema, persistedRevision,
		)
	}
	if err = db.QueryRow(`
		SELECT canonical_world_state_v5_is_valid($1::text::jsonb, 5, 0)
	`, persistedSnapshot).Scan(&directValid); err != nil || !directValid {
		t.Fatalf("live state poisoned by rejected updates: valid=%v err=%v", directValid, err)
	}

	var releaseTriggerCount int
	if err = db.QueryRow(`
		SELECT count(*)
		FROM pg_trigger
		WHERE NOT tgisinternal
			AND tgname IN (
				'game_sessions_world_release_binding_v5',
				'session_snapshots_world_release_binding_v5'
			)
			AND tgrelid IN ('game_sessions'::regclass, 'session_snapshots'::regclass)
	`).Scan(&releaseTriggerCount); err != nil {
		t.Fatalf("inspect release-binding triggers: %v", err)
	}
	if releaseTriggerCount != 2 {
		t.Errorf("release-binding trigger count = %d, want 2", releaseTriggerCount)
	}

	t.Logf("validated %d adversarial v5 mutations across direct/live/update/history paths", len(invalidCases))
}
