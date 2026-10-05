package main

import (
	"database/sql"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// A presentation-only offer. No entropy is generated and no state is written.
// Initialize remains the authoritative command and rechecks grants/cost against
// its current owned inputs; an option is never a reservation or a paid action.
func (rc *RoguelikeController) InitiativeOptions(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	runID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeRoguelikeError(c, roguelikeError(400, "invalid_run_id", "Неверный ID забега"))
		return
	}
	revision, err := strconv.ParseInt(c.Query("expected_revision"), 10, 64)
	if err != nil || revision < 0 {
		writeRoguelikeError(c, roguelikeError(422, "invalid_revision", "Обновите состояние забега"))
		return
	}
	var response gin.H
	err = rc.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		run, err := ownedRoguelikeRun(tx, runID, userID, false)
		if err != nil {
			return err
		}
		if os.Getenv("RULES_INITIATIVE_OPTIONS_ENABLED") != "1" {
			response = gin.H{"enabled": false}
			return nil
		}
		if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCombat || run.Revision != revision || len(run.CombatEnvelope) > 0 || run.Character == nil {
			return roguelikeError(409, "initiative_options_stale", "Начало боя изменилось. Обновите страницу.")
		}
		if err := equipmentOwner(tx, userID, *run.Character); err != nil {
			return roguelikeError(403, "initiative_options_forbidden", "Нет доступа к участнику забега")
		}
		done := performanceSince(c.Request.Context(), "initiative_options_prepare_ms")
		defer done()
		result, _, err := prepareCharacterWorker(c.Request.Context(), tx, roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}, "/initiative-options", userID, *run.Character, nil)
		if err != nil {
			if rejection := publicRoguelikeWorkerFailure(err); rejection != nil {
				return roguelikeError(422, rejection.Code, rejection.Message)
			}
			return err
		}
		response = gin.H{"enabled": true, "run_revision": run.Revision, "character_id": run.Character.ID.String(),
			"runtime_revision": run.Character.RuntimeRevision, "artifact_hash": result.ArtifactHash, "content_manifest_hash": result.ContentManifestHash,
			"options": result.InitiativeOptions}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
