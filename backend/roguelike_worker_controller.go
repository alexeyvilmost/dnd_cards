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
	"time"
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
	isRest := request.Type == "short_rest" || request.Type == "long_rest" || request.Type == "bind_weapon"
	isCampAction := request.Type == "camp_action" || request.Type == "camp_turn" || request.Type == "use_item"
	isCamp := isRest || request.Type == "recall_weapon" || isCampAction
	expectedPhase := RoguelikePhaseCombat
	if isCamp {
		expectedPhase = RoguelikePhaseCamp
	}
	if run.Status != RoguelikeStatusActive || run.Phase != expectedPhase || run.Character == nil {
		if isCamp {
			fail("camp_required", "отдых доступен только в лагере")
		} else {
			fail("combat_required", "активный бой не найден")
		}
		return
	}
	if run.Revision != request.ExpectedRevision {
		fail("run_revision_conflict", "состояние забега изменилось")
		return
	}
	if isCamp && run.Character.CurrentHP < 1 {
		fail("rest_at_zero_hp", "отдых нельзя начать при 0 хитов")
		return
	}
	if request.Type == "long_rest" && run.Supplies < 1 {
		fail("supplies_required", "для долгого отдыха нужны припасы")
		return
	}
	expectedCharacterRevision := run.Character.RuntimeRevision
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	var result *roguelikeWorkerResult
	catalog := run.CombatCatalog
	if isCampAction {
		result, err = executeRoguelikeCampActionWorker(c.Request.Context(), rc.db, client, run.Character, request)
	} else if isCamp {
		result, err = executeRoguelikeRestWorker(c.Request.Context(), rc.db, client, run, request)
	} else if request.Type == "initialize_combat" {
		if len(run.CombatEnvelope) > 0 || combatOutcome(run.Character) != "" {
			fail("combat_already_initialized", "бой уже начат; обновите страницу")
			return
		}
		seed, seedErr := newRoguelikeSeed()
		if seedErr != nil {
			writeRoguelikeError(c, seedErr)
			return
		}
		initiativeManeuverActionID, _ := request.Payload["initiative_maneuver_action_id"].(string)
		result, catalog, err = initializeRoguelikeWorker(c.Request.Context(), rc.db, client, run, seed, initiativeManeuverActionID)
	} else {
		if len(run.CombatEnvelope) == 0 {
			fail("trusted_combat_missing", "серверный бой не инициализирован")
			return
		}
		result, err = client.call(c.Request.Context(), "/transition", map[string]any{"artifactHash": run.CombatEnvelope["artifactHash"],
			"envelope": run.CombatEnvelope, "intent": request.Payload["intent"], "character": run.Character})
	}
	if err != nil {
		fail("combat_execution_failed", "не удалось выполнить действие; состояние не изменено")
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
			return roguelikeError(http.StatusConflict, "run_revision_conflict", "состояние забега изменилось в другой вкладке")
		}
		if isRest {
			locked.Character = &character
			restRequest := request
			restRequest.Payload = JSONMap{"hit_die_rolls": request.Payload["hit_die_rolls"], "runtime": JSONMap{
				"current_hp": result.Patch["current_hp"], "resources": result.Patch["resources"],
				"active_effects": result.Patch["active_effects"], "turn_state": result.Patch["turn_state"],
			}}
			if err = restRoguelike(locked, restRequest, request.Type == "long_rest"); err != nil {
				return err
			}
		} else if !isCamp {
			locked.CombatEnvelope = result.Envelope
			locked.CombatCatalog = catalog
		}
		if result.GoldSpent < 0 || (!isCampAction && result.GoldSpent != 0) {
			return fmt.Errorf("invalid worker material payment")
		}
		if isCampAction && result.GoldSpent > 0 {
			if locked.Gold < result.GoldSpent || characterGold(&character) != locked.Gold {
				return roguelikeError(http.StatusConflict, "material_gold_required", "недостаточно золота для материальных компонентов")
			}
			locked.Gold -= result.GoldSpent
			setCharacterGold(run.Character, locked.Gold)
		}
		if result.ElapsedSeconds < 0 || result.ElapsedSeconds > 24*3600 || (!isCampAction && result.ElapsedSeconds != 0) {
			return fmt.Errorf("invalid worker duration")
		}
		if isCampAction {
			advanceRoguelikeClock(locked, result.ElapsedSeconds)
		}
		locked.Character = run.Character
		locked.Revision++
		if err = tx.Omit("User", "Group").Save(locked.Character).Error; err != nil {
			return err
		}
		if err = saveRoguelikeRun(tx, locked); err != nil {
			return err
		}
		if !isCamp {
			if err = appendRoguelikeCombatEvent(tx, locked, request, run.CombatEnvelope, result); err != nil {
				return err
			}
		}
		accepted, err := ownedRoguelikeRun(tx, runID, userID, false)
		if err != nil {
			return err
		}
		response, err = roguelikeRunResponse(accepted)
		if err != nil {
			return err
		}

		if isCamp {
			rows := []CharacterEvent{}
			for _, event := range result.Events {
				eventType, _ := event["type"].(string)
				row := CharacterEvent{CharacterID: locked.CharacterID, Ts: time.Now(), Type: eventType, Payload: event}
				if err = tx.Create(&row).Error; err != nil {
					return err
				}
				rows = append(rows, row)
			}
			response["events"] = rows
		}
		return tx.Create(&RoguelikeCommandReceipt{RunID: runID, UserID: userID, CommandID: request.CommandID,
			CommandType: request.Type, RequestHash: requestHash, Response: response, Request: nonNilRoguelikeMap(request.Payload)}).Error
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
