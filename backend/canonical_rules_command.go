package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	maxCanonicalRulesCommandBodyBytes int64 = 128 << 10
	serverRulesRNGTapeLength                = 1024
)

type canonicalRulesCommandRequest struct {
	Command json.RawMessage `json:"command"`
}

type canonicalRulesCommandEnvelope struct {
	SchemaVersion      int    `json:"schemaVersion"`
	CommandID          string `json:"commandId"`
	ExpectedRevision   int64  `json:"expectedRevision"`
	RulesetContentHash string `json:"rulesetContentHash"`
	ActorID            string `json:"actorId"`
	Type               string `json:"type"`
}

type canonicalRulesRead struct {
	session  canonicalSessionRow
	world    canonicalWorldView
	actors   []canonicalSessionActorRow
	bindings []canonicalActorBinding
	source   canonicalSessionActorRow
}

func (controller *CanonicalSessionController) loadServerRulesCommandReceipt(
	ctx context.Context,
	sessionID uuid.UUID,
	userID uuid.UUID,
	commandID uuid.UUID,
	commandHash string,
) (canonicalTransitionResponse, bool, error) {
	var response canonicalTransitionResponse
	err := controller.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		members, err := activeCanonicalMembers(tx, sessionID, false)
		if err != nil {
			return err
		}
		caller, active := members[userID]
		if !active || caller.Role == "observer" {
			return canonicalProblem(http.StatusForbidden, "active non-observer session membership is required")
		}
		var stored struct {
			ControllerUserID     uuid.UUID       `gorm:"column:controller_user_id"`
			Status               string          `gorm:"column:status"`
			ExecutionInput       json.RawMessage `gorm:"column:execution_input"`
			ResultBody           json.RawMessage `gorm:"column:result_body"`
			ResultCanonicalBytes []byte          `gorm:"column:result_canonical_bytes"`
			ResultHash           *string         `gorm:"column:result_hash"`
		}
		result := tx.Raw(`
			SELECT controller_user_id, status, execution_input, result_body,
				result_canonical_bytes, result_hash
			FROM game_commands WHERE session_id = ? AND command_id = ?
		`, sessionID, commandID).Scan(&stored)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		if stored.ControllerUserID != userID {
			return canonicalProblem(http.StatusConflict, "commandId was already used by another controller")
		}
		var execution map[string]any
		if err = json.Unmarshal(stored.ExecutionInput, &execution); err != nil || execution["semanticCommandHash"] != commandHash {
			return canonicalProblem(http.StatusConflict, "commandId was already used with different semantic input")
		}
		if stored.Status != "committed" || stored.ResultHash == nil || len(stored.ResultBody) == 0 {
			return canonicalProblem(http.StatusConflict, "commandId is already in a non-committed state")
		}
		_, canonical, err := canonicalizeRawJSON(stored.ResultBody)
		if err != nil || !bytes.Equal(canonical, stored.ResultCanonicalBytes) || canonicalSHA256(canonical) != *stored.ResultHash {
			return canonicalProblem(http.StatusInternalServerError, "stored rules command result integrity failed")
		}
		if err = json.Unmarshal(canonical, &response); err != nil ||
			response.SessionID != sessionID || response.CommandID != commandID ||
			response.SemanticAuthority != rulesWorkerAuthority ||
			response.SchemaValidation != rulesWorkerSchemaValidation || len(response.Snapshot) == 0 {
			return canonicalProblem(http.StatusInternalServerError, "stored rules command result envelope is inconsistent")
		}
		response.Idempotent = true
		return nil
	})
	if err != nil {
		return canonicalTransitionResponse{}, false, err
	}
	return response, response.CommandID != uuid.Nil, nil
}

func decodeCanonicalRulesCommand(body io.Reader) (canonicalRulesCommandRequest, canonicalRulesCommandEnvelope, []byte, error) {
	var request canonicalRulesCommandRequest
	var envelope canonicalRulesCommandEnvelope
	raw, err := io.ReadAll(io.LimitReader(body, maxCanonicalRulesCommandBodyBytes+1))
	if err != nil || int64(len(raw)) > maxCanonicalRulesCommandBodyBytes {
		return request, envelope, nil, canonicalProblem(http.StatusRequestEntityTooLarge, "rules command body is too large")
	}
	root, _, err := canonicalizeRawJSON(raw)
	if err != nil {
		return request, envelope, nil, canonicalProblem(http.StatusBadRequest, "rules command contains invalid or ambiguous JSON")
	}
	object, ok := root.(map[string]any)
	if !ok || len(object) != 1 || object["command"] == nil {
		return request, envelope, nil, canonicalProblem(http.StatusBadRequest, "rules command body must contain exactly command")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&request); err != nil || requireJSONEOF(decoder) != nil || len(request.Command) == 0 {
		return request, envelope, nil, canonicalProblem(http.StatusBadRequest, "rules command envelope is invalid")
	}
	commandValue, commandCanonical, err := canonicalizeRawJSON(request.Command)
	if err != nil {
		return request, envelope, nil, canonicalProblem(http.StatusBadRequest, "command contains invalid or ambiguous JSON")
	}
	if _, ok = commandValue.(map[string]any); !ok {
		return request, envelope, nil, canonicalProblem(http.StatusBadRequest, "command must be an object")
	}
	commandDecoder := json.NewDecoder(bytes.NewReader(commandCanonical))
	if err = commandDecoder.Decode(&envelope); err != nil || requireJSONEOF(commandDecoder) != nil {
		return request, envelope, nil, canonicalProblem(http.StatusBadRequest, "command common envelope is invalid")
	}
	commandID, parseErr := uuid.Parse(envelope.CommandID)
	if parseErr != nil || commandID == uuid.Nil || envelope.SchemaVersion != 1 ||
		envelope.ExpectedRevision < 0 || !canonicalTransportSHA256Pattern.MatchString(envelope.RulesetContentHash) ||
		!validCanonicalStableID(envelope.ActorID) || !validCanonicalStableID(envelope.Type) {
		return request, envelope, nil, canonicalProblem(http.StatusUnprocessableEntity, "command common envelope is invalid")
	}
	request.Command = append(json.RawMessage(nil), commandCanonical...)
	return request, envelope, commandCanonical, nil
}

func deterministicServerRNGTape(commandID string) ([]uint32, error) {
	secret := strings.TrimSpace(os.Getenv("RULES_RNG_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("RULES_WORKER_SECRET"))
	}
	if secret == "" {
		if os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production" {
			return nil, errors.New("RULES_RNG_SECRET is required for server authority")
		}
		secret = "local-development-rules-rng"
	}
	tape := make([]uint32, 0, serverRulesRNGTapeLength)
	for counter := uint32(0); len(tape) < serverRulesRNGTapeLength; counter++ {
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(commandID))
		var count [4]byte
		binary.BigEndian.PutUint32(count[:], counter)
		_, _ = mac.Write(count[:])
		digest := mac.Sum(nil)
		for offset := 0; offset+4 <= len(digest) && len(tape) < serverRulesRNGTapeLength; offset += 4 {
			tape = append(tape, binary.BigEndian.Uint32(digest[offset:offset+4]))
		}
	}
	return tape, nil
}

func (controller *CanonicalSessionController) readServerRulesCommand(
	ctx context.Context,
	sessionID uuid.UUID,
	userID uuid.UUID,
	envelope canonicalRulesCommandEnvelope,
) (canonicalRulesRead, error) {
	var read canonicalRulesRead
	err := controller.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Raw(`
			SELECT id, ruleset_release_id, rules_artifact_hash, mode, authority_mode,
				status, current_snapshot, snapshot_canonical_bytes,
				snapshot_schema_version, serializer_version, snapshot_seq, revision, state_hash
			FROM game_sessions WHERE id = ? FOR SHARE
		`, sessionID).Scan(&read.session)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return canonicalProblem(http.StatusNotFound, "canonical session was not found")
		}
		members, err := activeCanonicalMembers(tx, sessionID, false)
		if err != nil {
			return err
		}
		caller, member := members[userID]
		if !member || caller.Role == "observer" {
			return canonicalProblem(http.StatusForbidden, "active non-observer session membership is required")
		}
		if read.session.Status != "active" || read.session.AuthorityMode != "server" {
			return canonicalProblem(http.StatusConflict, "rules commands require an active server-authority session")
		}
		read.world, _, err = verifyStoredCanonicalSession(read.session)
		if err != nil {
			return err
		}
		if err = verifyCanonicalSnapshotHead(tx, read.session); err != nil {
			return err
		}
		read.actors, err = loadCanonicalActors(tx, sessionID, false)
		if err != nil {
			return err
		}
		read.bindings, err = inferCanonicalActorBindings(read.actors, read.world)
		if err != nil {
			return err
		}
		for _, binding := range read.bindings {
			if binding.WorldActorID != envelope.ActorID {
				continue
			}
			for _, actor := range read.actors {
				if actor.ID == binding.ActorID {
					read.source = actor
				}
			}
		}
		if read.source.ID == uuid.Nil || read.source.ControllerUserID == nil || *read.source.ControllerUserID != userID {
			return canonicalProblem(http.StatusForbidden, "the authenticated member does not control command actorId")
		}
		ruleset, ok := read.world.root["ruleset"].(map[string]any)
		contentHash, hashOK := ruleset["contentHash"].(string)
		if !ok || !hashOK {
			return canonicalProblem(http.StatusInternalServerError, "stored WorldState ruleset is invalid")
		}
		if envelope.ExpectedRevision != read.session.Revision || envelope.RulesetContentHash != contentHash {
			return canonicalProblem(http.StatusConflict, "rules command is stale or targets another rules release")
		}
		return nil
	})
	return read, err
}

func changedCanonicalActorTargets(
	oldWorld canonicalWorldView,
	newWorld canonicalWorldView,
	bindings []canonicalActorBinding,
	sourceActorID uuid.UUID,
) ([]uuid.UUID, error) {
	worldToDatabase := make(map[string]uuid.UUID, len(bindings))
	for _, binding := range bindings {
		worldToDatabase[binding.WorldActorID] = binding.ActorID
	}
	var targets []uuid.UUID
	for worldActorID, oldActor := range oldWorld.actors {
		newActor, exists := newWorld.actors[worldActorID]
		if !exists {
			continue
		}
		oldCanonical, err := canonicalJSON(oldActor)
		if err != nil {
			return nil, err
		}
		newCanonical, err := canonicalJSON(newActor)
		if err != nil {
			return nil, err
		}
		databaseID, mapped := worldToDatabase[worldActorID]
		if !mapped {
			return nil, canonicalProblem(http.StatusInternalServerError, "rules worker actor has no database binding")
		}
		if databaseID != sourceActorID && !bytes.Equal(oldCanonical, newCanonical) {
			targets = append(targets, databaseID)
		}
	}
	return targets, nil
}

func serverActorLifecycle(
	oldWorld canonicalWorldView,
	newWorld canonicalWorldView,
	actors []canonicalSessionActorRow,
	bindings []canonicalActorBinding,
	sourceActorID uuid.UUID,
) ([]canonicalActorBinding, []canonicalServerActorCreate, []uuid.UUID, error) {
	rowsByID := make(map[uuid.UUID]canonicalSessionActorRow, len(actors))
	worldToRow := make(map[string]canonicalSessionActorRow, len(bindings))
	for _, row := range actors {
		rowsByID[row.ID] = row
	}
	for _, binding := range bindings {
		worldToRow[binding.WorldActorID] = rowsByID[binding.ActorID]
	}
	nextBindings := append([]canonicalActorBinding(nil), bindings...)
	creates := make([]canonicalServerActorCreate, 0)
	removals := make([]uuid.UUID, 0)
	for worldActorID, rawActor := range newWorld.actors {
		if _, existed := oldWorld.actors[worldActorID]; existed {
			continue
		}
		actor, ok := rawActor.(map[string]any)
		familiar, familiarOK := actor["familiarState"].(map[string]any)
		ownerWorldID, ownerOK := familiar["ownerActorId"].(string)
		ownerRow, mapped := worldToRow[ownerWorldID]
		if !ok || actor["kind"] != "summonedActor" || !familiarOK || !ownerOK || !mapped ||
			ownerRow.ID != sourceActorID || ownerRow.OwnerUserID == nil || ownerRow.ControllerUserID == nil ||
			actor["controllerId"] != ownerRow.ControllerUserID.String() {
			return nil, nil, nil, canonicalProblem(http.StatusUnprocessableEntity, "rules worker added an invalid or unowned summoned actor")
		}
		projection, err := canonicalJSON(actor)
		if err != nil {
			return nil, nil, nil, err
		}
		databaseID := uuid.New()
		creates = append(creates, canonicalServerActorCreate{
			ActorID: databaseID, WorldActorID: worldActorID,
			OwnerUserID: *ownerRow.OwnerUserID, ControllerUserID: *ownerRow.ControllerUserID,
			Projection: projection,
		})
		nextBindings = append(nextBindings, canonicalActorBinding{
			ActorID: databaseID, WorldActorID: worldActorID,
		})
	}
	removedWorld := make(map[string]struct{})
	for worldActorID := range oldWorld.actors {
		if _, remains := newWorld.actors[worldActorID]; remains {
			continue
		}
		row, mapped := worldToRow[worldActorID]
		oldActor, ok := oldWorld.actors[worldActorID].(map[string]any)
		familiar, familiarOK := oldActor["familiarState"].(map[string]any)
		ownerWorldID, ownerOK := familiar["ownerActorId"].(string)
		ownerRow, ownerMapped := worldToRow[ownerWorldID]
		if !mapped || row.ActorKind != "summoned_actor" || !ok || !familiarOK || !ownerOK ||
			!ownerMapped || ownerRow.ID != sourceActorID {
			return nil, nil, nil, canonicalProblem(http.StatusUnprocessableEntity, "rules worker removed an actor outside the source familiar lifecycle")
		}
		removals = append(removals, row.ID)
		removedWorld[worldActorID] = struct{}{}
	}
	if len(removedWorld) > 0 {
		kept := nextBindings[:0]
		for _, binding := range nextBindings {
			if _, removed := removedWorld[binding.WorldActorID]; !removed {
				kept = append(kept, binding)
			}
		}
		nextBindings = kept
	}
	sort.Slice(nextBindings, func(i, j int) bool {
		return nextBindings[i].ActorID.String() < nextBindings[j].ActorID.String()
	})
	return nextBindings, creates, removals, nil
}

func serverDecisionMetadata(
	oldWorld canonicalWorldView,
	newWorld canonicalWorldView,
	bindings []canonicalActorBinding,
) (*canonicalDecisionMetadata, error) {
	oldPending, err := canonicalJSON(oldWorld.pendingResolution)
	if err != nil {
		return nil, err
	}
	newPending, err := canonicalJSON(newWorld.pendingResolution)
	if err != nil || bytes.Equal(oldPending, newPending) || newWorld.pendingResolution == nil {
		return nil, err
	}
	resolutionID, requestID, worldActorID, err := canonicalPendingDecisionIdentity(newWorld.pendingResolution)
	if err != nil {
		return nil, canonicalProblem(http.StatusUnprocessableEntity, "rules worker returned invalid pending decision identity")
	}
	for _, binding := range bindings {
		if binding.WorldActorID == worldActorID {
			return &canonicalDecisionMetadata{
				RequestID: requestID, ResolutionID: resolutionID,
				DecidingActorID: binding.ActorID, RequestSchemaVersion: 1,
			}, nil
		}
	}
	return nil, canonicalProblem(http.StatusUnprocessableEntity, "rules worker pending decision actor has no binding")
}

func (controller *CanonicalSessionController) ApplyRulesCommand(c *gin.Context) {
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
	_, envelope, commandCanonical, err := decodeCanonicalRulesCommand(c.Request.Body)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	commandID := uuid.MustParse(envelope.CommandID)
	commandHash := canonicalSHA256(commandCanonical)
	if receipt, found, receiptErr := controller.loadServerRulesCommandReceipt(
		c.Request.Context(), sessionID, userID, commandID, commandHash,
	); receiptErr != nil {
		writeCanonicalError(c, receiptErr)
		return
	} else if found {
		c.JSON(http.StatusOK, receipt)
		return
	}
	read, err := controller.readServerRulesCommand(c.Request.Context(), sessionID, userID, envelope)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	tape, err := deterministicServerRNGTape(envelope.CommandID)
	if err != nil {
		writeCanonicalError(c, canonicalProblem(http.StatusServiceUnavailable, err.Error()))
		return
	}
	workerResult, err := controller.worker.Execute(c.Request.Context(), rulesWorkerExecuteRequest{
		ProtocolVersion:   rulesWorkerProtocolVersion,
		RulesArtifactHash: read.session.RulesArtifactHash,
		BaseStateHash:     read.session.StateHash,
		World:             append(json.RawMessage(nil), read.session.SnapshotCanonicalBytes...),
		Command:           append(json.RawMessage(nil), commandCanonical...), RNGTape: tape,
	})
	if err != nil {
		writeCanonicalError(c, canonicalProblem(http.StatusServiceUnavailable, err.Error()))
		return
	}
	if workerResult.Status == "rejected" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"status": "rejected", "code": workerResult.Code, "error": workerResult.Message,
			"semanticAuthority": rulesWorkerAuthority,
			"schemaValidation":  rulesWorkerSchemaValidation,
			"stateHash":         workerResult.StateHash,
		})
		return
	}
	nextValue, nextCanonical, err := canonicalizeRawJSON(workerResult.NextState)
	if err != nil || canonicalSHA256(nextCanonical) != workerResult.StateHash {
		writeCanonicalError(c, canonicalProblem(http.StatusBadGateway, "rules worker returned a state with invalid canonical hash"))
		return
	}
	nextWorld, err := inspectCanonicalWorld(nextValue)
	if err != nil {
		writeCanonicalError(c, canonicalProblem(http.StatusBadGateway, "rules worker returned an invalid WorldState"))
		return
	}
	targets, err := changedCanonicalActorTargets(read.world, nextWorld, read.bindings, read.source.ID)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	bindings, creates, removals, err := serverActorLifecycle(
		read.world, nextWorld, read.actors, read.bindings, read.source.ID,
	)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	decision, err := serverDecisionMetadata(read.world, nextWorld, read.bindings)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	eventMetadata, err := json.Marshal(map[string]any{
		"engineVersion": workerResult.EngineVersion,
		"eventHash":     workerResult.EventHash,
		"rngConsumed":   workerResult.RNGConsumed,
		"events":        workerResult.Events,
	})
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	transport := canonicalTransitionRequest{
		CommandID: uuid.MustParse(envelope.CommandID), SemanticCommandID: envelope.CommandID,
		RulesetReleaseID:  read.session.RulesetReleaseID,
		RulesArtifactHash: read.session.RulesArtifactHash,
		SourceActorID:     read.source.ID, TargetActorIDs: targets,
		ExpectedRevision: read.session.Revision, BaseSnapshotSeq: read.session.SnapshotSeq,
		BaseStateHash:         read.session.StateHash,
		SnapshotSchemaVersion: read.session.SnapshotSchemaVersion,
		SerializerVersion:     read.session.SerializerVersion,
		StateHash:             workerResult.StateHash, Snapshot: json.RawMessage(nextCanonical),
		ActorBindings: bindings, EventMetadata: eventMetadata, Decision: decision,
	}
	transportBody, err := json.Marshal(transport)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	c.Set(canonicalExecutionProfileKey, canonicalExecutionProfile{
		serverVerified: true, engineVersion: workerResult.EngineVersion,
		events:              append(json.RawMessage(nil), workerResult.Events...),
		semanticCommand:     append(json.RawMessage(nil), commandCanonical...),
		semanticCommandHash: commandHash,
		actorCreates:        creates,
		actorRemovals:       removals,
	})
	c.Request.Body = io.NopCloser(bytes.NewReader(transportBody))
	c.Request.ContentLength = int64(len(transportBody))
	controller.ApplyTransition(c)
}
