package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

const (
	maxCanonicalTransitionBodyBytes    int64 = 256 << 10
	canonicalTransportCommandType            = "transport.canonical_snapshot.v1"
	canonicalTransportEventType              = "canonical_snapshot_transport_committed"
	canonicalTransportAuthority              = "client_semantics_unverified"
	canonicalTransportSchemaValidation       = "partial_unverified"
	canonicalTransportFencingToken     int64 = 1
	maxCanonicalStableIDBytes                = 128
)

var canonicalTransportSHA256Pattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

type CanonicalSessionController struct {
	db *gorm.DB
}

func NewCanonicalSessionController(db *gorm.DB) *CanonicalSessionController {
	return &CanonicalSessionController{db: db}
}

type canonicalActorBinding struct {
	ActorID      uuid.UUID `json:"actorId"`
	WorldActorID string    `json:"worldActorId"`
}

type canonicalDecisionMetadata struct {
	RequestID            string          `json:"requestId"`
	ResolutionID         string          `json:"resolutionId"`
	DecidingActorID      uuid.UUID       `json:"decidingActorId"`
	RequestSchemaVersion int             `json:"requestSchemaVersion"`
	Deadline             json.RawMessage `json:"deadline,omitempty"`
	DefaultDecision      json.RawMessage `json:"defaultDecision,omitempty"`
}

type canonicalTransitionRequest struct {
	CommandID             uuid.UUID                  `json:"commandId"`
	SemanticCommandID     string                     `json:"semanticCommandId"`
	RulesetReleaseID      uuid.UUID                  `json:"rulesetReleaseId"`
	RulesArtifactHash     string                     `json:"rulesArtifactHash"`
	SourceActorID         uuid.UUID                  `json:"sourceActorId"`
	TargetActorIDs        []uuid.UUID                `json:"targetActorIds"`
	ExpectedRevision      int64                      `json:"expectedRevision"`
	BaseSnapshotSeq       int64                      `json:"baseSnapshotSeq"`
	BaseStateHash         string                     `json:"baseStateHash"`
	SnapshotSchemaVersion int                        `json:"snapshotSchemaVersion"`
	SerializerVersion     string                     `json:"serializerVersion"`
	StateHash             string                     `json:"stateHash"`
	Snapshot              json.RawMessage            `json:"snapshot"`
	ActorBindings         []canonicalActorBinding    `json:"actorBindings"`
	EventMetadata         json.RawMessage            `json:"eventMetadata,omitempty"`
	Decision              *canonicalDecisionMetadata `json:"decision,omitempty"`
}

type canonicalTransitionResponse struct {
	SessionID             uuid.UUID                `json:"sessionId"`
	CommandID             uuid.UUID                `json:"commandId"`
	SemanticCommandID     string                   `json:"semanticCommandId"`
	RulesetReleaseID      uuid.UUID                `json:"rulesetReleaseId"`
	RulesArtifactHash     string                   `json:"rulesArtifactHash"`
	SerializerVersion     string                   `json:"serializerVersion"`
	Revision              int64                    `json:"revision"`
	SnapshotSeq           int64                    `json:"snapshotSeq"`
	StateHash             string                   `json:"stateHash"`
	EventSeq              int64                    `json:"eventSeq"`
	EventHash             string                   `json:"eventHash"`
	ActorProjectionHashes map[string]string        `json:"actorProjectionHashes"`
	Decision              *canonicalDecisionResult `json:"decision,omitempty"`
	SemanticAuthority     string                   `json:"semanticAuthority"`
	SchemaValidation      string                   `json:"schemaValidation"`
	Idempotent            bool                     `json:"idempotent"`
}

type canonicalDecisionResult struct {
	RequestID string `json:"requestId"`
	Status    string `json:"status"`
}

type canonicalSessionReadResponse struct {
	SessionID         uuid.UUID               `json:"sessionId"`
	RulesetReleaseID  uuid.UUID               `json:"rulesetReleaseId"`
	RulesArtifactHash string                  `json:"rulesArtifactHash"`
	Revision          int64                   `json:"revision"`
	SnapshotSeq       int64                   `json:"snapshotSeq"`
	StateHash         string                  `json:"stateHash"`
	SchemaVersion     int                     `json:"snapshotSchemaVersion"`
	SerializerVersion string                  `json:"serializerVersion"`
	Snapshot          json.RawMessage         `json:"snapshot"`
	ActorBindings     []canonicalActorBinding `json:"actorBindings"`
	SemanticAuthority string                  `json:"semanticAuthority"`
	SchemaValidation  string                  `json:"schemaValidation"`
}

type canonicalSessionRow struct {
	ID                     uuid.UUID       `gorm:"column:id"`
	RulesetReleaseID       uuid.UUID       `gorm:"column:ruleset_release_id"`
	RulesArtifactHash      string          `gorm:"column:rules_artifact_hash"`
	Mode                   string          `gorm:"column:mode"`
	AuthorityMode          string          `gorm:"column:authority_mode"`
	Status                 string          `gorm:"column:status"`
	CurrentSnapshot        json.RawMessage `gorm:"column:current_snapshot"`
	SnapshotCanonicalBytes []byte          `gorm:"column:snapshot_canonical_bytes"`
	SnapshotSchemaVersion  int             `gorm:"column:snapshot_schema_version"`
	SerializerVersion      string          `gorm:"column:serializer_version"`
	SnapshotSeq            int64           `gorm:"column:snapshot_seq"`
	Revision               int64           `gorm:"column:revision"`
	StateHash              string          `gorm:"column:state_hash"`
}

type canonicalSessionActorRow struct {
	ID                      uuid.UUID       `gorm:"column:id"`
	CharacterID             *uuid.UUID      `gorm:"column:character_id"`
	OwnerUserID             *uuid.UUID      `gorm:"column:owner_user_id"`
	ControllerUserID        *uuid.UUID      `gorm:"column:controller_user_id"`
	ActorKind               string          `gorm:"column:actor_kind"`
	LifecycleStatus         string          `gorm:"column:lifecycle_status"`
	StateProjection         json.RawMessage `gorm:"column:state_projection"`
	StateHash               string          `gorm:"column:state_hash"`
	ProjectionSchemaVersion int             `gorm:"column:projection_schema_version"`
	ProjectionSeq           int64           `gorm:"column:projection_seq"`
}

type canonicalOpenDecisionRow struct {
	RequestID                string          `gorm:"column:request_id"`
	ResolutionID             string          `gorm:"column:resolution_id"`
	DecidingActorID          uuid.UUID       `gorm:"column:deciding_actor_id"`
	AssignedControllerUserID uuid.UUID       `gorm:"column:assigned_controller_user_id"`
	RequestBody              json.RawMessage `gorm:"column:request_body"`
	CanonicalBytes           []byte          `gorm:"column:canonical_bytes"`
	RequestHash              string          `gorm:"column:request_hash"`
}

type canonicalMemberAccess struct {
	Role                    string
	CanControlUnownedActors bool
}

type canonicalHTTPError struct {
	status  int
	message string
}

func (problem *canonicalHTTPError) Error() string { return problem.message }

func canonicalProblem(status int, message string) error {
	return &canonicalHTTPError{status: status, message: message}
}

type canonicalWorldView struct {
	root                map[string]any
	actors              map[string]any
	pendingResolution   any
	revision            int64
	logicalClock        int64
	mode                string
	worldID             string
	processedCommandIDs []string
}

type canonicalPreparedRequest struct {
	request                canonicalTransitionRequest
	requestCanonical       []byte
	requestHash            string
	snapshotValue          any
	snapshotCanonical      []byte
	eventMetadata          any
	eventMetadataCanonical []byte
	newWorld               canonicalWorldView
}

func decodeCanonicalTransitionRequest(body io.Reader) (canonicalPreparedRequest, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxCanonicalTransitionBodyBytes+1))
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return canonicalPreparedRequest{}, canonicalProblem(http.StatusRequestEntityTooLarge, "canonical transition body is too large")
		}
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "cannot read canonical transition body")
	}
	if int64(len(raw)) > maxCanonicalTransitionBodyBytes {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusRequestEntityTooLarge, "canonical transition body is too large")
	}
	rootValue, requestCanonical, err := canonicalizeRawJSON(raw)
	if err != nil {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "canonical transition contains invalid or ambiguous JSON")
	}
	if _, ok := rootValue.(map[string]any); !ok {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "canonical transition must be a JSON object")
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var request canonicalTransitionRequest
	if err = decoder.Decode(&request); err != nil {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "canonical transition shape is invalid")
	}
	if err = requireJSONEOF(decoder); err != nil {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "canonical transition has trailing JSON")
	}
	if err = validateCanonicalTransitionEnvelope(request); err != nil {
		return canonicalPreparedRequest{}, err
	}

	snapshotValue, snapshotCanonical, err := canonicalizeRawJSON(request.Snapshot)
	if err != nil {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "snapshot contains invalid or ambiguous JSON")
	}
	newWorld, err := inspectCanonicalWorld(snapshotValue)
	if err != nil {
		return canonicalPreparedRequest{}, err
	}
	metadataRaw := request.EventMetadata
	if len(metadataRaw) == 0 {
		metadataRaw = json.RawMessage(`{}`)
	}
	eventMetadata, eventMetadataCanonical, err := canonicalizeRawJSON(metadataRaw)
	if err != nil {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusBadRequest, "eventMetadata contains invalid JSON")
	}
	if _, ok := eventMetadata.(map[string]any); !ok {
		return canonicalPreparedRequest{}, canonicalProblem(http.StatusUnprocessableEntity, "eventMetadata must be a JSON object")
	}

	return canonicalPreparedRequest{
		request:                request,
		requestCanonical:       requestCanonical,
		requestHash:            canonicalSHA256(requestCanonical),
		snapshotValue:          snapshotValue,
		snapshotCanonical:      snapshotCanonical,
		eventMetadata:          eventMetadata,
		eventMetadataCanonical: eventMetadataCanonical,
		newWorld:               newWorld,
	}, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func validateCanonicalTransitionEnvelope(request canonicalTransitionRequest) error {
	if request.CommandID == uuid.Nil || request.SourceActorID == uuid.Nil {
		return canonicalProblem(http.StatusBadRequest, "commandId and sourceActorId must be non-zero UUIDs")
	}
	if !validCanonicalStableID(request.SemanticCommandID) {
		return canonicalProblem(http.StatusBadRequest, "semanticCommandId must be a stable non-blank identifier of at most 128 bytes")
	}
	if request.RulesetReleaseID == uuid.Nil || !canonicalTransportSHA256Pattern.MatchString(request.RulesArtifactHash) {
		return canonicalProblem(http.StatusBadRequest, "rulesetReleaseId and rulesArtifactHash are required")
	}
	if request.ExpectedRevision < 0 || request.BaseSnapshotSeq < 0 {
		return canonicalProblem(http.StatusBadRequest, "base revision and snapshot sequence must be non-negative")
	}
	if request.SnapshotSchemaVersion != 5 {
		return canonicalProblem(http.StatusUnprocessableEntity, "canonical transport accepts exactly WorldState schema version 5")
	}
	if strings.TrimSpace(request.SerializerVersion) == "" || request.SerializerVersion != strings.TrimSpace(request.SerializerVersion) || len(request.SerializerVersion) > 100 {
		return canonicalProblem(http.StatusBadRequest, "serializerVersion must be a stable non-blank identifier")
	}
	if !canonicalTransportSHA256Pattern.MatchString(request.BaseStateHash) || !canonicalTransportSHA256Pattern.MatchString(request.StateHash) {
		return canonicalProblem(http.StatusBadRequest, "state hashes must use sha256:<64 lowercase hex>")
	}
	if len(request.Snapshot) == 0 {
		return canonicalProblem(http.StatusBadRequest, "snapshot is required")
	}
	if len(request.TargetActorIDs) > 32 || len(request.ActorBindings) == 0 || len(request.ActorBindings) > 128 {
		return canonicalProblem(http.StatusUnprocessableEntity, "canonical transition actor bounds were exceeded")
	}
	targets := make(map[uuid.UUID]struct{}, len(request.TargetActorIDs))
	for _, targetID := range request.TargetActorIDs {
		if targetID == uuid.Nil || targetID == request.SourceActorID {
			return canonicalProblem(http.StatusBadRequest, "targetActorIds must contain distinct non-source UUIDs")
		}
		if _, duplicate := targets[targetID]; duplicate {
			return canonicalProblem(http.StatusBadRequest, "targetActorIds contains a duplicate UUID")
		}
		targets[targetID] = struct{}{}
	}
	actorIDs := make(map[uuid.UUID]struct{}, len(request.ActorBindings))
	worldActorIDs := make(map[string]struct{}, len(request.ActorBindings))
	for _, binding := range request.ActorBindings {
		if binding.ActorID == uuid.Nil || strings.TrimSpace(binding.WorldActorID) == "" || binding.WorldActorID != strings.TrimSpace(binding.WorldActorID) || len(binding.WorldActorID) > 255 {
			return canonicalProblem(http.StatusBadRequest, "actorBindings contains an invalid actor identity")
		}
		if _, duplicate := actorIDs[binding.ActorID]; duplicate {
			return canonicalProblem(http.StatusBadRequest, "actorBindings contains a duplicate actorId")
		}
		if _, duplicate := worldActorIDs[binding.WorldActorID]; duplicate {
			return canonicalProblem(http.StatusBadRequest, "actorBindings contains a duplicate worldActorId")
		}
		actorIDs[binding.ActorID] = struct{}{}
		worldActorIDs[binding.WorldActorID] = struct{}{}
	}
	if request.Decision != nil {
		decision := request.Decision
		if !validCanonicalStableID(decision.RequestID) || !validCanonicalStableID(decision.ResolutionID) || decision.DecidingActorID == uuid.Nil {
			return canonicalProblem(http.StatusBadRequest, "decision identities must be stable non-blank identifiers of at most 128 bytes")
		}
		if decision.RequestID == decision.ResolutionID {
			return canonicalProblem(http.StatusBadRequest, "decision requestId and resolutionId must be distinct")
		}
		if decision.RequestSchemaVersion != 1 {
			return canonicalProblem(http.StatusUnprocessableEntity, "decision requestSchemaVersion must equal 1")
		}
	}
	return nil
}

func validCanonicalStableID(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= maxCanonicalStableIDBytes
}

func inspectCanonicalWorld(value any) (canonicalWorldView, error) {
	root, ok := value.(map[string]any)
	if !ok {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot must be a JSON object")
	}
	actors, ok := root["actors"].(map[string]any)
	if !ok {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot.actors must be an object")
	}
	// The database remains the final WorldState-v5 validator, but reject the
	// critical HP shape here as well. Besides producing a stable API error, this
	// keeps a malformed client snapshot from reaching a CHECK constraint after
	// the transaction has started writing its command ledger.
	for _, actorValue := range actors {
		actor, actorOK := actorValue.(map[string]any)
		if !actorOK {
			continue
		}
		runtime, runtimeOK := actor["runtime"].(map[string]any)
		if !runtimeOK {
			continue
		}
		hpValue, hasHP := runtime["hp"]
		if !hasHP {
			continue
		}
		hp, hpOK := hpValue.(map[string]any)
		if !hpOK {
			return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot actor runtime.hp must be an object")
		}
		current, currentOK := canonicalJSONInteger(hp["current"])
		maximum, maximumOK := canonicalJSONInteger(hp["max"])
		temporary, temporaryOK := canonicalJSONInteger(hp["temp"])
		if !currentOK || !maximumOK || !temporaryOK {
			return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot actor HP values must be integers")
		}
		if maximum < 1 || temporary < 0 {
			return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot actor HP max must be positive and temp must be non-negative")
		}
		_ = current // Current HP may be negative or exceed max in the persisted v5 contract.
	}
	revision, ok := canonicalJSONInteger(root["revision"])
	if !ok || revision < 0 {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot revision must be a non-negative integer")
	}
	logicalClock, ok := canonicalJSONInteger(root["logicalClock"])
	if !ok || logicalClock < 0 {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot logicalClock must be a non-negative integer")
	}
	worldID, ok := root["id"].(string)
	if !ok || strings.TrimSpace(worldID) == "" {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot id must be stable and non-blank")
	}
	scene, ok := root["scene"].(map[string]any)
	if !ok {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot scene must be an object")
	}
	mode, ok := scene["mode"].(string)
	if !ok || (mode != "exploration" && mode != "encounter") {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot scene mode is invalid")
	}
	processedRaw, ok := root["processedCommandIds"].([]any)
	if !ok {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot processedCommandIds must be an array")
	}
	processed := make([]string, len(processedRaw))
	seen := make(map[string]struct{}, len(processedRaw))
	for index, item := range processedRaw {
		commandID, ok := item.(string)
		if !ok || !validCanonicalStableID(commandID) {
			return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot processedCommandIds contains an invalid id")
		}
		if _, duplicate := seen[commandID]; duplicate {
			return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot processedCommandIds contains a duplicate id")
		}
		seen[commandID] = struct{}{}
		processed[index] = commandID
	}
	pending, exists := root["pendingResolution"]
	if !exists {
		return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot must explicitly contain pendingResolution")
	}
	if pending != nil {
		if _, ok := pending.(map[string]any); !ok {
			return canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "snapshot pendingResolution must be null or an object")
		}
	}
	return canonicalWorldView{
		root: root, actors: actors, pendingResolution: pending,
		revision: revision, logicalClock: logicalClock, mode: mode,
		worldID: worldID, processedCommandIDs: processed,
	}, nil
}

func canonicalJSONInteger(value any) (int64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	floatValue, err := strconv.ParseFloat(string(number), 64)
	if err != nil || math.IsInf(floatValue, 0) || math.IsNaN(floatValue) || math.Trunc(floatValue) != floatValue || floatValue < math.MinInt64 || floatValue > math.MaxInt64 {
		return 0, false
	}
	return int64(floatValue), true
}

func (controller *CanonicalSessionController) GetCurrent(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication is required"})
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil || sessionID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid canonical session id"})
		return
	}

	var response canonicalSessionReadResponse
	err = controller.db.Transaction(func(tx *gorm.DB) error {
		var session canonicalSessionRow
		result := tx.Raw(`
			SELECT id, ruleset_release_id, rules_artifact_hash, mode, authority_mode,
				status, current_snapshot, snapshot_canonical_bytes,
				snapshot_schema_version, serializer_version, snapshot_seq, revision, state_hash
			FROM game_sessions WHERE id = ? FOR SHARE
		`, sessionID).Scan(&session)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return canonicalProblem(http.StatusNotFound, "canonical session was not found")
		}
		active, err := activeCanonicalMembers(tx, sessionID, false)
		if err != nil {
			return err
		}
		if _, member := active[userID]; !member {
			return canonicalProblem(http.StatusForbidden, "active canonical session membership is required")
		}
		world, _, err := verifyStoredCanonicalSession(session)
		if err != nil {
			return err
		}
		if err = verifyCanonicalSnapshotHead(tx, session); err != nil {
			return err
		}
		actors, err := loadCanonicalActors(tx, sessionID, false)
		if err != nil {
			return err
		}
		bindings, err := inferCanonicalActorBindings(actors, world)
		if err != nil {
			return err
		}
		response = canonicalSessionReadResponse{
			SessionID: session.ID, RulesetReleaseID: session.RulesetReleaseID,
			RulesArtifactHash: session.RulesArtifactHash, Revision: session.Revision,
			SnapshotSeq: session.SnapshotSeq, StateHash: session.StateHash,
			SchemaVersion:     session.SnapshotSchemaVersion,
			SerializerVersion: session.SerializerVersion,
			Snapshot:          json.RawMessage(append([]byte(nil), session.SnapshotCanonicalBytes...)),
			ActorBindings:     bindings, SemanticAuthority: canonicalTransportAuthority,
			SchemaValidation: canonicalTransportSchemaValidation,
		}
		return nil
	})
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (controller *CanonicalSessionController) ApplyTransition(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication is required"})
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil || sessionID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid canonical session id"})
		return
	}
	prepared, err := decodeCanonicalTransitionRequest(c.Request.Body)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}

	var response canonicalTransitionResponse
	err = controller.db.Transaction(func(tx *gorm.DB) error {
		var session canonicalSessionRow
		result := tx.Raw(`
			SELECT id, ruleset_release_id, rules_artifact_hash, mode, authority_mode,
				status, current_snapshot, snapshot_canonical_bytes,
				snapshot_schema_version, serializer_version, snapshot_seq, revision, state_hash
			FROM game_sessions WHERE id = ? FOR UPDATE
		`, sessionID).Scan(&session)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return canonicalProblem(http.StatusNotFound, "canonical session was not found")
		}

		// Membership is locked before any mutable status/authority/actor checks.
		// A concurrent revoke therefore linearizes either before this transition
		// (and rejects it) or after this transaction commits.
		members, err := activeCanonicalMembers(tx, sessionID, true)
		if err != nil {
			return err
		}
		caller, member := members[userID]
		if !member {
			return canonicalProblem(http.StatusForbidden, "active canonical session membership is required")
		}
		if caller.Role == "observer" {
			return canonicalProblem(http.StatusForbidden, "observer membership cannot apply canonical transitions")
		}
		oldWorld, _, err := verifyStoredCanonicalSession(session)
		if err != nil {
			return err
		}
		if err = verifyCanonicalSnapshotHead(tx, session); err != nil {
			return err
		}
		if prepared.request.RulesetReleaseID != session.RulesetReleaseID ||
			prepared.request.RulesArtifactHash != session.RulesArtifactHash {
			return canonicalProblem(http.StatusConflict, "rules release envelope does not match the canonical session")
		}
		// An exact retry by the still-active original caller returns its immutable
		// receipt even after a later freeze or actor-control change. Mutable ACLs
		// cannot turn a committed command into a non-idempotent operation.
		if found, err := loadIdempotentCanonicalResult(tx, sessionID, userID, prepared, &response); err != nil {
			return err
		} else if found {
			return nil
		}
		if session.Status != "active" {
			return canonicalProblem(http.StatusConflict, "canonical session is not active")
		}
		if session.AuthorityMode != "local" {
			return canonicalProblem(http.StatusConflict, "transport-only transitions require authority_mode=local")
		}
		actors, err := loadCanonicalActors(tx, sessionID, true)
		if err != nil {
			return err
		}
		actorsByID := make(map[uuid.UUID]canonicalSessionActorRow, len(actors))
		for _, actor := range actors {
			actorsByID[actor.ID] = actor
		}
		source, exists := actorsByID[prepared.request.SourceActorID]
		if !exists || source.ControllerUserID == nil || *source.ControllerUserID != userID {
			return canonicalProblem(http.StatusForbidden, "the authenticated member does not control sourceActorId")
		}
		if err = requireCanonicalActorMembers(source, members, true); err != nil {
			return err
		}
		for _, targetID := range prepared.request.TargetActorIDs {
			target, exists := actorsByID[targetID]
			if !exists {
				return canonicalProblem(http.StatusUnprocessableEntity, "targetActorIds contains an actor outside the active session")
			}
			if err = requireCanonicalActorMembers(target, members, true); err != nil {
				return err
			}
		}

		if _, err = inferCanonicalActorBindings(actors, oldWorld); err != nil {
			return err
		}
		if prepared.request.ExpectedRevision != session.Revision ||
			prepared.request.BaseSnapshotSeq != session.SnapshotSeq ||
			prepared.request.BaseStateHash != session.StateHash {
			return canonicalProblem(http.StatusConflict, "canonical transition is stale")
		}
		if prepared.request.SerializerVersion != session.SerializerVersion {
			return canonicalProblem(http.StatusConflict, "serializerVersion does not match the canonical session")
		}
		if prepared.request.SnapshotSchemaVersion != session.SnapshotSchemaVersion {
			return canonicalProblem(http.StatusConflict, "snapshot schema version does not match the canonical session")
		}
		if prepared.newWorld.revision != session.Revision+1 {
			return canonicalProblem(http.StatusUnprocessableEntity, "new WorldState revision must equal expectedRevision + 1")
		}
		if prepared.newWorld.logicalClock < oldWorld.logicalClock {
			return canonicalProblem(http.StatusUnprocessableEntity, "WorldState logicalClock cannot move backwards")
		}
		if prepared.newWorld.worldID != oldWorld.worldID || prepared.newWorld.mode != session.Mode || oldWorld.mode != session.Mode {
			return canonicalProblem(http.StatusUnprocessableEntity, "WorldState identity or scene mode does not match the session")
		}
		oldRuleset, err := canonicalJSON(oldWorld.root["ruleset"])
		if err != nil {
			return canonicalProblem(http.StatusInternalServerError, "stored canonical ruleset cannot be verified")
		}
		newRuleset, err := canonicalJSON(prepared.newWorld.root["ruleset"])
		if err != nil || !bytes.Equal(oldRuleset, newRuleset) {
			return canonicalProblem(http.StatusUnprocessableEntity, "WorldState ruleset binding cannot change inside a session")
		}
		if err = verifyProcessedCommandAppend(oldWorld.processedCommandIDs, prepared.newWorld.processedCommandIDs, prepared.request.SemanticCommandID); err != nil {
			return err
		}
		if computed := canonicalSHA256(prepared.snapshotCanonical); computed != prepared.request.StateHash {
			return canonicalProblem(http.StatusUnprocessableEntity, "stateHash does not match canonical snapshot bytes")
		}

		projectionPlan, err := prepareCanonicalActorProjections(prepared, oldWorld, actors, members, userID)
		if err != nil {
			return err
		}
		decisionPlan, err := prepareCanonicalDecisionPlan(tx, session, prepared, oldWorld, actorsByID, members, userID)
		if err != nil {
			return err
		}

		newSnapshotSeq := session.SnapshotSeq + 1
		eventSeq, err := nextCanonicalEventSeq(tx, sessionID)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		eventTargetIDs := make([]any, len(prepared.request.TargetActorIDs))
		for index, targetID := range prepared.request.TargetActorIDs {
			eventTargetIDs[index] = targetID.String()
		}
		eventBody := map[string]any{
			"type":              canonicalTransportEventType,
			"sessionId":         sessionID.String(),
			"commandId":         prepared.request.CommandID.String(),
			"semanticCommandId": prepared.request.SemanticCommandID,
			"rulesetReleaseId":  session.RulesetReleaseID.String(),
			"rulesArtifactHash": session.RulesArtifactHash,
			"serializerVersion": session.SerializerVersion,
			"eventSeq":          eventSeq,
			"snapshotSeq":       newSnapshotSeq,
			"revisionBefore":    session.Revision,
			"revisionAfter":     prepared.newWorld.revision,
			"sourceActorId":     prepared.request.SourceActorID.String(),
			"targetActorIds":    eventTargetIDs,
			"stateHashBefore":   session.StateHash,
			"stateHashAfter":    prepared.request.StateHash,
			"metadata":          prepared.eventMetadata,
			"semanticAuthority": canonicalTransportAuthority,
			"schemaValidation":  canonicalTransportSchemaValidation,
			"occurredAt":        now.Format(time.RFC3339Nano),
		}
		eventCanonical, err := canonicalJSON(eventBody)
		if err != nil {
			return err
		}
		eventHash := canonicalSHA256(eventCanonical)

		executionInput := map[string]any{
			"transportOnly":      true,
			"semanticAuthority":  canonicalTransportAuthority,
			"schemaValidation":   canonicalTransportSchemaValidation,
			"transportCommandId": prepared.request.CommandID.String(),
			"semanticCommandId":  prepared.request.SemanticCommandID,
			"rulesetReleaseId":   session.RulesetReleaseID.String(),
			"rulesArtifactHash":  session.RulesArtifactHash,
			"serializerVersion":  session.SerializerVersion,
			"expectedRevision":   session.Revision,
			"baseSnapshotSeq":    session.SnapshotSeq,
			"baseStateHash":      session.StateHash,
			"stateHash":          prepared.request.StateHash,
		}
		executionCanonical, err := canonicalJSON(executionInput)
		if err != nil {
			return err
		}
		if err = tx.Exec(`
			INSERT INTO game_commands (
				id, session_id, command_id, semantic_command_id, ruleset_release_id, rules_artifact_hash,
				source_actor_id, controller_user_id, command_type, status,
				expected_revision, base_snapshot_seq, base_state_hash,
				command_schema_version, serializer_version, canonical_body,
				canonical_bytes, request_hash, execution_input,
				execution_input_canonical_bytes, execution_input_hash,
				admitted_at, started_at, updated_at
			) VALUES (
				?, ?, ?, ?, ?, ?, ?, ?, ?, 'executing', ?, ?, ?, 1, ?, ?::jsonb,
				?, ?, ?::jsonb, ?, ?, ?, ?, ?
			)
		`, uuid.New(), sessionID, prepared.request.CommandID, prepared.request.SemanticCommandID, session.RulesetReleaseID,
			session.RulesArtifactHash, prepared.request.SourceActorID, userID,
			canonicalTransportCommandType, session.Revision, session.SnapshotSeq,
			session.StateHash, session.SerializerVersion, string(prepared.requestCanonical),
			prepared.requestCanonical, prepared.requestHash, string(executionCanonical),
			executionCanonical, canonicalSHA256(executionCanonical), now, now, now).Error; err != nil {
			return normalizeCanonicalDatabaseError(err)
		}
		if err = tx.Exec(`
			INSERT INTO command_execution_jobs (
				id, session_id, command_id, status, fencing_token, attempt_count,
				max_attempts, next_attempt_at, created_at, updated_at, completed_at
			) VALUES (?, ?, ?, 'succeeded', ?, 1, 1, ?, ?, ?, ?)
		`, uuid.New(), sessionID, prepared.request.CommandID,
			canonicalTransportFencingToken, now, now, now, now).Error; err != nil {
			return normalizeCanonicalDatabaseError(err)
		}
		targetIDsCanonical, err := canonicalJSON(eventTargetIDs)
		if err != nil {
			return err
		}
		eventID := uuid.New()
		if err = tx.Exec(`
			INSERT INTO game_events (
				id, session_id, seq, command_id, event_index, command_fencing_token,
				ruleset_release_id, rules_artifact_hash, source_actor_id,
				target_actor_ids, event_type, event_schema_version, serializer_version,
				logical_time, payload, canonical_bytes, event_hash,
				state_hash_before, state_hash_after, occurred_at, recorded_at
			) VALUES (
				?, ?, ?, ?, 0, ?, ?, ?, ?, ?::jsonb, ?, 1, ?, ?, ?::jsonb,
				?, ?, ?, ?, ?, ?
			)
		`, eventID, sessionID, eventSeq, prepared.request.CommandID,
			canonicalTransportFencingToken, session.RulesetReleaseID,
			session.RulesArtifactHash, prepared.request.SourceActorID,
			string(targetIDsCanonical), canonicalTransportEventType,
			session.SerializerVersion, prepared.newWorld.logicalClock,
			string(eventCanonical), eventCanonical, eventHash,
			session.StateHash, prepared.request.StateHash, now, now).Error; err != nil {
			return normalizeCanonicalDatabaseError(err)
		}

		decisionResult, err := applyCanonicalDecisionPlan(tx, session, prepared, decisionPlan, eventSeq, now)
		if err != nil {
			return err
		}
		if err = tx.Exec(`
			INSERT INTO session_snapshots (
				id, session_id, seq, revision, ruleset_release_id,
				rules_artifact_hash, snapshot_schema_version, serializer_version,
				snapshot, canonical_bytes, state_hash, last_event_hash, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)
		`, uuid.New(), sessionID, newSnapshotSeq, prepared.newWorld.revision,
			session.RulesetReleaseID, session.RulesArtifactHash,
			prepared.request.SnapshotSchemaVersion, session.SerializerVersion,
			string(prepared.snapshotCanonical), prepared.snapshotCanonical,
			prepared.request.StateHash, eventHash, now).Error; err != nil {
			return normalizeCanonicalDatabaseError(err)
		}
		for _, projection := range projectionPlan {
			update := tx.Exec(`
				UPDATE game_session_actors
				SET state_projection = ?::jsonb, state_hash = ?,
					projection_schema_version = ?, projection_seq = ?, updated_at = ?
				WHERE session_id = ? AND id = ? AND lifecycle_status = 'active'
			`, string(projection.canonical), projection.stateHash,
				prepared.request.SnapshotSchemaVersion, newSnapshotSeq, now,
				sessionID, projection.actorID)
			if update.Error != nil {
				return normalizeCanonicalDatabaseError(update.Error)
			}
			if update.RowsAffected != 1 {
				return canonicalProblem(http.StatusConflict, "canonical actor projection changed concurrently")
			}
		}
		update := tx.Exec(`
			UPDATE game_sessions
			SET current_snapshot = ?::jsonb, snapshot_canonical_bytes = ?,
				snapshot_schema_version = ?, serializer_version = ?, snapshot_seq = ?,
				revision = ?, state_hash = ?, updated_at = ?
			WHERE id = ? AND revision = ? AND snapshot_seq = ? AND state_hash = ?
		`, string(prepared.snapshotCanonical), prepared.snapshotCanonical,
			prepared.request.SnapshotSchemaVersion, session.SerializerVersion,
			newSnapshotSeq, prepared.newWorld.revision, prepared.request.StateHash,
			now, sessionID, session.Revision, session.SnapshotSeq, session.StateHash)
		if update.Error != nil {
			return normalizeCanonicalDatabaseError(update.Error)
		}
		if update.RowsAffected != 1 {
			return canonicalProblem(http.StatusConflict, "canonical transition lost its compare-and-swap")
		}

		projectionHashes := make(map[string]string, len(projectionPlan))
		for _, projection := range projectionPlan {
			projectionHashes[projection.actorID.String()] = projection.stateHash
		}
		response = canonicalTransitionResponse{
			SessionID: sessionID, CommandID: prepared.request.CommandID,
			SemanticCommandID: prepared.request.SemanticCommandID,
			RulesetReleaseID:  session.RulesetReleaseID,
			RulesArtifactHash: session.RulesArtifactHash,
			SerializerVersion: session.SerializerVersion,
			Revision:          prepared.newWorld.revision, SnapshotSeq: newSnapshotSeq,
			StateHash: prepared.request.StateHash, EventSeq: eventSeq,
			EventHash: eventHash, ActorProjectionHashes: projectionHashes,
			Decision: decisionResult, SemanticAuthority: canonicalTransportAuthority,
			SchemaValidation: canonicalTransportSchemaValidation,
			Idempotent:       true,
		}
		resultValue, err := transitionResponseValue(response)
		if err != nil {
			return err
		}
		resultCanonical, err := canonicalJSON(resultValue)
		if err != nil {
			return err
		}
		commandUpdate := tx.Exec(`
			UPDATE game_commands
			SET status = 'committed', result_body = ?::jsonb,
				result_canonical_bytes = ?, result_hash = ?,
				committed_fencing_token = ?, completed_at = ?, updated_at = ?
			WHERE session_id = ? AND command_id = ? AND status = 'executing'
		`, string(resultCanonical), resultCanonical, canonicalSHA256(resultCanonical),
			canonicalTransportFencingToken, now, now, sessionID, prepared.request.CommandID)
		if commandUpdate.Error != nil {
			return normalizeCanonicalDatabaseError(commandUpdate.Error)
		}
		if commandUpdate.RowsAffected != 1 {
			return canonicalProblem(http.StatusConflict, "canonical command receipt changed concurrently")
		}
		return nil
	})
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func transitionResponseValue(response canonicalTransitionResponse) (any, error) {
	raw, err := json.Marshal(response)
	if err != nil {
		return nil, err
	}
	return decodeUniqueJSON(raw)
}

func activeCanonicalMembers(tx *gorm.DB, sessionID uuid.UUID, lock bool) (map[uuid.UUID]canonicalMemberAccess, error) {
	var rows []struct {
		UserID                  uuid.UUID `gorm:"column:user_id"`
		Role                    string    `gorm:"column:role"`
		CanControlUnownedActors bool      `gorm:"column:can_control_unowned_actors"`
	}
	query := `
		SELECT user_id, role, can_control_unowned_actors FROM game_session_members
		WHERE session_id = ? AND status = 'active'
	`
	if lock {
		query += " FOR SHARE"
	}
	if err := tx.Raw(query, sessionID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	members := make(map[uuid.UUID]canonicalMemberAccess, len(rows))
	for _, row := range rows {
		if row.Role != "owner" && row.Role != "gm" && row.Role != "player" && row.Role != "observer" {
			return nil, canonicalProblem(http.StatusInternalServerError, "canonical session contains an invalid member role")
		}
		if row.CanControlUnownedActors && row.Role != "owner" && row.Role != "gm" {
			return nil, canonicalProblem(http.StatusInternalServerError, "canonical session contains an invalid elevated member capability")
		}
		members[row.UserID] = canonicalMemberAccess{
			Role: row.Role, CanControlUnownedActors: row.CanControlUnownedActors,
		}
	}
	return members, nil
}

func loadCanonicalActors(tx *gorm.DB, sessionID uuid.UUID, lock bool) ([]canonicalSessionActorRow, error) {
	query := `
		SELECT id, character_id, owner_user_id, controller_user_id, actor_kind,
			lifecycle_status, state_projection, state_hash,
			projection_schema_version, projection_seq
		FROM game_session_actors
		WHERE session_id = ? AND lifecycle_status = 'active' AND actor_kind <> 'world_object'
		ORDER BY id
	`
	if lock {
		query += " FOR UPDATE"
	}
	var actors []canonicalSessionActorRow
	if err := tx.Raw(query, sessionID).Scan(&actors).Error; err != nil {
		return nil, err
	}
	return actors, nil
}

func requireCanonicalActorMembers(actor canonicalSessionActorRow, members map[uuid.UUID]canonicalMemberAccess, requireOwner bool) error {
	if actor.ControllerUserID == nil {
		return canonicalProblem(http.StatusUnprocessableEntity, "active canonical actor has no controller")
	}
	controller, active := members[*actor.ControllerUserID]
	if !active {
		return canonicalProblem(http.StatusForbidden, "canonical actor controller is not an active session member")
	}
	if controller.Role == "observer" {
		return canonicalProblem(http.StatusForbidden, "observer membership cannot control a canonical actor")
	}
	if actor.OwnerUserID != nil {
		if _, active := members[*actor.OwnerUserID]; !active {
			return canonicalProblem(http.StatusForbidden, "canonical actor owner is not an active session member")
		}
	} else if requireOwner && (actor.CharacterID != nil || actor.ActorKind == "player_character") {
		return canonicalProblem(http.StatusUnprocessableEntity, "character-backed canonical actor has no owner")
	}
	return nil
}

func canonicalMemberMayMutateActor(member canonicalMemberAccess, userID uuid.UUID, actor canonicalSessionActorRow) bool {
	if userID == uuid.Nil {
		return false
	}
	if member.CanControlUnownedActors && (member.Role == "owner" || member.Role == "gm") {
		return true
	}
	return (actor.ControllerUserID != nil && *actor.ControllerUserID == userID) ||
		(actor.OwnerUserID != nil && *actor.OwnerUserID == userID)
}

func verifyStoredCanonicalSession(session canonicalSessionRow) (canonicalWorldView, []byte, error) {
	value, canonical, err := canonicalizeRawJSON(session.CurrentSnapshot)
	if err != nil {
		return canonicalWorldView{}, nil, canonicalProblem(http.StatusInternalServerError, "stored canonical session JSON is invalid")
	}
	if !bytes.Equal(canonical, session.SnapshotCanonicalBytes) || canonicalSHA256(canonical) != session.StateHash {
		return canonicalWorldView{}, nil, canonicalProblem(http.StatusInternalServerError, "stored canonical session hash integrity failed")
	}
	world, err := inspectCanonicalWorld(value)
	if err != nil {
		return canonicalWorldView{}, nil, canonicalProblem(http.StatusInternalServerError, "stored canonical WorldState is invalid")
	}
	if world.revision != session.Revision || session.SnapshotSchemaVersion != 5 {
		return canonicalWorldView{}, nil, canonicalProblem(http.StatusInternalServerError, "stored canonical session revision is inconsistent")
	}
	return world, canonical, nil
}

func verifyCanonicalSnapshotHead(tx *gorm.DB, session canonicalSessionRow) error {
	var historical struct {
		Revision              int64           `gorm:"column:revision"`
		RulesetReleaseID      uuid.UUID       `gorm:"column:ruleset_release_id"`
		RulesArtifactHash     string          `gorm:"column:rules_artifact_hash"`
		SnapshotSchemaVersion int             `gorm:"column:snapshot_schema_version"`
		SerializerVersion     string          `gorm:"column:serializer_version"`
		Snapshot              json.RawMessage `gorm:"column:snapshot"`
		CanonicalBytes        []byte          `gorm:"column:canonical_bytes"`
		StateHash             string          `gorm:"column:state_hash"`
		LastEventHash         *string         `gorm:"column:last_event_hash"`
	}
	result := tx.Raw(`
		SELECT revision, ruleset_release_id, rules_artifact_hash,
			snapshot_schema_version, serializer_version,
			snapshot, canonical_bytes, state_hash, last_event_hash
		FROM session_snapshots
		WHERE session_id = ? AND seq = ?
	`, session.ID, session.SnapshotSeq).Scan(&historical)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return canonicalProblem(http.StatusInternalServerError, "canonical session has no immutable snapshot head")
	}
	_, historicalCanonical, err := canonicalizeRawJSON(historical.Snapshot)
	if err != nil || !bytes.Equal(historicalCanonical, historical.CanonicalBytes) ||
		canonicalSHA256(historicalCanonical) != historical.StateHash ||
		!bytes.Equal(historicalCanonical, session.SnapshotCanonicalBytes) ||
		historical.StateHash != session.StateHash || historical.Revision != session.Revision ||
		historical.SnapshotSchemaVersion != session.SnapshotSchemaVersion ||
		historical.SerializerVersion != session.SerializerVersion ||
		historical.RulesetReleaseID != session.RulesetReleaseID ||
		historical.RulesArtifactHash != session.RulesArtifactHash {
		return canonicalProblem(http.StatusInternalServerError, "immutable snapshot head does not match the canonical session")
	}
	if session.SnapshotSeq == 0 {
		if historical.LastEventHash != nil {
			return canonicalProblem(http.StatusInternalServerError, "canonical genesis snapshot unexpectedly references an event")
		}
		return nil
	}
	if historical.LastEventHash == nil {
		return canonicalProblem(http.StatusInternalServerError, "canonical snapshot head has no event hash")
	}
	var event struct {
		Seq               int64           `gorm:"column:seq"`
		CommandID         uuid.UUID       `gorm:"column:command_id"`
		SemanticCommandID string          `gorm:"column:semantic_command_id"`
		RulesetReleaseID  uuid.UUID       `gorm:"column:ruleset_release_id"`
		RulesArtifactHash string          `gorm:"column:rules_artifact_hash"`
		SerializerVersion string          `gorm:"column:serializer_version"`
		Payload           json.RawMessage `gorm:"column:payload"`
		CanonicalBytes    []byte          `gorm:"column:canonical_bytes"`
		EventHash         string          `gorm:"column:event_hash"`
		StateHashBefore   string          `gorm:"column:state_hash_before"`
		StateHashAfter    string          `gorm:"column:state_hash_after"`
	}
	eventResult := tx.Raw(`
		SELECT event.seq, event.command_id, command.semantic_command_id,
			event.ruleset_release_id, event.rules_artifact_hash,
			event.serializer_version, event.payload, event.canonical_bytes,
			event.event_hash, event.state_hash_before, event.state_hash_after
		FROM game_events AS event
		JOIN game_commands AS command
			ON command.session_id = event.session_id AND command.command_id = event.command_id
		WHERE event.session_id = ? AND event.event_hash = ?
	`, session.ID, *historical.LastEventHash).Scan(&event)
	if eventResult.Error != nil {
		return eventResult.Error
	}
	eventValue, eventCanonical, eventErr := canonicalizeRawJSON(event.Payload)
	if eventResult.RowsAffected != 1 || eventErr != nil ||
		!bytes.Equal(eventCanonical, event.CanonicalBytes) ||
		canonicalSHA256(eventCanonical) != event.EventHash ||
		event.EventHash != *historical.LastEventHash || event.StateHashAfter != session.StateHash ||
		event.Seq != session.SnapshotSeq || event.RulesetReleaseID != session.RulesetReleaseID ||
		event.RulesArtifactHash != session.RulesArtifactHash || event.SerializerVersion != session.SerializerVersion {
		return canonicalProblem(http.StatusInternalServerError, "canonical snapshot event does not match the session state hash")
	}
	var previous struct {
		StateHash string `gorm:"column:state_hash"`
	}
	previousResult := tx.Raw(`
		SELECT state_hash FROM session_snapshots WHERE session_id = ? AND seq = ?
	`, session.ID, session.SnapshotSeq-1).Scan(&previous)
	if previousResult.Error != nil {
		return previousResult.Error
	}
	if previousResult.RowsAffected != 1 || previous.StateHash != event.StateHashBefore ||
		!canonicalEventPayloadMatchesHead(eventValue, session, event) {
		return canonicalProblem(http.StatusInternalServerError, "canonical snapshot event adjacency or envelope is inconsistent")
	}
	return nil
}

func canonicalEventPayloadMatchesHead(value any, session canonicalSessionRow, event struct {
	Seq               int64           `gorm:"column:seq"`
	CommandID         uuid.UUID       `gorm:"column:command_id"`
	SemanticCommandID string          `gorm:"column:semantic_command_id"`
	RulesetReleaseID  uuid.UUID       `gorm:"column:ruleset_release_id"`
	RulesArtifactHash string          `gorm:"column:rules_artifact_hash"`
	SerializerVersion string          `gorm:"column:serializer_version"`
	Payload           json.RawMessage `gorm:"column:payload"`
	CanonicalBytes    []byte          `gorm:"column:canonical_bytes"`
	EventHash         string          `gorm:"column:event_hash"`
	StateHashBefore   string          `gorm:"column:state_hash_before"`
	StateHashAfter    string          `gorm:"column:state_hash_after"`
}) bool {
	payload, ok := value.(map[string]any)
	if !ok {
		return false
	}
	eventSeq, eventSeqOK := canonicalJSONInteger(payload["eventSeq"])
	snapshotSeq, snapshotSeqOK := canonicalJSONInteger(payload["snapshotSeq"])
	revisionAfter, revisionAfterOK := canonicalJSONInteger(payload["revisionAfter"])
	return eventSeqOK && snapshotSeqOK && revisionAfterOK &&
		eventSeq == event.Seq && snapshotSeq == session.SnapshotSeq && revisionAfter == session.Revision &&
		payload["type"] == canonicalTransportEventType && payload["sessionId"] == session.ID.String() &&
		payload["commandId"] == event.CommandID.String() &&
		payload["semanticCommandId"] == event.SemanticCommandID &&
		payload["rulesetReleaseId"] == session.RulesetReleaseID.String() &&
		payload["rulesArtifactHash"] == session.RulesArtifactHash &&
		payload["serializerVersion"] == session.SerializerVersion &&
		payload["stateHashBefore"] == event.StateHashBefore && payload["stateHashAfter"] == event.StateHashAfter &&
		payload["semanticAuthority"] == canonicalTransportAuthority &&
		payload["schemaValidation"] == canonicalTransportSchemaValidation
}

func inferCanonicalActorBindings(actors []canonicalSessionActorRow, world canonicalWorldView) ([]canonicalActorBinding, error) {
	bindings := make([]canonicalActorBinding, 0, len(actors))
	seen := make(map[string]struct{}, len(actors))
	for _, actor := range actors {
		value, canonical, err := canonicalizeRawJSON(actor.StateProjection)
		if err != nil || canonicalSHA256(canonical) != actor.StateHash {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored canonical actor projection integrity failed")
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored canonical actor projection is not an object")
		}
		worldActorID, ok := object["id"].(string)
		if !ok || strings.TrimSpace(worldActorID) == "" {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored canonical actor projection has no world id")
		}
		if actor.ControllerUserID == nil || object["controllerId"] != actor.ControllerUserID.String() {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored WorldState controller does not match the actor controller")
		}
		expectedKind, kindErr := canonicalWorldActorKind(actor.ActorKind)
		if kindErr != nil || object["kind"] != expectedKind {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored WorldState actor kind does not match the runtime actor kind")
		}
		if _, duplicate := seen[worldActorID]; duplicate {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored canonical actor projections duplicate a world id")
		}
		worldProjection, exists := world.actors[worldActorID]
		if !exists {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored canonical actor is absent from WorldState")
		}
		worldCanonical, err := canonicalJSON(worldProjection)
		if err != nil || !bytes.Equal(worldCanonical, canonical) {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored actor projection does not match WorldState")
		}
		seen[worldActorID] = struct{}{}
		bindings = append(bindings, canonicalActorBinding{ActorID: actor.ID, WorldActorID: worldActorID})
	}
	if len(seen) != len(world.actors) {
		return nil, canonicalProblem(http.StatusInternalServerError, "WorldState actor set does not match active session actors")
	}
	sort.Slice(bindings, func(left, right int) bool { return bindings[left].ActorID.String() < bindings[right].ActorID.String() })
	return bindings, nil
}

func canonicalWorldActorKind(databaseKind string) (string, error) {
	switch databaseKind {
	case "player_character":
		return "playerCharacter", nil
	case "summoned_actor":
		return "summonedActor", nil
	case "npc", "external_actor":
		return "monster", nil
	default:
		return "", errors.New("unsupported canonical runtime actor kind")
	}
}

func verifyProcessedCommandAppend(oldIDs, newIDs []string, semanticCommandID string) error {
	if len(newIDs) != len(oldIDs)+1 {
		return canonicalProblem(http.StatusUnprocessableEntity, "processedCommandIds must append exactly one command")
	}
	for index, oldID := range oldIDs {
		if newIDs[index] != oldID {
			return canonicalProblem(http.StatusUnprocessableEntity, "processedCommandIds cannot rewrite command history")
		}
	}
	if newIDs[len(newIDs)-1] != semanticCommandID {
		return canonicalProblem(http.StatusUnprocessableEntity, "processedCommandIds must append semanticCommandId")
	}
	return nil
}

type canonicalProjectionUpdate struct {
	actorID   uuid.UUID
	canonical []byte
	stateHash string
}

func prepareCanonicalActorProjections(
	prepared canonicalPreparedRequest,
	oldWorld canonicalWorldView,
	actors []canonicalSessionActorRow,
	members map[uuid.UUID]canonicalMemberAccess,
	userID uuid.UUID,
) ([]canonicalProjectionUpdate, error) {
	if len(prepared.request.ActorBindings) != len(actors) || len(prepared.newWorld.actors) != len(actors) {
		return nil, canonicalProblem(http.StatusUnprocessableEntity, "actorBindings must cover the complete active WorldState actor set")
	}
	actorRows := make(map[uuid.UUID]canonicalSessionActorRow, len(actors))
	for _, actor := range actors {
		actorRows[actor.ID] = actor
	}
	targets := make(map[uuid.UUID]struct{}, len(prepared.request.TargetActorIDs))
	for _, targetID := range prepared.request.TargetActorIDs {
		targets[targetID] = struct{}{}
	}
	seenWorld := make(map[string]struct{}, len(actors))
	updates := make([]canonicalProjectionUpdate, 0, len(actors))
	for _, binding := range prepared.request.ActorBindings {
		row, exists := actorRows[binding.ActorID]
		if !exists {
			return nil, canonicalProblem(http.StatusUnprocessableEntity, "actorBindings references an actor outside the active session")
		}
		if err := requireCanonicalActorMembers(row, members, false); err != nil {
			return nil, err
		}
		oldProjectionValue, oldProjectionCanonical, err := canonicalizeRawJSON(row.StateProjection)
		if err != nil || canonicalSHA256(oldProjectionCanonical) != row.StateHash {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored canonical actor projection integrity failed")
		}
		oldProjectionObject, ok := oldProjectionValue.(map[string]any)
		if !ok || oldProjectionObject["id"] != binding.WorldActorID {
			return nil, canonicalProblem(http.StatusUnprocessableEntity, "actorBindings does not match the stored actor identity")
		}
		if row.ControllerUserID == nil || oldProjectionObject["controllerId"] != row.ControllerUserID.String() {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored WorldState controller does not match the actor controller")
		}
		expectedKind, kindErr := canonicalWorldActorKind(row.ActorKind)
		if kindErr != nil || oldProjectionObject["kind"] != expectedKind {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored WorldState actor kind does not match the runtime actor kind")
		}
		oldWorldProjection, oldExists := oldWorld.actors[binding.WorldActorID]
		newWorldProjection, newExists := prepared.newWorld.actors[binding.WorldActorID]
		if !oldExists || !newExists {
			return nil, canonicalProblem(http.StatusUnprocessableEntity, "actorBindings must preserve the complete WorldState actor identity set")
		}
		newObject, ok := newWorldProjection.(map[string]any)
		if !ok || newObject["id"] != binding.WorldActorID {
			return nil, canonicalProblem(http.StatusUnprocessableEntity, "WorldState actor projection id is inconsistent")
		}
		if newObject["controllerId"] != row.ControllerUserID.String() {
			return nil, canonicalProblem(http.StatusForbidden, "canonical transition cannot reassign actor control")
		}
		if newObject["kind"] != expectedKind {
			return nil, canonicalProblem(http.StatusUnprocessableEntity, "canonical transition cannot change actor kind")
		}
		oldWorldCanonical, err := canonicalJSON(oldWorldProjection)
		if err != nil || !bytes.Equal(oldWorldCanonical, oldProjectionCanonical) {
			return nil, canonicalProblem(http.StatusInternalServerError, "stored actor projection does not match the base WorldState")
		}
		newCanonical, err := canonicalJSON(newWorldProjection)
		if err != nil {
			return nil, canonicalProblem(http.StatusUnprocessableEntity, "WorldState actor projection cannot be canonicalized")
		}
		changed := !bytes.Equal(oldWorldCanonical, newCanonical)
		if changed && binding.ActorID != prepared.request.SourceActorID {
			if _, declaredTarget := targets[binding.ActorID]; !declaredTarget {
				return nil, canonicalProblem(http.StatusForbidden, "transition changes an actor that is neither source nor a declared target")
			}
		}
		if changed && !canonicalMemberMayMutateActor(members[userID], userID, row) {
			return nil, canonicalProblem(http.StatusForbidden, "client semantics cannot mutate an actor controlled by another member")
		}
		seenWorld[binding.WorldActorID] = struct{}{}
		updates = append(updates, canonicalProjectionUpdate{
			actorID: binding.ActorID, canonical: newCanonical,
			stateHash: canonicalSHA256(newCanonical),
		})
	}
	if len(seenWorld) != len(prepared.newWorld.actors) {
		return nil, canonicalProblem(http.StatusUnprocessableEntity, "actorBindings does not cover all WorldState actors")
	}
	return updates, nil
}

func loadIdempotentCanonicalResult(
	tx *gorm.DB,
	sessionID uuid.UUID,
	userID uuid.UUID,
	prepared canonicalPreparedRequest,
	response *canonicalTransitionResponse,
) (bool, error) {
	var command struct {
		ControllerUserID     uuid.UUID       `gorm:"column:controller_user_id"`
		RequestHash          string          `gorm:"column:request_hash"`
		Status               string          `gorm:"column:status"`
		ResultBody           json.RawMessage `gorm:"column:result_body"`
		ResultCanonicalBytes []byte          `gorm:"column:result_canonical_bytes"`
		ResultHash           *string         `gorm:"column:result_hash"`
	}
	result := tx.Raw(`
		SELECT controller_user_id, request_hash, status, result_body,
			result_canonical_bytes, result_hash
		FROM game_commands WHERE session_id = ? AND command_id = ?
	`, sessionID, prepared.request.CommandID).Scan(&command)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}
	if command.ControllerUserID != userID || command.RequestHash != prepared.requestHash {
		return false, canonicalProblem(http.StatusConflict, "commandId was already used with different canonical input")
	}
	if command.Status != "committed" || command.ResultHash == nil || len(command.ResultBody) == 0 {
		return false, canonicalProblem(http.StatusConflict, "commandId is already in a non-committed state")
	}
	_, canonical, err := canonicalizeRawJSON(command.ResultBody)
	if err != nil || !bytes.Equal(canonical, command.ResultCanonicalBytes) || canonicalSHA256(canonical) != *command.ResultHash {
		return false, canonicalProblem(http.StatusInternalServerError, "stored canonical command result integrity failed")
	}
	if err = json.Unmarshal(canonical, response); err != nil {
		return false, canonicalProblem(http.StatusInternalServerError, "stored canonical command result is unreadable")
	}
	if response.SessionID != sessionID || response.CommandID != prepared.request.CommandID ||
		response.SemanticCommandID != prepared.request.SemanticCommandID ||
		response.RulesetReleaseID != prepared.request.RulesetReleaseID ||
		response.RulesArtifactHash != prepared.request.RulesArtifactHash ||
		response.SerializerVersion != prepared.request.SerializerVersion ||
		response.StateHash != prepared.request.StateHash ||
		response.SemanticAuthority != canonicalTransportAuthority ||
		response.SchemaValidation != canonicalTransportSchemaValidation {
		return false, canonicalProblem(http.StatusInternalServerError, "stored canonical command result envelope is inconsistent")
	}
	return true, nil
}

func nextCanonicalEventSeq(tx *gorm.DB, sessionID uuid.UUID) (int64, error) {
	var row struct {
		NextSeq int64 `gorm:"column:next_seq"`
	}
	if err := tx.Raw(`
		SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
		FROM game_events WHERE session_id = ?
	`, sessionID).Scan(&row).Error; err != nil {
		return 0, err
	}
	if row.NextSeq < 1 {
		return 0, canonicalProblem(http.StatusInternalServerError, "canonical event sequence is invalid")
	}
	return row.NextSeq, nil
}

type canonicalDecisionPlan struct {
	resolveExisting        *canonicalOpenDecisionRow
	openNew                *canonicalDecisionMetadata
	openAssignedController uuid.UUID
	pendingCanonical       []byte
	deadlineCanonical      []byte
	defaultCanonical       []byte
}

func prepareCanonicalDecisionPlan(
	tx *gorm.DB,
	session canonicalSessionRow,
	prepared canonicalPreparedRequest,
	oldWorld canonicalWorldView,
	actors map[uuid.UUID]canonicalSessionActorRow,
	members map[uuid.UUID]canonicalMemberAccess,
	userID uuid.UUID,
) (canonicalDecisionPlan, error) {
	var existing canonicalOpenDecisionRow
	result := tx.Raw(`
		SELECT request_id, resolution_id, deciding_actor_id, assigned_controller_user_id,
			request_body, canonical_bytes, request_hash
		FROM decision_requests
		WHERE session_id = ? AND status = 'open'
		FOR UPDATE
	`, session.ID).Scan(&existing)
	if result.Error != nil {
		return canonicalDecisionPlan{}, result.Error
	}
	hasExisting := result.RowsAffected == 1
	oldPendingCanonical, err := canonicalJSON(oldWorld.pendingResolution)
	if err != nil {
		return canonicalDecisionPlan{}, err
	}
	newPendingCanonical, err := canonicalJSON(prepared.newWorld.pendingResolution)
	if err != nil {
		return canonicalDecisionPlan{}, err
	}
	samePending := bytes.Equal(oldPendingCanonical, newPendingCanonical)
	if oldWorld.pendingResolution == nil && hasExisting {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusConflict, "decision ledger has an open request without pendingResolution")
	}
	if oldWorld.pendingResolution != nil {
		if !hasExisting {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusConflict, "pendingResolution has no open decision ledger row")
		}
		_, existingCanonical, err := canonicalizeRawJSON(existing.RequestBody)
		if err != nil || !bytes.Equal(existingCanonical, existing.CanonicalBytes) || canonicalSHA256(existingCanonical) != existing.RequestHash || !bytes.Equal(existingCanonical, oldPendingCanonical) {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusInternalServerError, "open decision ledger integrity failed")
		}
		resolutionID, requestID, worldActorID, identityErr := canonicalPendingDecisionIdentity(oldWorld.pendingResolution)
		if identityErr != nil || resolutionID != existing.ResolutionID || requestID != existing.RequestID {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusInternalServerError, "open decision identity does not match pendingResolution")
		}
		bindingWorldActorID, found := canonicalBindingWorldActorID(prepared.request.ActorBindings, existing.DecidingActorID)
		if !found || bindingWorldActorID != worldActorID {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusInternalServerError, "open decision actor does not match pendingResolution")
		}
	}
	if samePending {
		if prepared.request.Decision != nil {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "decision metadata is allowed only when pendingResolution changes")
		}
		return canonicalDecisionPlan{pendingCanonical: newPendingCanonical}, nil
	}

	plan := canonicalDecisionPlan{pendingCanonical: newPendingCanonical}
	if oldWorld.pendingResolution != nil {
		caller := members[userID]
		if existing.AssignedControllerUserID != userID && !caller.CanControlUnownedActors {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusForbidden, "only the assigned controller or an explicit GM may resolve pendingResolution")
		}
		if prepared.request.SourceActorID != existing.DecidingActorID && !caller.CanControlUnownedActors {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusForbidden, "decision resolution source must be the assigned deciding actor")
		}
		plan.resolveExisting = &existing
	}
	if prepared.newWorld.pendingResolution == nil {
		if prepared.request.Decision != nil {
			return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "resolved pendingResolution must not declare a new decision")
		}
		return plan, nil
	}
	metadata := prepared.request.Decision
	if metadata == nil {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "a new pendingResolution requires decision metadata")
	}
	actor, exists := actors[metadata.DecidingActorID]
	if !exists {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "decision decidingActorId is outside the active session")
	}
	allowedDecider := metadata.DecidingActorID == prepared.request.SourceActorID
	if !allowedDecider {
		for _, targetID := range prepared.request.TargetActorIDs {
			if metadata.DecidingActorID == targetID {
				allowedDecider = true
				break
			}
		}
	}
	if !allowedDecider {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusForbidden, "decision actor must be source or a declared target")
	}
	if actor.ControllerUserID == nil {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "decision actor has no controller")
	}
	assignedController := *actor.ControllerUserID
	if _, active := members[assignedController]; !active {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusForbidden, "decision controller is not an active session member")
	}
	resolutionID, requestID, pendingWorldActorID, identityErr := canonicalPendingDecisionIdentity(prepared.newWorld.pendingResolution)
	if identityErr != nil || resolutionID != metadata.ResolutionID || requestID != metadata.RequestID {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "decision metadata does not exactly match pendingResolution identity")
	}
	bindingWorldActorID, found := canonicalBindingWorldActorID(prepared.request.ActorBindings, metadata.DecidingActorID)
	if !found || bindingWorldActorID != pendingWorldActorID {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusUnprocessableEntity, "decision actor does not match pendingResolution.request.actorId")
	}
	if hasExisting && (existing.RequestID == metadata.RequestID || existing.ResolutionID == metadata.ResolutionID) {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusConflict, "replacement decision must use new request and resolution identities")
	}
	// A request/resolution identity is durable for the lifetime of a session,
	// including after its row is resolved. The unique constraints are retained
	// as a concurrent-write backstop, while this preflight returns the expected
	// conflict without using a database exception as ordinary control flow.
	var identityAlreadyUsed bool
	if err := tx.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM decision_requests
			WHERE session_id = ?
				AND (request_id = ? OR resolution_id = ?)
		) AS identity_already_used
	`, session.ID, metadata.RequestID, metadata.ResolutionID).Scan(&identityAlreadyUsed).Error; err != nil {
		return canonicalDecisionPlan{}, err
	}
	if identityAlreadyUsed {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusConflict, "decision request or resolution identity was already used in this session")
	}
	deadline, err := optionalCanonicalJSON(metadata.Deadline)
	if err != nil {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusBadRequest, "decision deadline contains invalid JSON")
	}
	defaultDecision, err := optionalCanonicalJSON(metadata.DefaultDecision)
	if err != nil {
		return canonicalDecisionPlan{}, canonicalProblem(http.StatusBadRequest, "decision defaultDecision contains invalid JSON")
	}
	plan.openNew = metadata
	plan.openAssignedController = assignedController
	plan.deadlineCanonical = deadline
	plan.defaultCanonical = defaultDecision
	return plan, nil
}

func optionalCanonicalJSON(raw json.RawMessage) ([]byte, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	_, canonical, err := canonicalizeRawJSON(raw)
	return canonical, err
}

func canonicalPendingDecisionIdentity(pending any) (resolutionID, requestID, actorID string, err error) {
	pendingObject, ok := pending.(map[string]any)
	if !ok {
		return "", "", "", errors.New("pendingResolution is not an object")
	}
	resolutionID, ok = pendingObject["id"].(string)
	if !ok || !validCanonicalStableID(resolutionID) {
		return "", "", "", errors.New("pendingResolution.id is invalid")
	}
	requestObject, ok := pendingObject["request"].(map[string]any)
	if !ok {
		return "", "", "", errors.New("pendingResolution.request is not an object")
	}
	requestID, ok = requestObject["id"].(string)
	if !ok || !validCanonicalStableID(requestID) {
		return "", "", "", errors.New("pendingResolution.request.id is invalid")
	}
	actorID, ok = requestObject["actorId"].(string)
	if !ok || actorID == "" || actorID != strings.TrimSpace(actorID) || len(actorID) > 255 {
		return "", "", "", errors.New("pendingResolution.request.actorId is invalid")
	}
	return resolutionID, requestID, actorID, nil
}

func canonicalBindingWorldActorID(bindings []canonicalActorBinding, actorID uuid.UUID) (string, bool) {
	for _, binding := range bindings {
		if binding.ActorID == actorID {
			return binding.WorldActorID, true
		}
	}
	return "", false
}

func applyCanonicalDecisionPlan(
	tx *gorm.DB,
	session canonicalSessionRow,
	prepared canonicalPreparedRequest,
	plan canonicalDecisionPlan,
	eventSeq int64,
	now time.Time,
) (*canonicalDecisionResult, error) {
	if plan.resolveExisting != nil {
		update := tx.Exec(`
			UPDATE decision_requests
			SET status = 'resolved', resolved_by_command_id = ?, resolved_at = ?, updated_at = ?
			WHERE session_id = ? AND request_id = ? AND status = 'open'
		`, prepared.request.CommandID, now, now, session.ID, plan.resolveExisting.RequestID)
		if update.Error != nil {
			return nil, normalizeCanonicalDatabaseError(update.Error)
		}
		if update.RowsAffected != 1 {
			return nil, canonicalProblem(http.StatusConflict, "open decision changed concurrently")
		}
	}
	if plan.openNew != nil {
		deadline := any(nil)
		if plan.deadlineCanonical != nil {
			deadline = string(plan.deadlineCanonical)
		}
		defaultDecision := any(nil)
		if plan.defaultCanonical != nil {
			defaultDecision = string(plan.defaultCanonical)
		}
		metadata := plan.openNew
		if err := tx.Exec(`
			INSERT INTO decision_requests (
				id, session_id, request_id, resolution_id, source_command_id,
				ruleset_release_id, rules_artifact_hash, deciding_actor_id,
				assigned_controller_user_id, status, opened_seq, expected_revision,
				projection_seq, request_schema_version, serializer_version,
				request_body, canonical_bytes, request_hash, deadline,
				default_decision, created_at, updated_at
			) VALUES (
				?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?::jsonb,
				?, ?, ?::jsonb, ?::jsonb, ?, ?
			)
		`, uuid.New(), session.ID, metadata.RequestID, metadata.ResolutionID,
			prepared.request.CommandID, session.RulesetReleaseID,
			session.RulesArtifactHash, metadata.DecidingActorID,
			plan.openAssignedController, eventSeq, prepared.newWorld.revision,
			eventSeq, metadata.RequestSchemaVersion, session.SerializerVersion,
			string(plan.pendingCanonical), plan.pendingCanonical,
			canonicalSHA256(plan.pendingCanonical), deadline, defaultDecision,
			now, now).Error; err != nil {
			return nil, normalizeCanonicalDatabaseError(err)
		}
		return &canonicalDecisionResult{RequestID: metadata.RequestID, Status: "open"}, nil
	}
	if plan.resolveExisting != nil {
		return &canonicalDecisionResult{RequestID: plan.resolveExisting.RequestID, Status: "resolved"}, nil
	}
	if prepared.newWorld.pendingResolution != nil {
		// The unchanged pending request remains open.
		var existing canonicalOpenDecisionRow
		if err := tx.Raw(`
			SELECT request_id FROM decision_requests
			WHERE session_id = ? AND status = 'open'
		`, session.ID).Scan(&existing).Error; err != nil {
			return nil, err
		}
		return &canonicalDecisionResult{RequestID: existing.RequestID, Status: "open"}, nil
	}
	return nil, nil
}

func normalizeCanonicalDatabaseError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505":
			return canonicalProblem(http.StatusConflict, "canonical transition conflicts with an existing immutable record")
		case "23503", "23514", "22P02", "22003":
			return canonicalProblem(http.StatusUnprocessableEntity, "canonical transition violates the persisted WorldState contract")
		}
	}
	return err
}

func writeCanonicalError(c *gin.Context, err error) {
	var problem *canonicalHTTPError
	if errors.As(err, &problem) {
		c.JSON(problem.status, gin.H{"error": problem.message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "canonical session transition failed"})
}
