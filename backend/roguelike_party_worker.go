package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// All calculations use the ordinary worker. Only orchestration, membership and
// the shared wallet/clock live here. CAS includes every participant, not just the leader.
func (rc *RoguelikeController) trustedPartyCommand(c *gin.Context, run *RoguelikeRun, request RoguelikeCommandRequest, requestHash string) {
	fail := func(code, message string) { writeRoguelikeError(c, roguelikeError(409, code, message)) }
	rest := request.Type == "short_rest" || request.Type == "long_rest" || request.Type == "bind_weapon"
	campAction := request.Type == "camp_action" || request.Type == "camp_turn" || request.Type == "use_item"
	camp := rest || campAction || request.Type == "recall_weapon"
	phase := RoguelikePhaseCombat
	if camp {
		phase = RoguelikePhaseCamp
	}
	if run.Status != RoguelikeStatusActive || run.Phase != phase || run.Revision != request.ExpectedRevision {
		fail("run_revision_conflict", "Состояние группы изменилось; обновите страницу")
		return
	}
	actor := run.Character
	if id := roguelikePayloadString(request, "actor_id"); id != "" {
		actor = nil
		for _, member := range run.Characters {
			if member.ID.String() == id {
				actor = member
			}
		}
		if actor == nil {
			fail("foreign_party_member", "Персонаж не состоит в группе")
			return
		}
	}
	if request.Type == "long_rest" && run.Supplies < roguelikePartySize(run) {
		fail("supplies_required", "Нужен один комплект припасов на каждого участника")
		return
	}
	if rest {
		for _, member := range run.Characters {
			if member.CurrentHP < 1 {
				fail("rest_at_zero_hp", "Сначала помогите участникам с 0 хитов")
				return
			}
		}
	} else if camp && actor.CurrentHP < 1 {
		fail("action_at_zero_hp", "Персонаж с 0 хитов не может действовать")
		return
	}
	expected := map[string]int64{}
	for _, member := range run.Characters {
		expected[member.ID.String()] = member.RuntimeRevision
	}
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	var result *roguelikeWorkerResult
	var err error
	catalog := run.CombatCatalog
	events := map[string][]JSONMap{}
	if rest {
		result = &roguelikeWorkerResult{Patches: map[string]JSONMap{}}
		choices := JSONMap{}
		if raw, ok := request.Payload["member_choices"].(map[string]any); ok {
			choices = JSONMap(raw)
		}
		for id := range choices {
			if _, ok := expected[id]; !ok {
				fail("foreign_party_member", "Выбор отдыха содержит чужого участника")
				return
			}
		}
		for _, member := range run.Characters {
			subRun := *run
			subRun.Character = member
			subRequest := request
			subRequest.Payload = JSONMap{}
			if member.ID == actor.ID {
				subRequest.Payload = request.Payload
			} else if request.Type == "bind_weapon" {
				subRequest.Type = "short_rest"
			}
			if raw, ok := choices[member.ID.String()].(map[string]any); ok {
				subRequest.Payload = JSONMap(raw)
			}
			var output *roguelikeWorkerResult
			output, err = executeRoguelikeRestWorker(c.Request.Context(), rc.db, client, &subRun, subRequest)
			if err != nil {
				break
			}
			result.Patches[member.ID.String()] = output.Patch
			events[member.ID.String()] = output.Events
		}
	} else if campAction {
		// Currency is a read-only material-payment budget, not another purse.
		actingCopy := *actor
		setCharacterGold(&actingCopy, run.Gold)
		result, err = executeRoguelikeCampActionWorker(c.Request.Context(), rc.db, client, &actingCopy, request, run.Characters...)
		if err == nil {
			if result.Patches == nil {
				result.Patches = map[string]JSONMap{}
			}
			result.Patches[actor.ID.String()] = result.Patch
			events[actor.ID.String()] = result.Events
		}
	} else if camp {
		subRun := *run
		subRun.Character = actor
		result, err = executeRoguelikeRestWorker(c.Request.Context(), rc.db, client, &subRun, request)
		if err == nil {
			result.Patches = map[string]JSONMap{actor.ID.String(): result.Patch}
			events[actor.ID.String()] = result.Events
		}
	} else if request.Type == "initialize_combat" {
		if len(run.CombatEnvelope) > 0 {
			fail("combat_already_initialized", "Бой уже начат")
			return
		}
		var seed string
		seed, err = newRoguelikeSeed()
		if err == nil {
			result, catalog, err = initializeRoguelikeWorker(c.Request.Context(), rc.db, client, run, seed, roguelikePayloadString(request, "initiative_maneuver_action_id"))
		}
	} else {
		if len(run.CombatEnvelope) == 0 {
			fail("trusted_combat_missing", "Сначала начните бой")
			return
		}
		result, err = client.call(c.Request.Context(), "/transition", map[string]any{"artifactHash": run.CombatEnvelope["artifactHash"], "envelope": run.CombatEnvelope, "intent": request.Payload["intent"], "character": run.Character, "characters": run.Characters})
	}
	if err != nil {
		// Client errors contain status/category only, never worker bodies or entropy.
		log.Printf("roguelike party command %s failed: %v", request.Type, err)
		var rejection *roguelikeWorkerRejection
		if errors.As(err, &rejection) {
			fail(rejection.Code, rejection.Message)
		} else {
			fail("party_execution_failed", "Не удалось выполнить действие группы. Ничего не списано; обновите страницу.")
		}
		return
	}
	if result == nil || len(result.Patches) == 0 {
		fail("party_patch_missing", "Движок не вернул состояние группы")
		return
	}
	if (!camp || rest) && len(result.Patches) != len(run.Characters) {
		fail("party_patch_missing", "Движок вернул не всех участников")
		return
	}
	for id, patch := range result.Patches {
		found := false
		for _, member := range run.Characters {
			if member.ID.String() == id {
				found = true
				if err = applyTrustedRoguelikePatch(member, patch); err != nil {
					break
				}
			}
		}
		if !found || err != nil {
			fail("party_patch_invalid", "Некорректный результат действия группы")
			return
		}
	}
	var response JSONMap
	err = rc.db.Transaction(func(tx *gorm.DB) error {
		locked, err := ownedRoguelikeRun(tx, run.ID, run.UserID, true)
		if err != nil {
			return err
		}
		var receipt RoguelikeCommandReceipt
		receiptErr := tx.Where("run_id = ? AND user_id = ? AND command_id = ?", run.ID, run.UserID, request.CommandID).First(&receipt).Error
		if receiptErr == nil {
			if receipt.RequestHash != requestHash || receipt.CommandType != request.Type {
				return roguelikeError(409, "command_id_reused", "ID команды уже использован")
			}
			response = receipt.Response
			return nil
		}
		if !errors.Is(receiptErr, gorm.ErrRecordNotFound) {
			return receiptErr
		}
		if locked.Revision != request.ExpectedRevision {
			return roguelikeError(409, "run_revision_conflict", "Состояние забега изменилось")
		}
		for _, member := range locked.Characters {
			if member.RuntimeRevision != expected[member.ID.String()] {
				return roguelikeError(409, "party_revision_conflict", "Лист участника изменился в другой вкладке")
			}
		}
		if rest {
			advanceRoguelikeClock(locked, roguelikeRestElapsedSeconds(locked, request.Type))
			if request.Type == "long_rest" {
				if locked.Supplies < len(locked.Characters) {
					return roguelikeError(409, "supplies_required", "Недостаточно припасов")
				}
				locked.Supplies -= len(locked.Characters)
				locked.LastLongRestHour = locked.GameClockHours
				locked.LastLongRestRemainderSeconds = locked.GameClockRemainderSeconds
			}
		}
		if result.GoldSpent < 0 || result.ElapsedSeconds < 0 || result.ElapsedSeconds > 24*3600 || (!campAction && (result.GoldSpent != 0 || result.ElapsedSeconds != 0)) {
			return fmt.Errorf("invalid party worker costs")
		}
		if result.GoldSpent > locked.Gold {
			return roguelikeError(409, "material_gold_required", "Недостаточно золота")
		}
		if campAction {
			locked.Gold -= result.GoldSpent
			advanceRoguelikeClock(locked, result.ElapsedSeconds)
		}
		locked.Characters = run.Characters
		locked.Character = run.Character
		setCharacterGold(locked.Character, locked.Gold)
		if !camp {
			locked.CombatEnvelope = result.Envelope
			locked.CombatCatalog = catalog
		}
		locked.Revision++
		if err = saveRoguelikeParty(tx, locked); err != nil {
			return err
		}
		if err = saveRoguelikeRun(tx, locked); err != nil {
			return err
		}
		if !camp {
			if err = appendRoguelikeCombatEvent(tx, locked, request, run.CombatEnvelope, result); err != nil {
				return err
			}
		}
		rows := []CharacterEvent{}
		for _, member := range locked.Characters {
			for _, event := range events[member.ID.String()] {
				kind, _ := event["type"].(string)
				row := CharacterEvent{CharacterID: member.ID, Ts: time.Now(), Type: kind, Payload: event}
				if err = tx.Create(&row).Error; err != nil {
					return err
				}
				rows = append(rows, row)
			}
		}
		accepted, err := ownedRoguelikeRun(tx, run.ID, run.UserID, false)
		if err != nil {
			return err
		}
		response, err = roguelikeRunResponse(accepted)
		if err != nil {
			return err
		}
		if camp {
			response["events"] = rows
		}
		return tx.Create(&RoguelikeCommandReceipt{RunID: run.ID, UserID: run.UserID, CommandID: request.CommandID, CommandType: request.Type, RequestHash: requestHash, Response: response, Request: nonNilRoguelikeMap(request.Payload)}).Error
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
