package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// No projection, resource update or catalog replacement is allowed at this
// boundary. The retained preceding frame is recorded as part of the event.
func validateCombatRulesUpgrade(before JSONMap, result *roguelikeWorkerResult) error {
	if result == nil || len(result.RandomValues) != 0 || len(result.Patch) != 0 || len(result.Patches) != 0 || result.GoldSpent != 0 || result.ElapsedSeconds != 0 || len(result.Events) != 0 {
		return fmt.Errorf("rules upgrade changed gameplay")
	}
	oldHash, _ := before["artifactHash"].(string)
	newHash, _ := result.Envelope["artifactHash"].(string)
	if !roguelikeSnapshotHash.MatchString(oldHash) || !roguelikeSnapshotHash.MatchString(newHash) || oldHash == newHash || result.ArtifactHash != newHash {
		return fmt.Errorf("invalid rules upgrade identity")
	}
	copyAfter := JSONMap{}
	for key, value := range result.Envelope {
		copyAfter[key] = value
	}
	copyAfter["artifactHash"] = oldHash
	a, err := json.Marshal(before)
	if err != nil {
		return err
	}
	b, err := json.Marshal(copyAfter)
	if err != nil || !bytes.Equal(a, b) {
		return fmt.Errorf("rules upgrade changed saved frame")
	}
	return nil
}

func (rc *RoguelikeController) upgradeCombatRulesCommand(c *gin.Context, run *RoguelikeRun, request RoguelikeCommandRequest, requestHash string) {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCombat || len(run.CombatEnvelope) == 0 || run.Revision != request.ExpectedRevision {
		writeRoguelikeError(c, roguelikeError(http.StatusConflict, "run_revision_conflict", "Активный бой изменился; обновите страницу"))
		return
	}
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	result, err := client.call(c.Request.Context(), "/upgrade", map[string]any{"artifactHash": run.CombatEnvelope["artifactHash"], "envelope": run.CombatEnvelope})
	if err == nil {
		err = validateCombatRulesUpgrade(run.CombatEnvelope, result)
	}
	if err != nil {
		if rejection := publicRoguelikeWorkerFailure(err); rejection != nil {
			writeRoguelikeError(c, roguelikeError(http.StatusConflict, rejection.Code, rejection.Message))
			return
		}
		writeRoguelikeError(c, roguelikeError(http.StatusConflict, "combat_upgrade_rejected", "Не удалось обновить правила: бой должен быть активным, без ожидающих решений, на ходу персонажа. Состояние не изменено."))
		return
	}
	var response JSONMap
	err = performanceTransaction(rc.db, c.Request.Context(), func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", run.UserID.String()+":"+run.ID.String()+":"+request.CommandID.String()).Error; err != nil {
			return err
		}
		locked, err := ownedRoguelikeRun(tx, run.ID, run.UserID, true)
		if err != nil {
			return err
		}
		var receipt RoguelikeCommandReceipt
		err = tx.Where("run_id = ? AND user_id = ? AND command_id = ?", run.ID, run.UserID, request.CommandID).First(&receipt).Error
		if err == nil {
			if receipt.RequestHash != requestHash || receipt.CommandType != request.Type {
				return roguelikeError(http.StatusConflict, "command_id_reused", "ID команды уже использован")
			}
			response = receipt.Response
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if locked.Revision != request.ExpectedRevision {
			return roguelikeError(http.StatusConflict, "run_revision_conflict", "Состояние забега изменилось в другой вкладке")
		}
		if err = validateCombatRulesUpgrade(locked.CombatEnvelope, result); err != nil {
			return err
		}
		locked.CombatEnvelope = result.Envelope
		locked.Revision++
		if err = saveRoguelikeRun(tx, locked); err != nil {
			return err
		}
		if err = appendRoguelikeCombatEvent(tx, locked, request, run.CombatEnvelope, result); err != nil {
			return err
		}
		accepted, err := ownedRoguelikeRun(tx, run.ID, run.UserID, false)
		if err != nil {
			return err
		}
		response, err = roguelikeRunResponse(accepted)
		if err != nil {
			return err
		}
		return tx.Create(&RoguelikeCommandReceipt{RunID: run.ID, UserID: run.UserID, CommandID: request.CommandID, CommandType: request.Type, RequestHash: requestHash, Response: response, Request: nonNilRoguelikeMap(request.Payload)}).Error
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
