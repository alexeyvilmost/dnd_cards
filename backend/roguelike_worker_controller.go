package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"os"
)

func nonNilRoguelikeMap(value JSONMap) JSONMap {
	if value == nil {
		return JSONMap{}
	}
	return value
}

func applyTrustedRoguelikePatch(character *CharacterV3, patch JSONMap) error {
	allowed := map[string]bool{"current_hp": true, "resources": true, "max_resources": true, "active_effects": true,
		"inventory_items": true, "equipment": true, "turn_state": true, "runtime_revision": true}
	for key := range patch {
		if !allowed[key] {
			return fmt.Errorf("unexpected worker patch field")
		}
	}
	revision, ok := numberFromJSON(patch["runtime_revision"])
	if !ok || int64(revision) != character.RuntimeRevision+1 {
		return fmt.Errorf("invalid worker runtime revision")
	}
	data, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, character)
}

// Computation happens before taking write locks. The transaction compares both
// revisions, commits the private envelope and character together, then records
// the exact response under the original command id.
func (rc *RoguelikeController) trustedCombatCommand(c *gin.Context, runID, userID uuid.UUID, request RoguelikeCommandRequest, requestHash string) {
	receiptResponse := func(tx *gorm.DB) (JSONMap, bool, error) {
		var receipt RoguelikeCommandReceipt
		err := tx.Where("run_id = ? AND user_id = ? AND command_id = ?", runID, userID, request.CommandID).First(&receipt).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		if err != nil {
			return nil, false, err
		}
		if receipt.RequestHash != requestHash || receipt.CommandType != request.Type {
			return nil, false, roguelikeError(http.StatusConflict, "command_id_reused", "ID команды уже использован")
		}
		return receipt.Response, true, nil
	}
	if response, found, err := receiptResponse(rc.db); err != nil {
		writeRoguelikeError(c, err)
		return
	} else if found {
		c.JSON(http.StatusOK, response)
		return
	}
	run, err := ownedRoguelikeRun(rc.db, runID, userID, false)
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	fail := func(code, message string) { writeRoguelikeError(c, roguelikeError(http.StatusConflict, code, message)) }
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCombat || run.Character == nil {
		fail("combat_required", "активный бой не найден")
		return
	}
	if run.Revision != request.ExpectedRevision {
		fail("run_revision_conflict", "состояние забега изменилось")
		return
	}
	expectedCharacterRevision := run.Character.RuntimeRevision
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	var result *roguelikeWorkerResult
	catalog := run.CombatCatalog
	if request.Type == "initialize_combat" {
		if len(run.CombatEnvelope) > 0 || combatOutcome(run.Character) != "" {
			fail("combat_already_initialized", "бой уже начат; обновите страницу")
			return
		}
		seed, seedErr := newRoguelikeSeed()
		if seedErr != nil {
			writeRoguelikeError(c, seedErr)
			return
		}
		result, catalog, err = initializeRoguelikeWorker(c.Request.Context(), rc.db, client, run, seed)
	} else {
		if len(run.CombatEnvelope) == 0 {
			fail("trusted_combat_missing", "серверный бой не инициализирован")
			return
		}
		result, err = client.call(c.Request.Context(), "/transition", map[string]any{"artifactHash": run.CombatEnvelope["artifactHash"],
			"envelope": run.CombatEnvelope, "intent": request.Payload["intent"], "character": run.Character})
	}
	if err != nil {
		fail("combat_execution_failed", "не удалось выполнить команду боя; состояние не изменено")
		return
	}
	if err = applyTrustedRoguelikePatch(run.Character, result.Patch); err != nil {
		writeRoguelikeError(c, err)
		return
	}
	var response JSONMap
	err = rc.db.Transaction(func(tx *gorm.DB) error {
		locked, err := ownedRoguelikeRun(tx, runID, userID, true)
		if err != nil {
			return err
		}
		if previous, found, err := receiptResponse(tx); err != nil {
			return err
		} else if found {
			response = previous
			return nil
		}
		var character CharacterV3
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", run.CharacterID).First(&character).Error; err != nil {
			return err
		}
		if locked.Revision != request.ExpectedRevision || character.RuntimeRevision != expectedCharacterRevision {
			return roguelikeError(http.StatusConflict, "run_revision_conflict", "состояние боя изменилось в другой вкладке")
		}
		locked.Character = run.Character
		locked.CombatEnvelope = result.Envelope
		locked.CombatCatalog = catalog
		locked.Revision++
		if err = tx.Omit("User", "Group").Save(locked.Character).Error; err != nil {
			return err
		}
		if err = saveRoguelikeRun(tx, locked); err != nil {
			return err
		}
		accepted, err := ownedRoguelikeRun(tx, runID, userID, false)
		if err != nil {
			return err
		}
		response, err = roguelikeRunResponse(accepted)
		if err != nil {
			return err
		}
		return tx.Create(&RoguelikeCommandReceipt{RunID: runID, UserID: userID, CommandID: request.CommandID,
			CommandType: request.Type, RequestHash: requestHash, Response: response}).Error
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
