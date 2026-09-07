package main

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	roguelikeRunHeader    = "X-Roguelike-Run-ID"
	roguelikeIntentHeader = "X-Roguelike-Intent"
	roguelikeIntentCombat = "combat"
	roguelikeIntentLevel  = "level_up"
)

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
	wantPhase := ""
	switch intent {
	case roguelikeIntentCombat:
		wantPhase = RoguelikePhaseCombat
	case roguelikeIntentLevel:
		wantPhase = RoguelikePhaseCamp
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
