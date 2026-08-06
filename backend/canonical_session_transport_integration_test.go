package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	backendmigrations "dnd-cards-backend/migrations"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type canonicalTransportFixture struct {
	db                 *gorm.DB
	controller         *CanonicalSessionController
	sessionID          uuid.UUID
	releaseID          uuid.UUID
	artifactHash       string
	ownerID            uuid.UUID
	targetOwnerID      uuid.UUID
	targetControllerID uuid.UUID
	outsiderID         uuid.UUID
	sourceActorID      uuid.UUID
	targetActorID      uuid.UUID
	sourceCharacterID  uuid.UUID
	targetCharacterID  uuid.UUID
	baseWorld          map[string]any
	baseHash           string
}

func openCanonicalTransportFixture(t *testing.T) canonicalTransportFixture {
	return openCanonicalTransportFixtureWithAccess(t, false, false)
}

func openCanonicalTransportFixtureWithAccess(t *testing.T, sameOwner bool, ownerCanControlUnowned bool) canonicalTransportFixture {
	t.Helper()
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if strings.TrimSpace(dsn) == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = admin.Ping(); err != nil {
		_ = admin.Close()
		t.Fatalf("ping PostgreSQL integration database: %v", err)
	}
	schema := "canonical_transport_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec("CREATE SCHEMA " + schema); err != nil {
		_ = admin.Close()
		t.Fatalf("create isolated canonical transport schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec("DROP SCHEMA IF EXISTS " + schema + " CASCADE")
		_ = admin.Close()
	})

	isolatedDSN := canonicalTransportSchemaDSN(t, dsn, schema)
	sqlDB, err := sql.Open("pgx", isolatedDSN)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if _, err = sqlDB.Exec(`
		CREATE EXTENSION IF NOT EXISTS pgcrypto;
		CREATE TABLE users (id UUID PRIMARY KEY);
		CREATE TABLE characters_v3 (id UUID PRIMARY KEY);
	`); err != nil {
		t.Fatalf("bootstrap canonical runtime legacy boundary: %v", err)
	}
	for _, version := range []string{
		"090_create_canonical_runtime",
		"091_add_attack_runtime_v4",
		"092_add_world_runtime_v5",
		"094_harden_canonical_transport",
	} {
		found := false
		for _, migration := range backendmigrations.GetAllMigrations() {
			if migration.Version != version {
				continue
			}
			found = true
			if err = migration.Up(sqlDB); err != nil {
				t.Fatalf("run %s in isolated schema: %v", version, err)
			}
			break
		}
		if !found {
			t.Fatalf("canonical runtime migration %s is not registered", version)
		}
	}
	db, err := gorm.Open(postgres.Open(isolatedDSN), &gorm.Config{
		DisableAutomaticPing: true,
		PrepareStmt:          false,
	})
	if err != nil {
		t.Fatal(err)
	}

	fixture := canonicalTransportFixture{
		db: db, controller: NewCanonicalSessionController(db),
		sessionID: uuid.New(), releaseID: uuid.New(),
		ownerID: uuid.New(), targetOwnerID: uuid.New(), outsiderID: uuid.New(),
		sourceActorID: uuid.New(), targetActorID: uuid.New(),
		sourceCharacterID: uuid.New(), targetCharacterID: uuid.New(),
	}
	fixture.targetControllerID = fixture.targetOwnerID
	if sameOwner {
		fixture.targetControllerID = fixture.ownerID
	}
	if err = db.Exec(`INSERT INTO users (id) VALUES (?), (?), (?)`, fixture.ownerID, fixture.targetOwnerID, fixture.outsiderID).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`INSERT INTO characters_v3 (id) VALUES (?), (?)`, fixture.sourceCharacterID, fixture.targetCharacterID).Error; err != nil {
		t.Fatal(err)
	}
	contentHash := "sha256:" + strings.Repeat("a", 64)
	artifactHash := "sha256:" + strings.Repeat("b", 64)
	fixture.artifactHash = artifactHash
	manifestHash := "sha256:" + strings.Repeat("c", 64)
	manifestCanonical := []byte(`{}`)
	if err = db.Exec(`
		INSERT INTO ruleset_releases (
			id, system_id, ruleset_version, errata_version,
			manifest_schema_version, protocol_schema_version, artifact_version,
			serializer_version, rules_artifact_hash, content_hash, manifest_hash,
			manifest, manifest_canonical_bytes, status, released_at
		) VALUES (?, 'dnd5e-2024', '2024', 'test-errata', 1, 1, 'test-release',
			'rules-core-canonical-json-v1', ?, ?, ?, '{}'::jsonb, ?, 'active', NOW())
	`, fixture.releaseID, artifactHash, contentHash, manifestHash, manifestCanonical).Error; err != nil {
		t.Fatal(err)
	}
	fixture.baseWorld = canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 0, 10, nil, nil,
	)
	baseCanonical := canonicalTransportCanonical(t, fixture.baseWorld)
	fixture.baseHash = canonicalSHA256(baseCanonical)
	if err = db.Exec(`
		INSERT INTO game_sessions (
			id, ruleset_release_id, rules_artifact_hash, created_by_user_id,
			mode, authority_mode, status, current_snapshot,
			snapshot_canonical_bytes, snapshot_schema_version, serializer_version,
			snapshot_seq, revision, state_hash
		) VALUES (?, ?, ?, ?, 'exploration', 'local', 'active', ?::jsonb, ?, 5,
			'rules-core-canonical-json-v1', 0, 0, ?)
	`, fixture.sessionID, fixture.releaseID, artifactHash, fixture.ownerID,
		string(baseCanonical), baseCanonical, fixture.baseHash).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`
		INSERT INTO game_session_members (
			id, session_id, user_id, role, status, can_control_unowned_actors
		) VALUES (?, ?, ?, 'owner', 'active', ?), (?, ?, ?, 'player', 'active', FALSE)
	`, uuid.New(), fixture.sessionID, fixture.ownerID,
		ownerCanControlUnowned, uuid.New(), fixture.sessionID, fixture.targetOwnerID).Error; err != nil {
		t.Fatal(err)
	}
	sourceProjection := canonicalTransportCanonical(t, fixture.baseWorld["actors"].(map[string]any)["actor:source"])
	targetProjection := canonicalTransportCanonical(t, fixture.baseWorld["actors"].(map[string]any)["actor:target"])
	buildCanonical := []byte(`{}`)
	buildHash := canonicalSHA256(buildCanonical)
	if err = db.Exec(`
		INSERT INTO game_session_actors (
			id, session_id, ruleset_release_id, rules_artifact_hash,
			character_id, owner_user_id, controller_user_id, actor_kind,
			lifecycle_status, build_snapshot, build_canonical_bytes, build_hash,
			state_projection, state_hash, projection_schema_version, projection_seq
		) VALUES
			(?, ?, ?, ?, ?, ?, ?, 'player_character', 'active', '{}'::jsonb, ?, ?, ?::jsonb, ?, 5, 0),
			(?, ?, ?, ?, ?, ?, ?, 'player_character', 'active', '{}'::jsonb, ?, ?, ?::jsonb, ?, 5, 0)
	`, fixture.sourceActorID, fixture.sessionID, fixture.releaseID, artifactHash,
		fixture.sourceCharacterID, fixture.ownerID, fixture.ownerID,
		buildCanonical, buildHash, string(sourceProjection), canonicalSHA256(sourceProjection),
		fixture.targetActorID, fixture.sessionID, fixture.releaseID, artifactHash,
		fixture.targetCharacterID, fixture.targetControllerID, fixture.targetControllerID,
		buildCanonical, buildHash, string(targetProjection), canonicalSHA256(targetProjection)).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`
		INSERT INTO session_snapshots (
			id, session_id, seq, revision, ruleset_release_id,
			rules_artifact_hash, snapshot_schema_version, serializer_version,
			snapshot, canonical_bytes, state_hash, last_event_hash
		) VALUES (?, ?, 0, 0, ?, ?, 5, 'rules-core-canonical-json-v1',
			?::jsonb, ?, ?, NULL)
	`, uuid.New(), fixture.sessionID, fixture.releaseID, artifactHash,
		string(baseCanonical), baseCanonical, fixture.baseHash).Error; err != nil {
		t.Fatal(err)
	}
	return fixture
}

func canonicalTransportSchemaDSN(t *testing.T, dsn, schema string) string {
	t.Helper()
	trimmed := strings.TrimSpace(dsn)
	if strings.HasPrefix(trimmed, "postgres://") || strings.HasPrefix(trimmed, "postgresql://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return trimmed + " search_path=" + schema
}

func canonicalTransportActor(id, name, kind, controllerID string, hp int) map[string]any {
	return map[string]any{
		"id": id, "name": name, "kind": kind, "controllerId": controllerID,
		"capabilities": map[string]any{"actionIds": []any{}},
		"character": map[string]any{
			"abilityMods": map[string]any{"str": 0, "dex": 0, "con": 0, "int": 0, "wis": 0, "cha": 0},
			"profBonus":   2, "level": 1,
		},
		"runtime": map[string]any{
			"hp":        map[string]any{"current": hp, "max": 10, "temp": 0},
			"resources": map[string]any{}, "maxResources": map[string]any{},
			"equipment": map[string]any{}, "inventory": []any{}, "activeEffects": []any{},
		},
		"lifecycle": map[string]any{"status": "alive"},
		"attackProfile": map[string]any{
			"attacksPerAction": 1, "size": 2, "reachFt": 5,
			"graspingParts":   []any{"main_hand"},
			"sourceEntityIds": []any{"system:dnd5e-2024:attack-action"},
		},
	}
}

func canonicalTransportWorld(
	sourceController uuid.UUID,
	targetController uuid.UUID,
	contentHash string,
	revision int,
	targetHP int,
	processed []any,
	pending any,
) map[string]any {
	if processed == nil {
		processed = []any{}
	}
	return map[string]any{
		"schemaVersion": 5,
		"id":            "world:two-owner-transport",
		"ruleset": map[string]any{
			"systemId": "dnd5e-2024", "releaseId": "test-release",
			"contentHash": contentHash, "errataVersion": "test-errata",
		},
		"revision": revision, "logicalClock": revision,
		"actors": map[string]any{
			"actor:source": canonicalTransportActor("actor:source", "Source Hero", "playerCharacter", sourceController.String(), 10),
			"actor:target": canonicalTransportActor("actor:target", "Target Hero", "playerCharacter", targetController.String(), targetHP),
		},
		"objects": map[string]any{}, "scene": map[string]any{"mode": "exploration"},
		"processedCommandIds": processed, "pendingResolution": pending,
		"concentrations": map[string]any{}, "attackActions": map[string]any{}, "grapples": map[string]any{},
	}
}

func canonicalTransportCanonical(t *testing.T, value any) []byte {
	t.Helper()
	canonical, err := canonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func (fixture canonicalTransportFixture) transitionBody(
	t *testing.T,
	commandID uuid.UUID,
	world map[string]any,
	expectedRevision int64,
	baseSnapshotSeq int64,
	baseHash string,
	decision *canonicalDecisionMetadata,
	eventMetadata map[string]any,
) []byte {
	return fixture.transitionBodyForActors(
		t, commandID, world, fixture.sourceActorID, []uuid.UUID{fixture.targetActorID},
		expectedRevision, baseSnapshotSeq, baseHash, decision, eventMetadata,
	)
}

func (fixture canonicalTransportFixture) transitionBodyForActors(
	t *testing.T,
	commandID uuid.UUID,
	world map[string]any,
	sourceActorID uuid.UUID,
	targetActorIDs []uuid.UUID,
	expectedRevision int64,
	baseSnapshotSeq int64,
	baseHash string,
	decision *canonicalDecisionMetadata,
	eventMetadata map[string]any,
) []byte {
	t.Helper()
	snapshot := canonicalTransportCanonical(t, world)
	request := map[string]any{
		"commandId": commandID, "semanticCommandId": commandID.String(),
		"rulesetReleaseId": fixture.releaseID, "rulesArtifactHash": fixture.artifactHash,
		"sourceActorId":    sourceActorID,
		"targetActorIds":   targetActorIDs,
		"expectedRevision": expectedRevision, "baseSnapshotSeq": baseSnapshotSeq,
		"baseStateHash": baseHash, "snapshotSchemaVersion": 5,
		"serializerVersion": "rules-core-canonical-json-v1",
		"stateHash":         canonicalSHA256(snapshot), "snapshot": json.RawMessage(snapshot),
		"actorBindings": []canonicalActorBinding{
			{ActorID: fixture.sourceActorID, WorldActorID: "actor:source"},
			{ActorID: fixture.targetActorID, WorldActorID: "actor:target"},
		},
		"eventMetadata": eventMetadata,
	}
	if decision != nil {
		request["decision"] = decision
	}
	return canonicalMustJSON(t, request)
}

func (fixture canonicalTransportFixture) applyAs(t *testing.T, userID uuid.UUID, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/transport/canonical-sessions/"+fixture.sessionID.String()+"/transitions",
		bytes.NewReader(body),
	)
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "id", Value: fixture.sessionID.String()}}
	context.Set("user_id", userID)
	fixture.controller.ApplyTransition(context)
	return recorder
}

func (fixture canonicalTransportFixture) count(t *testing.T, table string) int64 {
	t.Helper()
	allowed := map[string]bool{
		"game_commands": true, "command_execution_jobs": true, "game_events": true,
		"session_snapshots": true, "decision_requests": true,
	}
	if !allowed[table] {
		t.Fatalf("unexpected count table %q", table)
	}
	var count int64
	if err := fixture.db.Raw("SELECT count(*) FROM "+table+" WHERE session_id = ?", fixture.sessionID).Scan(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}

func TestCanonicalTransportAtomicCASDecisionHandoffIdempotencyAndRollback(t *testing.T) {
	fixture := openCanonicalTransportFixture(t)
	contentHash := fixture.baseWorld["ruleset"].(map[string]any)["contentHash"].(string)

	invalidCommandID := uuid.New()
	invalidWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 10,
		[]any{invalidCommandID.String()}, nil,
	)
	invalidWorld["actors"].(map[string]any)["actor:source"].(map[string]any)["runtime"].(map[string]any)["hp"].(map[string]any)["max"] = 0
	invalidResponse := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, invalidCommandID, invalidWorld, 0, 0, fixture.baseHash, nil,
		map[string]any{"case": "schema-preflight-rollback"},
	))
	if invalidResponse.Code != http.StatusUnprocessableEntity {
		t.Fatalf("schema-invalid transition status = %d body=%s", invalidResponse.Code, invalidResponse.Body.String())
	}
	for _, table := range []string{"game_commands", "command_execution_jobs", "game_events", "decision_requests"} {
		if count := fixture.count(t, table); count != 0 {
			t.Fatalf("%s count after schema preflight rejection = %d", table, count)
		}
	}
	if count := fixture.count(t, "session_snapshots"); count != 1 {
		t.Fatalf("snapshot history count after schema preflight rejection = %d", count)
	}
	var revision int64
	if err := fixture.db.Raw(`SELECT revision FROM game_sessions WHERE id = ?`, fixture.sessionID).Scan(&revision).Error; err != nil || revision != 0 {
		t.Fatalf("session revision after rollback = %d, err=%v", revision, err)
	}

	wrongReleaseCommandID := uuid.New()
	wrongReleaseWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 10,
		[]any{wrongReleaseCommandID.String()}, nil,
	)
	var wrongReleaseBody map[string]any
	if err := json.Unmarshal(fixture.transitionBody(
		t, wrongReleaseCommandID, wrongReleaseWorld, 0, 0, fixture.baseHash, nil, map[string]any{},
	), &wrongReleaseBody); err != nil {
		t.Fatal(err)
	}
	wrongReleaseBody["rulesetReleaseId"] = uuid.NewString()
	wrongRelease := fixture.applyAs(t, fixture.ownerID, canonicalMustJSON(t, wrongReleaseBody))
	if wrongRelease.Code != http.StatusConflict {
		t.Fatalf("wrong release envelope status = %d body=%s", wrongRelease.Code, wrongRelease.Body.String())
	}
	if fixture.count(t, "game_commands") != 0 || fixture.count(t, "game_events") != 0 {
		t.Fatal("wrong release envelope persisted durable rows")
	}

	maliciousCommandID := uuid.New()
	maliciousWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 1,
		[]any{maliciousCommandID.String()}, nil,
	)
	malicious := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, maliciousCommandID, maliciousWorld, 0, 0, fixture.baseHash, nil,
		map[string]any{"case": "foreign-hp-rewrite"},
	))
	if malicious.Code != http.StatusForbidden {
		t.Fatalf("foreign HP rewrite status = %d body=%s", malicious.Code, malicious.Body.String())
	}
	for _, table := range []string{"game_commands", "command_execution_jobs", "game_events", "decision_requests"} {
		if count := fixture.count(t, table); count != 0 {
			t.Fatalf("foreign actor rewrite persisted %s row", table)
		}
	}

	commandID := uuid.New()
	requestID := "decision:target-save:request:1"
	resolutionID := "decision:target-save:resolution:1"
	pending := map[string]any{
		"id": resolutionID, "type": "target_save",
		"sourceActorId": "actor:source", "targetActorId": "actor:target",
		"request": map[string]any{
			"id": requestID, "type": "saving_throw", "actorId": "actor:target",
			"ability": "dex", "dc": 12, "avoidsConditions": []any{},
		},
	}
	world := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 10,
		[]any{commandID.String()}, pending,
	)
	decision := &canonicalDecisionMetadata{
		RequestID: requestID, ResolutionID: resolutionID,
		DecidingActorID: fixture.targetActorID, RequestSchemaVersion: 1,
	}
	forgedDecision := *decision
	forgedDecision.RequestID = "decision:forged:request"
	forgedCommandID := uuid.New()
	forgedWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 10,
		[]any{forgedCommandID.String()}, pending,
	)
	forged := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, forgedCommandID, forgedWorld, 0, 0, fixture.baseHash, &forgedDecision,
		map[string]any{"case": "forged-decision-identity"},
	))
	if forged.Code != http.StatusUnprocessableEntity {
		t.Fatalf("forged decision identity status = %d body=%s", forged.Code, forged.Body.String())
	}
	if fixture.count(t, "game_commands") != 0 {
		t.Fatal("forged decision identity left a command receipt")
	}

	body := fixture.transitionBody(
		t, commandID, world, 0, 0, fixture.baseHash, decision,
		map[string]any{"scenario": "two-owner-save"},
	)
	committed := fixture.applyAs(t, fixture.ownerID, body)
	if committed.Code != http.StatusOK {
		t.Fatalf("valid pending-decision handoff status = %d body=%s", committed.Code, committed.Body.String())
	}
	var first canonicalTransitionResponse
	if err := json.Unmarshal(committed.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.SemanticAuthority != canonicalTransportAuthority || first.SchemaValidation != canonicalTransportSchemaValidation ||
		first.RulesetReleaseID != fixture.releaseID || first.RulesArtifactHash != fixture.artifactHash ||
		first.SerializerVersion != "rules-core-canonical-json-v1" ||
		first.SemanticCommandID != commandID.String() || !first.Idempotent || first.Revision != 1 ||
		first.Decision == nil || first.Decision.RequestID != requestID {
		t.Fatalf("unexpected committed response: %#v", first)
	}
	for table, want := range map[string]int64{
		"game_commands": 1, "command_execution_jobs": 1, "game_events": 1,
		"session_snapshots": 2, "decision_requests": 1,
	} {
		if count := fixture.count(t, table); count != want {
			t.Fatalf("%s count = %d, want %d", table, count, want)
		}
	}
	var persistedEnvelope struct {
		SemanticCommandID         string `gorm:"column:semantic_command_id"`
		ExecutionSemanticID       string `gorm:"column:execution_semantic_id"`
		ExecutionReleaseID        string `gorm:"column:execution_release_id"`
		ExecutionArtifactHash     string `gorm:"column:execution_artifact_hash"`
		ExecutionSerializer       string `gorm:"column:execution_serializer"`
		ExecutionSchemaValidation string `gorm:"column:execution_schema_validation"`
		EventSemanticID           string `gorm:"column:event_semantic_id"`
		EventReleaseID            string `gorm:"column:event_release_id"`
		EventArtifactHash         string `gorm:"column:event_artifact_hash"`
	}
	if err := fixture.db.Raw(`
		SELECT command.semantic_command_id,
			command.execution_input->>'semanticCommandId' AS execution_semantic_id,
			command.execution_input->>'rulesetReleaseId' AS execution_release_id,
			command.execution_input->>'rulesArtifactHash' AS execution_artifact_hash,
			command.execution_input->>'serializerVersion' AS execution_serializer,
			command.execution_input->>'schemaValidation' AS execution_schema_validation,
			event.payload->>'semanticCommandId' AS event_semantic_id,
			event.payload->>'rulesetReleaseId' AS event_release_id,
			event.payload->>'rulesArtifactHash' AS event_artifact_hash
		FROM game_commands AS command
		JOIN game_events AS event
			ON event.session_id = command.session_id AND event.command_id = command.command_id
		WHERE command.session_id = ? AND command.command_id = ?
	`, fixture.sessionID, commandID).Scan(&persistedEnvelope).Error; err != nil {
		t.Fatal(err)
	}
	if persistedEnvelope.SemanticCommandID != commandID.String() ||
		persistedEnvelope.ExecutionSemanticID != commandID.String() ||
		persistedEnvelope.EventSemanticID != commandID.String() ||
		persistedEnvelope.ExecutionReleaseID != fixture.releaseID.String() ||
		persistedEnvelope.EventReleaseID != fixture.releaseID.String() ||
		persistedEnvelope.ExecutionArtifactHash != fixture.artifactHash ||
		persistedEnvelope.EventArtifactHash != fixture.artifactHash ||
		persistedEnvelope.ExecutionSerializer != "rules-core-canonical-json-v1" ||
		persistedEnvelope.ExecutionSchemaValidation != canonicalTransportSchemaValidation {
		t.Fatalf("persisted event/execution envelope is incomplete: %#v", persistedEnvelope)
	}
	var stored struct {
		Revision int64           `gorm:"column:revision"`
		Seq      int64           `gorm:"column:snapshot_seq"`
		Snapshot json.RawMessage `gorm:"column:current_snapshot"`
	}
	if err := fixture.db.Raw(`SELECT revision, snapshot_seq, current_snapshot FROM game_sessions WHERE id = ?`, fixture.sessionID).Scan(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Revision != 1 || stored.Seq != 1 {
		t.Fatalf("stored CAS head = revision %d seq %d", stored.Revision, stored.Seq)
	}
	var targetProjectionRow struct {
		StateProjection json.RawMessage `gorm:"column:state_projection"`
	}
	if err := fixture.db.Raw(`SELECT state_projection FROM game_session_actors WHERE id = ?`, fixture.targetActorID).Scan(&targetProjectionRow).Error; err != nil {
		t.Fatal(err)
	}
	var targetProjection map[string]any
	if err := json.Unmarshal(targetProjectionRow.StateProjection, &targetProjection); err != nil {
		t.Fatal(err)
	}
	targetHP := targetProjection["runtime"].(map[string]any)["hp"].(map[string]any)["current"].(float64)
	if targetHP != 10 {
		t.Fatalf("opening a foreign decision mutated target HP to %v", targetHP)
	}
	var characterCount int64
	if err := fixture.db.Raw(`SELECT count(*) FROM characters_v3`).Scan(&characterCount).Error; err != nil || characterCount != 2 {
		t.Fatalf("CharacterV3 rows changed: count=%d err=%v", characterCount, err)
	}

	replayed := fixture.applyAs(t, fixture.ownerID, body)
	if replayed.Code != http.StatusOK {
		t.Fatalf("idempotent replay status = %d body=%s", replayed.Code, replayed.Body.String())
	}
	var replay canonicalTransitionResponse
	if err := json.Unmarshal(replayed.Body.Bytes(), &replay); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(replay, first) {
		t.Fatalf("idempotent response mismatch: first=%#v replay=%#v", first, replay)
	}
	for table, want := range map[string]int64{
		"game_commands": 1, "command_execution_jobs": 1, "game_events": 1,
		"session_snapshots": 2, "decision_requests": 1,
	} {
		if count := fixture.count(t, table); count != want {
			t.Fatalf("idempotent replay duplicated %s: %d", table, count)
		}
	}

	differentBody := fixture.transitionBody(
		t, commandID, world, 0, 0, fixture.baseHash, decision,
		map[string]any{"scenario": "same-command-different-input"},
	)
	conflict := fixture.applyAs(t, fixture.ownerID, differentBody)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("same command/different hash status = %d body=%s", conflict.Code, conflict.Body.String())
	}
	staleCommandID := uuid.New()
	staleWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 10,
		[]any{staleCommandID.String()}, nil,
	)
	stale := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, staleCommandID, staleWorld, 0, 0, fixture.baseHash, nil, map[string]any{},
	))
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale CAS status = %d body=%s", stale.Code, stale.Body.String())
	}
	wrongController := fixture.applyAs(t, fixture.targetOwnerID, differentBody)
	if wrongController.Code != http.StatusConflict {
		t.Fatalf("foreign caller reusing an immutable command receipt status = %d", wrongController.Code)
	}

	unauthorizedResolveID := uuid.New()
	unauthorizedResolvedWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 2, 10,
		[]any{commandID.String(), unauthorizedResolveID.String()}, nil,
	)
	unauthorizedResolve := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, unauthorizedResolveID, unauthorizedResolvedWorld, 1, 1, first.StateHash, nil,
		map[string]any{"case": "wrong-decision-controller"},
	))
	if unauthorizedResolve.Code != http.StatusForbidden {
		t.Fatalf("unassigned decision resolution status = %d body=%s", unauthorizedResolve.Code, unauthorizedResolve.Body.String())
	}
	if fixture.count(t, "game_commands") != 1 || fixture.count(t, "game_events") != 1 {
		t.Fatal("unauthorized decision resolution was not fully rolled back")
	}

	resolveCommandID := uuid.New()
	resolvedWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 2, 7,
		[]any{commandID.String(), resolveCommandID.String()}, nil,
	)
	resolveBody := fixture.transitionBodyForActors(
		t, resolveCommandID, resolvedWorld, fixture.targetActorID, nil,
		1, 1, first.StateHash, nil, map[string]any{"scenario": "assigned-controller-resolves"},
	)
	resolved := fixture.applyAs(t, fixture.targetControllerID, resolveBody)
	if resolved.Code != http.StatusOK {
		t.Fatalf("assigned target controller resolution status = %d body=%s", resolved.Code, resolved.Body.String())
	}
	var resolvedResponse canonicalTransitionResponse
	if err := json.Unmarshal(resolved.Body.Bytes(), &resolvedResponse); err != nil {
		t.Fatal(err)
	}
	if resolvedResponse.Decision == nil || resolvedResponse.Decision.Status != "resolved" || resolvedResponse.Decision.RequestID != requestID {
		t.Fatalf("unexpected decision resolution response: %#v", resolvedResponse)
	}
	if fixture.count(t, "game_commands") != 2 || fixture.count(t, "game_events") != 2 || fixture.count(t, "session_snapshots") != 3 {
		t.Fatal("assigned decision resolution did not commit exactly one transition")
	}
	var decisionStatus string
	if err := fixture.db.Raw(`
		SELECT status FROM decision_requests WHERE session_id = ? AND request_id = ?
	`, fixture.sessionID, requestID).Scan(&decisionStatus).Error; err != nil || decisionStatus != "resolved" {
		t.Fatalf("decision status = %q err=%v", decisionStatus, err)
	}
	if err := fixture.db.Raw(`SELECT state_projection FROM game_session_actors WHERE id = ?`, fixture.targetActorID).Scan(&targetProjectionRow).Error; err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(targetProjectionRow.StateProjection, &targetProjection); err != nil {
		t.Fatal(err)
	}
	targetHP = targetProjection["runtime"].(map[string]any)["hp"].(map[string]any)["current"].(float64)
	if targetHP != 7 {
		t.Fatalf("assigned target controller HP projection = %v", targetHP)
	}

	// A resolution identity is a durable semantic identity, not merely the ID
	// of the currently-open row. Reusing it after resolution must roll back the
	// whole attempted transition.
	reusedResolutionCommandID := uuid.New()
	reusedRequestID := "decision:target-save:request:2"
	reusedPending := map[string]any{
		"id": resolutionID, "type": "target_save",
		"sourceActorId": "actor:source", "targetActorId": "actor:target",
		"request": map[string]any{
			"id": reusedRequestID, "type": "saving_throw", "actorId": "actor:target",
			"ability": "dex", "dc": 12, "avoidsConditions": []any{},
		},
	}
	reusedWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 3, 7,
		[]any{commandID.String(), resolveCommandID.String(), reusedResolutionCommandID.String()}, reusedPending,
	)
	reusedDecision := &canonicalDecisionMetadata{
		RequestID: reusedRequestID, ResolutionID: resolutionID,
		DecidingActorID: fixture.targetActorID, RequestSchemaVersion: 1,
	}
	reused := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, reusedResolutionCommandID, reusedWorld, 2, 2, resolvedResponse.StateHash,
		reusedDecision, map[string]any{"case": "reused-resolution-identity"},
	))
	if reused.Code != http.StatusConflict {
		t.Fatalf("reused decision resolution status = %d body=%s", reused.Code, reused.Body.String())
	}
	if fixture.count(t, "game_commands") != 2 || fixture.count(t, "game_events") != 2 ||
		fixture.count(t, "session_snapshots") != 3 || fixture.count(t, "decision_requests") != 1 {
		t.Fatal("reused resolution identity was not atomically rolled back")
	}

	if err := fixture.db.Exec(`
		UPDATE game_session_members SET status = 'revoked', ended_at = ?
		WHERE session_id = ? AND user_id = ?
	`, time.Now().UTC(), fixture.sessionID, fixture.targetOwnerID).Error; err != nil {
		t.Fatal(err)
	}
	revokedCommandID := uuid.New()
	revokedWorld := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 3, 7,
		[]any{commandID.String(), resolveCommandID.String(), revokedCommandID.String()}, nil,
	)
	revokedTarget := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
		t, revokedCommandID, revokedWorld, 2, 2, resolvedResponse.StateHash, nil,
		map[string]any{"case": "revoked-target-controller"},
	))
	if revokedTarget.Code != http.StatusForbidden {
		t.Fatalf("revoked target owner status = %d body=%s", revokedTarget.Code, revokedTarget.Body.String())
	}
}

func TestCanonicalTransportGetRequiresMembershipAndReturnsCoherentSnapshot(t *testing.T) {
	fixture := openCanonicalTransportFixture(t)
	gin.SetMode(gin.TestMode)
	readAs := func(userID uuid.UUID) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(
			http.MethodGet,
			fmt.Sprintf("/api/transport/canonical-sessions/%s", fixture.sessionID), nil,
		)
		context.Params = gin.Params{{Key: "id", Value: fixture.sessionID.String()}}
		context.Set("user_id", userID)
		fixture.controller.GetCurrent(context)
		return recorder
	}
	outsider := readAs(fixture.outsiderID)
	if outsider.Code != http.StatusForbidden {
		t.Fatalf("outsider GET status = %d", outsider.Code)
	}
	member := readAs(fixture.targetOwnerID)
	if member.Code != http.StatusOK {
		t.Fatalf("member GET status = %d body=%s", member.Code, member.Body.String())
	}
	var response canonicalSessionReadResponse
	if err := json.Unmarshal(member.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.SemanticAuthority != canonicalTransportAuthority || response.SchemaValidation != canonicalTransportSchemaValidation ||
		response.RulesetReleaseID != fixture.releaseID || response.RulesArtifactHash != fixture.artifactHash ||
		response.StateHash != fixture.baseHash || len(response.ActorBindings) != 2 {
		t.Fatalf("unexpected canonical read response: %#v", response)
	}
	_, canonical, err := canonicalizeRawJSON(response.Snapshot)
	if err != nil || canonicalSHA256(canonical) != response.StateHash {
		t.Fatalf("GET snapshot hash integrity failed: %v", err)
	}
}

func TestCanonicalTransportAllowsOnlyOwnedOrExplicitGMActorMutation(t *testing.T) {
	for _, test := range []struct {
		name                   string
		sameOwner              bool
		ownerCanControlUnowned bool
	}{
		{name: "same owner controls both characters", sameOwner: true},
		{name: "explicit GM capability", ownerCanControlUnowned: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := openCanonicalTransportFixtureWithAccess(t, test.sameOwner, test.ownerCanControlUnowned)
			contentHash := fixture.baseWorld["ruleset"].(map[string]any)["contentHash"].(string)
			commandID := uuid.New()
			world := canonicalTransportWorld(
				fixture.ownerID, fixture.targetControllerID, contentHash, 1, 8,
				[]any{commandID.String()}, nil,
			)
			response := fixture.applyAs(t, fixture.ownerID, fixture.transitionBody(
				t, commandID, world, 0, 0, fixture.baseHash, nil,
				map[string]any{"authorizationCase": test.name},
			))
			if response.Code != http.StatusOK {
				t.Fatalf("authorized actor mutation status = %d body=%s", response.Code, response.Body.String())
			}
			if fixture.count(t, "game_commands") != 1 || fixture.count(t, "game_events") != 1 {
				t.Fatal("authorized actor mutation did not commit exactly once")
			}
		})
	}
}

func TestCanonicalTransportExactReplaySurvivesFreezeAuthorityAndControlChange(t *testing.T) {
	fixture := openCanonicalTransportFixtureWithAccess(t, true, false)
	contentHash := fixture.baseWorld["ruleset"].(map[string]any)["contentHash"].(string)
	commandID := uuid.New()
	semanticCommandID := "rules-core:command:attack:source:turn-1"
	world := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 8,
		[]any{semanticCommandID}, nil,
	)
	bodyObject := map[string]any{}
	if err := json.Unmarshal(fixture.transitionBody(
		t, commandID, world, 0, 0, fixture.baseHash, nil,
		map[string]any{"case": "immutable-replay"},
	), &bodyObject); err != nil {
		t.Fatal(err)
	}
	bodyObject["semanticCommandId"] = semanticCommandID
	body := canonicalMustJSON(t, bodyObject)

	committed := fixture.applyAs(t, fixture.ownerID, body)
	if committed.Code != http.StatusOK {
		t.Fatalf("initial transition status = %d body=%s", committed.Code, committed.Body.String())
	}
	var first canonicalTransitionResponse
	if err := json.Unmarshal(committed.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.SemanticCommandID != semanticCommandID {
		t.Fatalf("semantic command id = %q", first.SemanticCommandID)
	}

	if err := fixture.db.Exec(`
		UPDATE game_sessions SET status = 'frozen', authority_mode = 'server' WHERE id = ?
	`, fixture.sessionID).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Exec(`
		UPDATE game_session_actors SET controller_user_id = ? WHERE id = ?
	`, fixture.targetOwnerID, fixture.sourceActorID).Error; err != nil {
		t.Fatal(err)
	}

	replayed := fixture.applyAs(t, fixture.ownerID, body)
	if replayed.Code != http.StatusOK {
		t.Fatalf("frozen/control-changed exact replay status = %d body=%s", replayed.Code, replayed.Body.String())
	}
	var second canonicalTransitionResponse
	if err := json.Unmarshal(replayed.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("immutable replay changed receipt: first=%#v second=%#v", first, second)
	}
	if fixture.count(t, "game_commands") != 1 || fixture.count(t, "game_events") != 1 || fixture.count(t, "session_snapshots") != 2 {
		t.Fatal("immutable replay created duplicate durable rows")
	}
}

func TestCanonicalTransportMembershipRevokeLinearizesBeforeTransition(t *testing.T) {
	fixture := openCanonicalTransportFixtureWithAccess(t, true, false)
	contentHash := fixture.baseWorld["ruleset"].(map[string]any)["contentHash"].(string)
	commandID := uuid.New()
	world := canonicalTransportWorld(
		fixture.ownerID, fixture.targetControllerID, contentHash, 1, 8,
		[]any{commandID.String()}, nil,
	)
	body := fixture.transitionBody(t, commandID, world, 0, 0, fixture.baseHash, nil, map[string]any{"case": "revoke-linearization"})

	sqlDB, err := fixture.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	revokeTx, err := sqlDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = revokeTx.Rollback() }()
	if _, err = revokeTx.Exec(`
		UPDATE game_session_members SET status = 'revoked', ended_at = NOW()
		WHERE session_id = $1 AND user_id = $2
	`, fixture.sessionID, fixture.ownerID); err != nil {
		t.Fatal(err)
	}

	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- fixture.applyAs(t, fixture.ownerID, body) }()
	select {
	case early := <-result:
		t.Fatalf("transition crossed an uncommitted membership revoke: status=%d body=%s", early.Code, early.Body.String())
	case <-time.After(150 * time.Millisecond):
	}
	if err = revokeTx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-result:
		if response.Code != http.StatusForbidden {
			t.Fatalf("transition after revoke status = %d body=%s", response.Code, response.Body.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("transition did not resume after membership revoke committed")
	}
	if fixture.count(t, "game_commands") != 0 || fixture.count(t, "game_events") != 0 || fixture.count(t, "session_snapshots") != 1 {
		t.Fatal("revoked transition persisted durable rows")
	}
}
