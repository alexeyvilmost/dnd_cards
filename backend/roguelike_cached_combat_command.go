package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var errCombatFrameUnavailable = errors.New("combat input cache unavailable")

type cachedCombatResponse struct {
	run     *RoguelikeRun
	receipt JSONMap
	err     error
}

type combatProjectionInput struct {
	ID              uuid.UUID `json:"id"`
	RuntimeRevision int64     `json:"runtime_revision"`
	TurnState       *JSONMap  `json:"turn_state"`
}

func compactCombatProjectionCharacter(character *CharacterV3) *combatProjectionInput {
	if character == nil {
		return nil
	}
	copy := combatProjectionInput{ID: character.ID, RuntimeRevision: character.RuntimeRevision, TurnState: character.TurnState}
	if character.TurnState != nil {
		turn := JSONMap{}
		for key, value := range *character.TurnState {
			if key != "solo_combat_v1" {
				turn[key] = value
			}
		}
		copy.TurnState = &turn
	}
	return &copy
}

type preparedCombatWorkerKey struct{}
type preparedCombatWorker struct {
	inputHash [32]byte
	result    *roguelikeWorkerResult
	err       error
}

func cachedCombatWorkerBody(run *RoguelikeRun, intent any, hash string) map[string]any {
	characters := []*combatProjectionInput{}
	for _, member := range run.Characters {
		characters = append(characters, compactCombatProjectionCharacter(member))
	}
	body := map[string]any{"artifactHash": run.CombatEnvelope["artifactHash"], "intent": intent, "character": compactCombatProjectionCharacter(run.Character), "characters": characters, "projectionInputVersion": 1}
	if hash != "" {
		body["frameKey"] = hash
	} else {
		body["envelope"] = run.CombatEnvelope
	}
	return body
}

func callCombatWorkerBody(ctx context.Context, client roguelikeWorkerClient, body map[string]any, run *RoguelikeRun, intent any) (*roguelikeWorkerResult, error) {
	if hash, ok := body["frameKey"].(string); ok && hash != "" {
		client.CombatBase = run.CombatEnvelope
		client.CombatBaseHash = hash
	}
	result, err := client.call(ctx, "/transition", body)
	if errors.Is(err, errCombatFrameUnavailable) {
		performanceAdd(ctx, "combat_worker_full_input_retry", 1)
		result, err = client.call(ctx, "/transition", map[string]any{"artifactHash": run.CombatEnvelope["artifactHash"], "envelope": run.CombatEnvelope, "intent": intent, "character": run.Character, "characters": run.Characters})
	}
	return result, err
}

func cachedCombatWorkerCall(ctx context.Context, client roguelikeWorkerClient, slot *combatCacheSlot, run *RoguelikeRun, intent any) (*roguelikeWorkerResult, error) {
	_, hash := slot.frame()
	body := cachedCombatWorkerBody(run, intent, hash)
	if prepared, ok := ctx.Value(preparedCombatWorkerKey{}).(*preparedCombatWorker); ok {
		input, err := json.Marshal(body)
		if err == nil && sha256.Sum256(input) == prepared.inputHash {
			performanceAdd(ctx, "combat_compute_overlap_hit", 1)
			return prepared.result, prepared.err
		}
	}
	return callCombatWorkerBody(ctx, client, body, run, intent)
}

// Compute a pure transition while the preceding acknowledged command commits.
// Acceptance still waits for that commit and the ordinary owner/revision locks.
// Reuse requires identical complete worker input, not just the run revision.
func (rc *RoguelikeController) preparePendingCombat(c *gin.Context, id, owner uuid.UUID, request RoguelikeCommandRequest) {
	if request.Type != "combat_intent" {
		return
	}
	rc.combatCache.mu.Lock()
	slot := rc.combatCache.slots[combatCacheKey(id, owner)]
	rc.combatCache.mu.Unlock()
	if slot == nil {
		return
	}
	slot.mu.Lock()
	if slot.pending == nil || slot.failure || slot.run == nil || slot.hash == "" || slot.run.Revision != request.ExpectedRevision || slot.run.UserID != owner || slot.run.Phase != RoguelikePhaseCombat || slot.run.Status != RoguelikeStatusActive {
		slot.mu.Unlock()
		return
	}
	run, hash := cloneCachedCombatRun(slot.run), slot.hash
	slot.mu.Unlock()
	intent := request.Payload["intent"]
	body := cachedCombatWorkerBody(run, intent, hash)
	input, err := json.Marshal(body)
	if err != nil {
		return
	}
	ctx := c.Request.Context()
	done := performanceSince(ctx, "combat_compute_overlap_ms")
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	result, err := callCombatWorkerBody(ctx, client, body, run, intent)
	done()
	prepared := &preparedCombatWorker{inputHash: sha256.Sum256(input), result: result, err: err}
	c.Request = c.Request.WithContext(context.WithValue(ctx, preparedCombatWorkerKey{}, prepared))
}

func (rc *RoguelikeController) cachedCombatCommand(c *gin.Context, slot *combatCacheSlot, id, owner uuid.UUID, request RoguelikeCommandRequest, requestHash string) {
	ctx := c.Request.Context()
	db := rc.db.WithContext(ctx)
	slot.mu.Lock()
	previousID, previousHash := slot.commandID, slot.requestHash
	var previousRun *RoguelikeRun
	if slot.receiptRun != nil {
		previousRun = cloneCachedCombatRun(slot.receiptRun)
	}
	wireBase, wireID := previousRun, previousID.String()
	if slot.readBase != nil && c.GetHeader("X-Combat-Base") == slot.readBaseID {
		wireBase, wireID = cloneCachedCombatRun(slot.readBase), slot.readBaseID
	}
	slot.mu.Unlock()
	if wireBase != nil {
		c.Set("combat_wire_base_run", wireBase)
		c.Set("combat_wire_base_command_id", wireID)
	}
	if previousID == request.CommandID {
		if previousHash != requestHash {
			writeRoguelikeError(c, roguelikeError(409, "command_id_reused", "ID команды уже использован"))
			return
		}
		if previousRun != nil {
			performanceAdd(ctx, "combat_receipt_cache_hit", 1)
			writeCombatRunResponse(c, previousRun)
			return
		}
	}
	var receipt RoguelikeCommandReceipt
	if err := db.Where("run_id=? AND user_id=? AND command_id=?", id, owner, request.CommandID).First(&receipt).Error; err == nil {
		if receipt.CommandType != request.Type || receipt.RequestHash != requestHash {
			writeRoguelikeError(c, roguelikeError(409, "command_id_reused", "ID команды уже использован"))
			return
		}
		c.JSON(http.StatusOK, receipt.Response)
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		writeRoguelikeError(c, err)
		return
	}
	run, err := slot.load(db, id, owner, false)
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	if err = urvinCommandAllowed(run, request.Type); err != nil {
		writeRoguelikeError(c, err)
		return
	}
	if run.Character == nil || run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCombat || run.Revision != request.ExpectedRevision || len(run.CombatEnvelope) == 0 {
		writeRoguelikeError(c, roguelikeError(409, "run_revision_conflict", "Состояние боя изменилось; обновите страницу"))
		return
	}
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	result, err := cachedCombatWorkerCall(ctx, client, slot, run, request.Payload["intent"])
	if err != nil {
		if rejection := publicRoguelikeWorkerFailure(err); rejection != nil {
			writeRoguelikeError(c, roguelikeError(409, rejection.Code, rejection.Message))
		} else {
			writeRoguelikeError(c, roguelikeError(503, "combat_execution_failed", "Действие не применено"))
		}
		return
	}
	if result.GoldSpent != 0 || result.ElapsedSeconds != 0 {
		writeRoguelikeError(c, roguelikeError(409, "combat_patch_invalid", "Некорректный результат боя"))
		return
	}
	afterHash, valid := result.Trace["afterHash"].(string)
	beforeHash, beforeValid := result.Trace["beforeHash"].(string)
	entropy, entropyValid := result.Envelope["entropy"].(map[string]any)
	seed, seedValid := entropy["seed"].(string)
	if !valid || !roguelikeSnapshotHash.MatchString(afterHash) || !beforeValid || !roguelikeSnapshotHash.MatchString(beforeHash) || result.Envelope["artifactHash"] != run.CombatEnvelope["artifactHash"] || !entropyValid || !seedValid || seed == "" {
		writeRoguelikeError(c, errors.New("invalid combat trace"))
		return
	}
	selectedColumns := map[uuid.UUID][]string{}
	expected := map[uuid.UUID]int64{}
	expectedUpdated := map[uuid.UUID]time.Time{}
	for _, member := range roguelikeCharacters(run) {
		expected[member.ID] = member.RuntimeRevision
		expectedUpdated[member.ID] = member.UpdatedAt
		patch := result.Patch
		if len(run.Characters) > 1 {
			patch = result.Patches[member.ID.String()]
		}
		if patch == nil {
			writeRoguelikeError(c, roguelikeError(409, "combat_patch_invalid", "Движок не вернул участника"))
			return
		}
		if err = applyTrustedRoguelikePatch(member, patch); err != nil {
			writeRoguelikeError(c, err)
			return
		}
		columns := []string{"currency", "updated_at"}
		for key := range patch {
			columns = append(columns, key)
		}
		selectedColumns[member.ID] = columns
	}
	ready := make(chan cachedCombatResponse, 1)
	responseWritten := make(chan struct{})
	defer close(responseWritten)
	commitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	slot.mu.Lock()
	slot.pending = make(chan struct{})
	slot.mu.Unlock()
	combatPersistenceWG.Add(1)
	go func() {
		defer combatPersistenceWG.Done()
		defer cancel()
		started := time.Now()
		released := false
		var accepted *RoguelikeRun
		var replay JSONMap
		stamp := time.Now().UTC().Truncate(time.Microsecond)
		txDB := rc.db.WithContext(commitCtx).Session(&gorm.Session{NowFunc: func() time.Time { return stamp }})
		err := performanceTransaction(txDB, commitCtx, func(tx *gorm.DB) error {
			locked, err := slot.load(tx, id, owner, true)
			if err != nil {
				return err
			}
			// Another instance can finish this command while computation is in
			// flight. Receipt lookup under the run lock precedes revision rejection.
			var prior RoguelikeCommandReceipt
			if err := tx.Where("run_id=? AND user_id=? AND command_id=?", id, owner, request.CommandID).First(&prior).Error; err == nil {
				if prior.RequestHash != requestHash || prior.CommandType != request.Type {
					return roguelikeError(409, "command_id_reused", "ID команды уже использован")
				}
				replay = prior.Response
				return nil
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if locked.Revision != request.ExpectedRevision {
				return roguelikeError(409, "run_revision_conflict", "Состояние боя изменилось")
			}
			for _, member := range roguelikeCharacters(locked) {
				if member.RuntimeRevision != expected[member.ID] || !member.UpdatedAt.Equal(expectedUpdated[member.ID]) {
					return roguelikeError(409, "party_revision_conflict", "Лист участника изменился")
				}
			}
			// All affected rows are locked before publishing. Competing backend
			// instances/external sheet writes cannot accept the same base revision.
			locked.Character = run.Character
			locked.Characters = run.Characters
			locked.CombatEnvelope = result.Envelope
			state, ok := result.Envelope["state"].(map[string]any)
			if !ok {
				return errors.New("invalid combat state")
			}
			locked.CombatState = JSONMap(state)
			syncUrvinAura(locked)
			setCharacterGold(locked.Character, locked.Gold)
			applyTrustedCombatConclusion(locked)
			locked.Revision++
			locked.UpdatedAt = stamp.In(locked.UpdatedAt.Location())
			for _, member := range roguelikeCharacters(locked) {
				member.UpdatedAt = stamp.In(expectedUpdated[member.ID].Location())
			}
			accepted = cloneCachedCombatRun(locked)
			// Outcome/economy boundaries always wait for a durable commit.
			async := locked.Status == RoguelikeStatusActive && state["outcome"] == "active"
			if async {
				slot.setFrame(accepted, result.Trace["afterHash"].(string))
				slot.mu.Lock()
				slot.commandID = request.CommandID
				slot.requestHash = requestHash
				slot.receiptRun = cloneCachedCombatRun(accepted)
				slot.mu.Unlock()
				performanceAdd(ctx, "combat_async_response", 1)
				released = true
				ready <- cachedCombatResponse{run: accepted}
				select {
				case <-responseWritten:
				case <-commitCtx.Done():
					return commitCtx.Err()
				}
			}
			receipt := &RoguelikeCommandReceipt{RunID: id, UserID: owner, CommandID: request.CommandID, CommandType: request.Type, RequestHash: requestHash, Response: JSONMap{"run": accepted}, Request: nonNilRoguelikeMap(request.Payload), omitResponseReload: true}
			joinEncoding := receipt.prepareStorage(commitCtx)
			defer joinEncoding()
			if err = saveRoguelikeParty(tx, locked, selectedColumns); err != nil {
				return err
			}
			if err = saveRoguelikeRun(tx, locked); err != nil {
				return err
			}
			if err = appendRoguelikeCombatEvent(tx, locked, request, run.CombatEnvelope, result); err != nil {
				return err
			}
			doneEncodingWait := performanceSince(commitCtx, "receipt_encode_wait_ms")
			err = joinEncoding()
			doneEncodingWait()
			if err != nil {
				return err
			}
			return tx.Create(receipt).Error
		})
		if err == nil && accepted != nil {
			slot.setFrame(accepted, afterHash)
			slot.mu.Lock()
			slot.commandID = request.CommandID
			slot.requestHash = requestHash
			slot.receiptRun = cloneCachedCombatRun(accepted)
			slot.mu.Unlock()
		}
		requestID, _ := ctx.Value(requestCorrelationKey{}).(string)
		slot.finish(err, started, requestID, released, commitCtx)
		if !released {
			ready <- cachedCombatResponse{run: accepted, receipt: replay, err: err}
		}
	}()
	select {
	case response := <-ready:
		if response.err != nil {
			writeRoguelikeError(c, response.err)
			return
		}
		if response.receipt != nil {
			c.Header("X-Combat-Persistence", "saved")
			c.JSON(http.StatusOK, response.receipt)
			return
		}
		slot.mu.Lock()
		background := slot.pending != nil
		slot.mu.Unlock()
		status := "saved"
		if background {
			status = "background"
		}
		c.Header("X-Combat-Persistence", status)
		writeCombatRunResponse(c, response.run)
	case <-ctx.Done():
		return
	}
}
