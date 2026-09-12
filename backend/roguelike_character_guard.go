package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var roguelikeEquipmentSlots = map[string]bool{
	"head": true, "body": true, "main_hand": true, "off_hand": true,
	"gloves": true, "boots": true, "cloak": true, "necklace": true,
	"ring_1": true, "ring_2": true,
}

func roguelikeMutationError(code, message string, characterID uuid.UUID) error {
	return &characterRuntimeCommandError{
		Status: http.StatusConflict, Code: code, Message: message, CharacterID: characterID.String(),
	}
}

func roguelikeJSONEqual(left, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftJSON, rightJSON)
}

func roguelikeItemOwnership(equipment *JSONMap, inventory *InventoryItemRows) (map[string]int, error) {
	owned := map[string]int{}
	if equipment != nil {
		mainHand, _ := (*equipment)["main_hand"].(string)
		offHand, _ := (*equipment)["off_hand"].(string)
		for slot, raw := range *equipment {
			if !roguelikeEquipmentSlots[slot] {
				return nil, fmt.Errorf("unknown equipment slot %q", slot)
			}
			if raw == nil || raw == "" {
				continue
			}
			cardID, ok := raw.(string)
			if !ok {
				return nil, fmt.Errorf("equipment slot %q is not a card id", slot)
			}
			if _, err := uuid.Parse(cardID); err != nil {
				return nil, fmt.Errorf("equipment slot %q has an invalid card id", slot)
			}
			// A two-handed card is represented in both hand slots but remains one item.
			if slot == "off_hand" && cardID == mainHand && cardID == offHand {
				continue
			}
			owned[cardID]++
		}
	}
	if inventory != nil {
		for _, row := range *inventory {
			if row.Qty < 1 {
				return nil, fmt.Errorf("inventory quantity must be positive")
			}
			if _, err := uuid.Parse(row.CardID); err != nil {
				return nil, fmt.Errorf("inventory contains an invalid card id")
			}
			if row.ContainerID != "" {
				if _, err := uuid.Parse(row.ContainerID); err != nil {
					return nil, fmt.Errorf("inventory contains an invalid container id")
				}
			}
			owned[row.CardID] += row.Qty
		}
	}
	return owned, nil
}

func roguelikeAttunedIDs(turnState *JSONMap) ([]string, error) {
	if turnState == nil || (*turnState)["attuned_ids"] == nil {
		return nil, nil
	}
	data, err := json.Marshal((*turnState)["attuned_ids"])
	if err != nil {
		return nil, err
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil, fmt.Errorf("attuned_ids must be a list of card ids")
	}
	return ids, nil
}

func roguelikeAttunementUnlocked(turnState *JSONMap) bool {
	if turnState == nil {
		return false
	}
	unlocked, ok := (*turnState)["attunement_unlocked"].(bool)
	return ok && unlocked
}

func roguelikeAttunementChanged(character CharacterV3, req PatchCharacterRuntimeRequest) ([]string, bool, error) {
	if req.TurnState == nil {
		return nil, false, nil
	}
	before, err := roguelikeAttunedIDs(character.TurnState)
	if err != nil {
		return nil, false, err
	}
	after, err := roguelikeAttunedIDs(req.TurnState)
	if err != nil {
		return nil, false, err
	}
	return after, !roguelikeJSONEqual(before, after), nil
}

// validateRoguelikeCampRuntimePatch allows the regular sheet's equipment UI in
// camp while proving that no HP, resource, currency, effect, or item ownership
// can be smuggled through the compatibility PATCH endpoint.
func validateRoguelikeCampRuntimePatch(character CharacterV3, req PatchCharacterRuntimeRequest) error {
	forbidden :=
		(req.CurrentHP != nil && *req.CurrentHP != character.CurrentHP) ||
			(req.MaxHP != nil && *req.MaxHP != character.MaxHP) ||
			(req.Resources != nil && !roguelikeJSONEqual(req.Resources, character.Resources)) ||
			(req.MaxResources != nil && !roguelikeJSONEqual(req.MaxResources, character.MaxResources)) ||
			(req.ActiveEffects != nil && !roguelikeJSONEqual(req.ActiveEffects, character.ActiveEffects)) ||
			(req.Currency != nil && !roguelikeJSONEqual(req.Currency, character.Currency))
	if forbidden {
		return roguelikeMutationError("roguelike_camp_patch_forbidden", "в лагере лист разрешает менять только размещение и настройку принадлежащих предметов", character.ID)
	}

	candidateEquipment := character.Equipment
	if req.Equipment != nil {
		candidateEquipment = req.Equipment
	}
	candidateInventory := character.InventoryItems
	if req.InventoryItems != nil {
		candidateInventory = req.InventoryItems
	}
	before, beforeErr := roguelikeItemOwnership(character.Equipment, character.InventoryItems)
	after, afterErr := roguelikeItemOwnership(candidateEquipment, candidateInventory)
	if beforeErr != nil || afterErr != nil || !roguelikeJSONEqual(before, after) {
		return roguelikeMutationError("roguelike_item_ownership_changed", "экипировка не может добавлять, удалять или дублировать предметы забега", character.ID)
	}

	if req.TurnState != nil {
		current := cloneJSONMapValue(character.TurnState)
		candidate := cloneJSONMapValue(req.TurnState)
		delete(current, "attuned_ids")
		delete(candidate, "attuned_ids")
		if !roguelikeJSONEqual(current, candidate) {
			return roguelikeMutationError("roguelike_camp_state_forbidden", "в лагере через лист можно менять только настройку предметов", character.ID)
		}
		ids, err := roguelikeAttunedIDs(req.TurnState)
		if err != nil || len(ids) > 3 {
			return roguelikeMutationError("roguelike_attunement_invalid", "можно настроиться максимум на три принадлежащих предмета", character.ID)
		}
		seen := map[string]bool{}
		for _, id := range ids {
			if seen[id] || after[id] < 1 {
				return roguelikeMutationError("roguelike_attunement_invalid", "настройка разрешена только для принадлежащих уникальных предметов", character.ID)
			}
			seen[id] = true
		}
		_, changed, err := roguelikeAttunementChanged(character, req)
		if err != nil {
			return roguelikeMutationError("roguelike_attunement_invalid", "список настроенных предметов повреждён", character.ID)
		}
		if changed && !roguelikeAttunementUnlocked(character.TurnState) {
			return roguelikeMutationError("roguelike_attunement_rest_required", "изменять настройку предметов можно только после отдыха", character.ID)
		}
	}
	return nil
}

// validateRoguelikeCampAttunementCards proves against the catalog that every
// newly submitted attunement target actually requires attunement. The check is
// deliberately performed inside the same transaction and row lock as the
// character update.
func validateRoguelikeCampAttunementCards(tx *gorm.DB, character CharacterV3, req PatchCharacterRuntimeRequest) error {
	ids, changed, err := roguelikeAttunementChanged(character, req)
	if err != nil {
		return roguelikeMutationError("roguelike_attunement_invalid", "список настроенных предметов повреждён", character.ID)
	}
	if !changed || len(ids) == 0 {
		return nil
	}
	var count int64
	if err := tx.Model(&Card{}).
		Where("id IN ? AND requires_attunement IS TRUE", ids).
		Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return roguelikeMutationError("roguelike_attunement_invalid", "настройка разрешена только для предметов, которым она требуется", character.ID)
	}
	return nil
}

const (
	roguelikeRunHeader        = "X-Roguelike-Run-ID"
	roguelikeIntentHeader     = "X-Roguelike-Intent"
	roguelikeIntentCombat     = "combat"
	roguelikeIntentLevel      = "level_up"
	roguelikeIntentCamp       = "camp"
	roguelikeIntentCampAction = "camp_action"
)

// Sheet actions may consume items and class resources in camp. Rest recovery
// and the run economy still go through run commands.
func validateRoguelikeCampAction(character CharacterV3, patch CharacterRuntimeCommandPatch) error {
	if patch.TurnState != nil {
		current := cloneJSONMapValue(character.TurnState)
		if !roguelikeJSONEqual(current["weapon_bonds_v1"], (*patch.TurnState)["weapon_bonds_v1"]) {
			return roguelikeMutationError("roguelike_weapon_bond_authority_required", "связь с оружием изменяется только через серверное действие", character.ID)
		}
	}
	if (patch.MaxResources != nil && !roguelikeJSONEqual(patch.MaxResources, character.MaxResources)) ||
		(patch.Currency != nil && !roguelikeJSONEqual(patch.Currency, character.Currency)) {
		return roguelikeMutationError("roguelike_camp_action_forbidden", "действие не может менять максимумы ресурсов или деньги забега", character.ID)
	}
	if patch.Resources != nil {
		for key, raw := range *patch.Resources {
			if key == "action" || key == "bonus_action" || key == "reaction" {
				continue
			}
			before := 0
			if character.Resources != nil {
				before, _ = numberFromJSON((*character.Resources)[key])
			}
			after, ok := numberFromJSON(raw)
			if !ok || after > before {
				return roguelikeMutationError("roguelike_rest_required", "восстановление ресурсов требует отдыха", character.ID)
			}
		}
	}
	return nil
}

// authorizeRoguelikeCharacterMutation closes every ordinary CharacterV3 write
// path for a run-owned sheet. The caller must name the owning run and the one
// phase-specific operation that is allowed through the shared rules surface.
func authorizeRoguelikeCharacterMutation(
	tx *gorm.DB,
	character CharacterV3,
	userID uuid.UUID,
	runIDRaw string,
	intent string,
) (*RoguelikeRun, error) {
	if character.CharacterType != "dungeon_crawl" {
		return nil, nil
	}
	runID, err := uuid.Parse(strings.TrimSpace(runIDRaw))
	if err != nil || runID == uuid.Nil || runID.String() != strings.TrimSpace(runIDRaw) {
		return nil, &characterRuntimeCommandError{
			Status: http.StatusConflict, Code: "roguelike_authority_required",
			Message:     "персонаж активного забега изменяется только через команды забега",
			CharacterID: character.ID.String(),
		}
	}
	var run RoguelikeRun
	if err := tx.Where(
		"id = ? AND character_id = ? AND user_id = ?", runID, character.ID, userID,
	).First(&run).Error; err != nil {
		return nil, &characterRuntimeCommandError{
			Status: http.StatusConflict, Code: "roguelike_authority_mismatch",
			Message:     "забег не владеет этим персонажем",
			CharacterID: character.ID.String(),
		}
	}
	if run.Status != RoguelikeStatusActive {
		return nil, &characterRuntimeCommandError{
			Status: http.StatusConflict, Code: "roguelike_run_inactive",
			Message:     "завершённый забег нельзя изменять",
			CharacterID: character.ID.String(),
		}
	}
	if (len(run.CombatEnvelope) > 0 || run.Encounter["trusted_required"] == true) && run.Phase == RoguelikePhaseCombat {
		return nil, roguelikeMutationError("trusted_combat_required", "бой изменяется только командами серверного движка", character.ID)
	}
	wantPhase := ""
	switch intent {
	case roguelikeIntentCombat:
		wantPhase = RoguelikePhaseCombat
	case roguelikeIntentLevel:
		wantPhase = RoguelikePhaseCamp
	case roguelikeIntentCamp:
		wantPhase = RoguelikePhaseCamp
	case roguelikeIntentCampAction:
		return nil, roguelikeMutationError("roguelike_camp_action_authority_required", "способности в лагере выполняются только командами серверного движка", character.ID)
	default:
		return nil, &characterRuntimeCommandError{
			Status: http.StatusConflict, Code: "roguelike_intent_forbidden",
			Message:     "операция недоступна для персонажа забега",
			CharacterID: character.ID.String(),
		}
	}
	if run.Phase != wantPhase {
		return nil, &characterRuntimeCommandError{
			Status: http.StatusConflict, Code: "roguelike_phase_conflict",
			Message:     "состояние забега изменилось; вернитесь на экран забега",
			CharacterID: character.ID.String(),
		}
	}
	return &run, nil
}
