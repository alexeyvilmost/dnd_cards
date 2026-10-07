package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The caller owns this character. Remove only its actors, using the ordinary
// encounter operation and append-only event contract. Encounter is locked first.
func removeDeletedCharacterFromEncounter(tx *gorm.DB, encounter *Encounter, characterID uuid.UUID) error {
	if encounter == nil {
		return nil
	}
	state := stateOfEncounter(encounter)
	combatants, accessErr := combatantMaps(state)
	if accessErr != nil {
		return accessErr
	}
	remove := []string{}
	active, _ := numberFromJSON(state["activeIndex"])
	remaining, nextActive := 0, active
	for index, actor := range combatants {
		if fmt.Sprint(actor["characterId"]) == characterID.String() {
			remove = append(remove, fmt.Sprint(actor["actorId"]))
			if index < active {
				nextActive--
			}
		} else {
			remaining++
		}
	}
	if len(remove) == 0 {
		return nil
	}
	if nextActive >= remaining {
		nextActive = remaining - 1
	}
	if nextActive < 0 {
		nextActive = 0
	}
	request := ApplyRequest{Remove: remove, ActiveIndex: &nextActive}
	next := JSONMap(applyOps(state, request))
	encounter.State, encounter.Seq = &next, encounter.Seq+1
	payload := opPayload(request)
	if err := tx.Save(encounter).Error; err != nil {
		return err
	}
	if err := tx.Create(&EncounterEvent{EncounterID: encounter.ID, Seq: encounter.Seq, Payload: &payload}).Error; err != nil {
		return err
	}
	notification, err := json.Marshal(map[string]any{"encounter_id": encounter.ID.String(), "seq": encounter.Seq})
	if err != nil {
		return err
	}
	return tx.Exec("SELECT pg_notify('encounter_events', ?)", string(notification)).Error
}

// Lock the aggregate before its sheets, matching the normal run command order.
// Sources are reusable, independent sheets and are never removed here.
func deleteOwnedRoguelikeRun(tx *gorm.DB, runID, userID uuid.UUID) error {
	var run RoguelikeRun
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND user_id = ?", runID, userID).First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return roguelikeError(404, "run_not_found", "забег не найден")
		}
		return err
	}
	ids := []uuid.UUID{}
	for _, member := range roguelikePartyMembers(&run) {
		ids = append(ids, member.CharacterID)
	}
	if len(ids) == 0 {
		return roguelikeError(409, "invalid_party", "не удалось определить участников забега")
	}
	var sheets []CharacterV3
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ? AND user_id = ?", ids, userID).Order("id").Find(&sheets).Error; err != nil {
		return err
	}
	// GORM's soft delete preserves every historical snapshot and FK.
	if err := tx.Where("id IN ? AND user_id = ? AND character_type = ?", ids, userID, "dungeon_crawl").Delete(&CharacterV3{}).Error; err != nil {
		return err
	}
	return tx.Where("id = ? AND user_id = ?", run.ID, userID).Delete(&RoguelikeRun{}).Error
}

func (rc *RoguelikeController) Delete(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	runID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID забега"})
		return
	}
	if err = rc.db.Transaction(func(tx *gorm.DB) error { return deleteOwnedRoguelikeRun(tx, runID, userID) }); err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "забег и его игровые листы удалены"})
}

func deleteCharacterRun(tx *gorm.DB, characterID, userID uuid.UUID) (bool, error) {
	var runs []RoguelikeRun
	if err := tx.Where("user_id = ? AND (character_id = ? OR party @> ?::jsonb)", userID, characterID,
		`{"members":[{"character_id":"`+characterID.String()+`"}]}`).Order("id").Find(&runs).Error; err != nil {
		return false, err
	}
	for _, run := range runs {
		if err := deleteOwnedRoguelikeRun(tx, run.ID, userID); err != nil {
			return false, err
		}
	}
	return len(runs) > 0, nil
}
