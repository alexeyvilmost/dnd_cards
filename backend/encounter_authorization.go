package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// encounterAccessError keeps policy failures separate from storage failures so
// handlers can fail closed with the correct 4xx response instead of silently
// degrading to the shared/public identity.
type encounterAccessError struct {
	Status  int
	Message string
}

func (e *encounterAccessError) Error() string { return e.Message }

func encounterMembers(enc *Encounter) map[uuid.UUID]struct{} {
	members := make(map[uuid.UUID]struct{}, len(enc.MemberUserIDs)+1)
	if enc.OwnerUserID != uuid.Nil {
		members[enc.OwnerUserID] = struct{}{}
	}
	for _, raw := range enc.MemberUserIDs {
		if id, err := uuid.Parse(strings.TrimSpace(raw)); err == nil && id != uuid.Nil {
			members[id] = struct{}{}
		}
	}
	return members
}

func isEncounterParticipant(enc *Encounter, userID uuid.UUID) bool {
	if enc == nil || userID == uuid.Nil {
		return false
	}
	_, ok := encounterMembers(enc)[userID]
	return ok
}

func requireEncounterParticipant(c *gin.Context, enc *Encounter) (uuid.UUID, bool) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return uuid.Nil, false
	}
	if !isEncounterParticipant(enc, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "нет доступа к этому бою"})
		return uuid.Nil, false
	}
	return userID, true
}

type encounterActorAccess struct {
	ActorID          string
	CharacterID      uuid.UUID
	ControllerUserID uuid.UUID
	IsCharacter      bool
}

func combatantMaps(state map[string]interface{}) ([]map[string]interface{}, *encounterAccessError) {
	if state == nil || state["combatants"] == nil {
		return nil, nil
	}
	switch raw := state["combatants"].(type) {
	case []interface{}:
		out := make([]map[string]interface{}, 0, len(raw))
		for _, item := range raw {
			combatant, ok := item.(map[string]interface{})
			if !ok {
				return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "состояние боя содержит некорректного участника"}
			}
			out = append(out, combatant)
		}
		return out, nil
	case []map[string]interface{}:
		return raw, nil
	default:
		return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "состояние боя содержит некорректный список участников"}
	}
}

func characterUUIDsInCombatants(combatants []map[string]interface{}) ([]uuid.UUID, *encounterAccessError) {
	seen := make(map[uuid.UUID]struct{})
	ids := make([]uuid.UUID, 0)
	for _, combatant := range combatants {
		raw, exists := combatant["characterId"]
		if !exists || raw == nil || strings.TrimSpace(fmt.Sprint(raw)) == "" {
			continue
		}
		characterID, err := uuid.Parse(strings.TrimSpace(fmt.Sprint(raw)))
		if err != nil || characterID == uuid.Nil {
			return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "состояние боя содержит неверный characterId"}
		}
		if _, exists := seen[characterID]; exists {
			continue
		}
		seen[characterID] = struct{}{}
		ids = append(ids, characterID)
	}
	return ids, nil
}

func loadEncounterCharacters(db *gorm.DB, ids []uuid.UUID, lockRows bool) (map[uuid.UUID]CharacterV3, error) {
	result := make(map[uuid.UUID]CharacterV3, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	query := db
	if lockRows {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var characters []CharacterV3
	if err := query.Where("id IN ?", ids).Order("id asc").Find(&characters).Error; err != nil {
		return nil, err
	}
	for _, character := range characters {
		result[character.ID] = character
	}
	if len(result) != len(ids) {
		return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "бой ссылается на несуществующего персонажа"}
	}
	return result, nil
}

func actorAccessFromCombatants(combatants []map[string]interface{}, characters map[uuid.UUID]CharacterV3) (map[string]encounterActorAccess, *encounterAccessError) {
	actors := make(map[string]encounterActorAccess, len(combatants))
	for _, combatant := range combatants {
		actorID, ok := combatant["actorId"].(string)
		actorID = strings.TrimSpace(actorID)
		if !ok || actorID == "" {
			return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "состояние боя содержит участника без actorId"}
		}
		if _, duplicate := actors[actorID]; duplicate {
			return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "состояние боя содержит повторяющийся actorId"}
		}
		access := encounterActorAccess{ActorID: actorID}
		if raw, exists := combatant["characterId"]; exists && raw != nil && strings.TrimSpace(fmt.Sprint(raw)) != "" {
			characterID, err := uuid.Parse(strings.TrimSpace(fmt.Sprint(raw)))
			if err != nil || characterID == uuid.Nil {
				return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "состояние боя содержит неверный characterId"}
			}
			character, exists := characters[characterID]
			if !exists {
				return nil, &encounterAccessError{Status: http.StatusUnprocessableEntity, Message: "бой ссылается на несуществующего персонажа"}
			}
			access.IsCharacter = true
			access.CharacterID = characterID
			access.ControllerUserID = character.UserID
		}
		actors[actorID] = access
	}
	return actors, nil
}

func encounterJoinAllowed(enc *Encounter, userID uuid.UUID, actors map[string]encounterActorAccess) bool {
	if isEncounterParticipant(enc, userID) {
		return true
	}
	for _, actor := range actors {
		if actor.IsCharacter && actor.ControllerUserID == userID {
			return true
		}
	}
	return false
}

func canIssueEncounterInvite(enc *Encounter, userID uuid.UUID) bool {
	return enc != nil && userID != uuid.Nil && enc.OwnerUserID == userID
}

func authorizeEncounterJoin(
	enc *Encounter,
	userID uuid.UUID,
	actors map[string]encounterActorAccess,
	inviteToken string,
	inviteService *EncounterInviteService,
) *encounterAccessError {
	if encounterJoinAllowed(enc, userID, actors) {
		return nil
	}
	if strings.TrimSpace(inviteToken) == "" {
		return &encounterAccessError{Status: http.StatusForbidden, Message: "требуется действующее приглашение в бой"}
	}
	if inviteService == nil {
		return &encounterAccessError{Status: http.StatusServiceUnavailable, Message: "приглашения в бой не настроены"}
	}
	if err := inviteService.Validate(inviteToken, enc.ID, enc.OwnerUserID); err != nil {
		if errors.Is(err, ErrEncounterInviteNotConfigured) {
			return &encounterAccessError{Status: http.StatusServiceUnavailable, Message: "приглашения в бой не настроены"}
		}
		// Forged, expired and wrong-scope capabilities deliberately share one
		// response so the endpoint does not become a token validity oracle.
		return &encounterAccessError{Status: http.StatusForbidden, Message: "приглашение недействительно или истекло"}
	}
	return nil
}

var encounterInteractionPatchFields = map[string]struct{}{
	"hp":             {},
	"temp":           {},
	"activeEffects":  {},
	"pendingSaves":   {},
	"pendingAttacks": {},
}

func isJSONNumber(value interface{}) bool {
	switch n := value.(type) {
	case float64:
		return !math.IsNaN(n) && !math.IsInf(n, 0)
	case float32:
		return !math.IsNaN(float64(n)) && !math.IsInf(float64(n), 0)
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return true
	default:
		return false
	}
}

const (
	maxEncounterRuntimeValue = 1_000_000
	maxEncounterRuntimeRows  = 128
	maxEncounterRuntimeJSON  = 128 * 1024
)

func boundedJSONInteger(value interface{}, minimum, maximum int64) bool {
	var number float64
	switch n := value.(type) {
	case float64:
		number = n
	case float32:
		number = float64(n)
	case int:
		number = float64(n)
	case int8:
		number = float64(n)
	case int16:
		number = float64(n)
	case int32:
		number = float64(n)
	case int64:
		number = float64(n)
	case uint:
		number = float64(n)
	case uint8:
		number = float64(n)
	case uint16:
		number = float64(n)
	case uint32:
		number = float64(n)
	case uint64:
		number = float64(n)
	case json.Number:
		parsed, err := n.Float64()
		if err != nil {
			return false
		}
		number = parsed
	default:
		return false
	}
	return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Trunc(number) == number &&
		number >= float64(minimum) && number <= float64(maximum)
}

func boundedString(value interface{}, required bool, maximum int) bool {
	text, ok := value.(string)
	if !ok || len(text) > maximum {
		return false
	}
	return !required || strings.TrimSpace(text) != ""
}

func validActiveEffectValue(value interface{}) bool {
	row, ok := value.(map[string]interface{})
	if !ok || !boundedString(row["id"], true, 255) || !boundedString(row["name"], true, 500) {
		return false
	}
	if mechanics, exists := row["mechanics"]; exists && mechanics != nil {
		if _, ok := mechanics.(map[string]interface{}); !ok {
			return false
		}
	}
	for _, key := range []string{"source", "sourceId", "ownerId", "expiry"} {
		if field, exists := row[key]; exists && field != nil && !boundedString(field, false, 1000) {
			return false
		}
	}
	if lifecycle, exists := row["sourceTurnExpiry"]; exists && lifecycle != nil {
		value, ok := lifecycle.(map[string]interface{})
		if !ok || !boundedString(value["sourceActorId"], true, 255) ||
			!boundedString(value["ownerActorId"], true, 255) {
			return false
		}
		boundary, ok := value["boundary"].(string)
		if !ok || (boundary != "start" && boundary != "end") {
			return false
		}
		if armed, present := value["armed"]; present {
			armedValue, ok := armed.(bool)
			if !ok || !armedValue {
				return false
			}
		}
	}
	entityRef, hasEntityRef := row["entityRef"]
	if mechanics, ok := row["mechanics"].(map[string]interface{}); ok {
		stackID, _ := mechanics["stack_id"].(string)
		requiresLibraryIdentity := mechanics["kind"] == "condition" || strings.HasPrefix(stackID, "weapon-mastery:")
		if requiresLibraryIdentity && (!hasEntityRef || entityRef == nil) {
			return false
		}
	}
	if hasEntityRef && entityRef != nil {
		value, ok := entityRef.(map[string]interface{})
		if !ok || value["kind"] != "effect" || !boundedString(value["id"], true, 255) {
			return false
		}
		if cardNumber, present := value["cardNumber"]; present && cardNumber != nil &&
			!boundedString(cardNumber, false, 255) {
			return false
		}
	}
	if rounds, exists := row["roundsLeft"]; exists && rounds != nil && !boundedJSONInteger(rounds, 0, maxEncounterRuntimeValue) {
		return false
	}
	return true
}

func validSaveOutcome(value interface{}) bool {
	outcome, ok := value.(map[string]interface{})
	if !ok || !boundedJSONInteger(outcome["hpDelta"], -maxEncounterRuntimeValue, maxEncounterRuntimeValue) ||
		!boundedJSONInteger(outcome["tempDelta"], -maxEncounterRuntimeValue, maxEncounterRuntimeValue) {
		return false
	}
	if damageType, exists := outcome["damageType"]; exists && damageType != nil && !boundedString(damageType, false, 100) {
		return false
	}
	if effects, exists := outcome["addEffects"]; exists && effects != nil {
		rows, ok := effects.([]interface{})
		if !ok || len(rows) > maxEncounterRuntimeRows {
			return false
		}
		for _, row := range rows {
			if !validActiveEffectValue(row) {
				return false
			}
		}
	}
	return true
}

func validPendingSaveValue(value interface{}) bool {
	row, ok := value.(map[string]interface{})
	if !ok || !boundedString(row["id"], true, 255) || !boundedString(row["sourceName"], true, 500) ||
		!boundedString(row["actionName"], true, 500) || !boundedString(row["ability"], true, 20) ||
		!boundedJSONInteger(row["dc"], 0, 1000) || !validSaveOutcome(row["onFail"]) || !validSaveOutcome(row["onSuccess"]) {
		return false
	}
	if conditions, exists := row["avoidsConditions"]; exists && conditions != nil {
		items, ok := conditions.([]interface{})
		if !ok || len(items) > maxEncounterRuntimeRows {
			return false
		}
		for _, item := range items {
			if !boundedString(item, true, 255) {
				return false
			}
		}
	}
	return true
}

func validPendingAttackValue(value interface{}) bool {
	row, ok := value.(map[string]interface{})
	if !ok || !boundedString(row["id"], true, 255) || !boundedString(row["sourceName"], true, 500) ||
		!boundedString(row["attackName"], true, 500) ||
		!boundedJSONInteger(row["attackTotal"], -1000, maxEncounterRuntimeValue) ||
		!boundedJSONInteger(row["damage"], 0, maxEncounterRuntimeValue) {
		return false
	}
	for _, key := range []string{"hpDamage", "tempHpDamage"} {
		if field, exists := row[key]; exists && field != nil && !boundedJSONInteger(field, 0, maxEncounterRuntimeValue) {
			return false
		}
	}
	if damageType, exists := row["damageType"]; exists && damageType != nil && !boundedString(damageType, false, 100) {
		return false
	}
	if crit, exists := row["crit"]; exists && crit != nil {
		if _, ok := crit.(bool); !ok {
			return false
		}
	}
	return true
}

func validEncounterRuntimeRows(field string, value interface{}) bool {
	if value == nil {
		return false
	}
	rows, ok := value.([]interface{})
	if !ok || len(rows) > maxEncounterRuntimeRows {
		return false
	}
	encoded, err := json.Marshal(rows)
	if err != nil || len(encoded) > maxEncounterRuntimeJSON {
		return false
	}
	for _, row := range rows {
		valid := false
		switch field {
		case "activeEffects":
			valid = validActiveEffectValue(row)
		case "pendingSaves":
			valid = validPendingSaveValue(row)
		case "pendingAttacks":
			valid = validPendingAttackValue(row)
		}
		if !valid {
			return false
		}
	}
	return true
}

func validEncounterPatchValue(field string, value interface{}) bool {
	switch field {
	case "hp", "temp":
		return boundedJSONInteger(value, 0, maxEncounterRuntimeValue)
	case "activeEffects", "pendingSaves", "pendingAttacks":
		return validEncounterRuntimeRows(field, value)
	default:
		return false
	}
}

// validateEncounterApplyPolicy is intentionally database-independent. The DB
// adapter resolves actual CharacterV3 owners first; this policy never trusts an
// ownerUserId supplied by a browser.
func validateEncounterApplyPolicy(
	enc *Encounter,
	caller uuid.UUID,
	actors map[string]encounterActorAccess,
	addedCharacterControllers map[uuid.UUID]uuid.UUID,
	req ApplyRequest,
) *encounterAccessError {
	if !isEncounterParticipant(enc, caller) {
		return &encounterAccessError{Status: http.StatusForbidden, Message: "нет доступа к этому бою"}
	}

	for _, actor := range actors {
		if actor.IsCharacter && !isEncounterParticipant(enc, actor.ControllerUserID) {
			return &encounterAccessError{Status: http.StatusConflict, Message: "владелец персонажа должен сначала присоединиться к бою"}
		}
	}

	for _, patch := range req.Patches {
		actor, exists := actors[patch.ActorID]
		if !exists {
			return &encounterAccessError{Status: http.StatusBadRequest, Message: "нельзя изменить неизвестного участника боя"}
		}
		if caller != enc.OwnerUserID && (!actor.IsCharacter || actor.ControllerUserID != caller) {
			return &encounterAccessError{Status: http.StatusForbidden, Message: "изменить участника может мастер боя или контроллер персонажа"}
		}
		for field, value := range patch.Set {
			if _, allowed := encounterInteractionPatchFields[field]; !allowed || !validEncounterPatchValue(field, value) {
				return &encounterAccessError{Status: http.StatusBadRequest, Message: fmt.Sprintf("поле %q нельзя изменять боевой операцией", field)}
			}
		}
	}

	for _, actorID := range req.Remove {
		actor, exists := actors[actorID]
		if !exists {
			return &encounterAccessError{Status: http.StatusBadRequest, Message: "нельзя удалить неизвестного участника боя"}
		}
		if caller != enc.OwnerUserID && (!actor.IsCharacter || actor.ControllerUserID != caller) {
			return &encounterAccessError{Status: http.StatusForbidden, Message: "удалить участника может мастер боя или контроллер персонажа"}
		}
	}

	if (req.Round != nil || req.ActiveIndex != nil) && caller != enc.OwnerUserID {
		return &encounterAccessError{Status: http.StatusForbidden, Message: "сменить ход может только мастер боя"}
	}
	if req.Round != nil && *req.Round < 1 {
		return &encounterAccessError{Status: http.StatusBadRequest, Message: "номер раунда должен быть положительным"}
	}
	if req.ActiveIndex != nil && *req.ActiveIndex < 0 {
		return &encounterAccessError{Status: http.StatusBadRequest, Message: "индекс хода не может быть отрицательным"}
	}

	knownActorIDs := make(map[string]struct{}, len(actors)+len(req.Add))
	knownCharacterIDs := make(map[uuid.UUID]struct{})
	for actorID, actor := range actors {
		knownActorIDs[actorID] = struct{}{}
		if actor.IsCharacter {
			knownCharacterIDs[actor.CharacterID] = struct{}{}
		}
	}
	for _, added := range req.Add {
		actorID, ok := added["actorId"].(string)
		actorID = strings.TrimSpace(actorID)
		if !ok || actorID == "" || len(actorID) > 255 {
			return &encounterAccessError{Status: http.StatusBadRequest, Message: "добавляемому участнику нужен корректный actorId"}
		}
		if _, duplicate := knownActorIDs[actorID]; duplicate {
			return &encounterAccessError{Status: http.StatusConflict, Message: "actorId уже используется в этом бою"}
		}
		knownActorIDs[actorID] = struct{}{}

		rawCharacterID, hasCharacter := added["characterId"]
		characterIDText := strings.TrimSpace(fmt.Sprint(rawCharacterID))
		if !hasCharacter || rawCharacterID == nil || characterIDText == "" {
			if caller != enc.OwnerUserID {
				return &encounterAccessError{Status: http.StatusForbidden, Message: "добавлять существ может только мастер боя"}
			}
			continue
		}
		characterID, err := uuid.Parse(characterIDText)
		if err != nil || characterID == uuid.Nil {
			return &encounterAccessError{Status: http.StatusBadRequest, Message: "неверный characterId"}
		}
		controller, exists := addedCharacterControllers[characterID]
		if !exists {
			return &encounterAccessError{Status: http.StatusBadRequest, Message: "персонаж не найден"}
		}
		if controller != caller {
			return &encounterAccessError{Status: http.StatusForbidden, Message: "добавить персонажа может только его контроллер"}
		}
		if _, duplicate := knownCharacterIDs[characterID]; duplicate {
			return &encounterAccessError{Status: http.StatusConflict, Message: "персонаж уже добавлен в этот бой"}
		}
		knownCharacterIDs[characterID] = struct{}{}
	}

	for _, entry := range req.Log {
		if strings.TrimSpace(entry.TargetCharacterID) == "" {
			continue
		}
		characterID, err := uuid.Parse(strings.TrimSpace(entry.TargetCharacterID))
		if err != nil {
			return &encounterAccessError{Status: http.StatusBadRequest, Message: "журнал ссылается на неверный characterId"}
		}
		if _, exists := knownCharacterIDs[characterID]; !exists {
			return &encounterAccessError{Status: http.StatusForbidden, Message: "нельзя писать в журнал персонажа вне этого боя"}
		}
	}

	return nil
}

func jsonCompatible(value interface{}) interface{} {
	b, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var result interface{}
	if err := json.Unmarshal(b, &result); err != nil {
		return nil
	}
	return result
}

func characterTempHP(character CharacterV3) float64 {
	if character.TurnState == nil {
		return 0
	}
	value := (*character.TurnState)["temp_hp"]
	switch n := value.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		parsed, _ := n.Float64()
		return parsed
	default:
		return 0
	}
}

// normalizeEncounterAdds replaces browser-supplied character identity and
// persistent runtime fields with the authoritative CharacterV3 snapshot.
func normalizeEncounterAdds(req ApplyRequest, characters map[uuid.UUID]CharacterV3) ApplyRequest {
	normalized := req
	normalized.Add = make([]map[string]interface{}, 0, len(req.Add))
	for _, added := range req.Add {
		actorID, _ := added["actorId"].(string)
		rawCharacterID, hasCharacter := added["characterId"]
		characterID, parseErr := uuid.Parse(strings.TrimSpace(fmt.Sprint(rawCharacterID)))
		if hasCharacter && rawCharacterID != nil && parseErr == nil {
			character := characters[characterID]
			combatant := map[string]interface{}{
				"actorId":       strings.TrimSpace(actorID),
				"name":          character.Name,
				"isMonster":     false,
				"characterId":   character.ID.String(),
				"ownerUserId":   character.UserID.String(),
				"hp":            character.CurrentHP,
				"maxHp":         character.MaxHP,
				"ac":            character.ArmorClass,
				"temp":          characterTempHP(character),
				"activeEffects": jsonCompatible(character.ActiveEffects),
				"avatarUrl":     character.AvatarURL,
			}
			if initiative, exists := added["initiative"]; exists && isJSONNumber(initiative) {
				combatant["initiative"] = initiative
			}
			normalized.Add = append(normalized.Add, combatant)
			continue
		}

		// A manual creature is encounter-owned data. Keep only the declared
		// combatant schema and never accept character/controller identity fields.
		combatant := map[string]interface{}{"actorId": strings.TrimSpace(actorID), "isMonster": true}
		for _, key := range []string{"name", "hp", "maxHp", "ac", "temp", "activeEffects", "pendingSaves", "pendingAttacks", "avatarUrl", "initiative"} {
			if value, exists := added[key]; exists {
				combatant[key] = value
			}
		}
		normalized.Add = append(normalized.Add, combatant)
	}
	return normalized
}
