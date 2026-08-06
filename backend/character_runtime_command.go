package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxCharacterRuntimeCommandBodyBytes = 2 << 20
	maxRuntimeCommandParticipants       = 16
	maxRuntimeCommandEvents             = 256
	maxRuntimeCommandTurnStateBytes     = 768 << 10
)

var runtimeCommandSHA256Pattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// CharacterRuntimeCommandRulesetRef is provenance for the immutable content
// release interpreted by the browser rules core. This endpoint persists an
// already-computed transition atomically; it does not claim to interpret D&D.
type CharacterRuntimeCommandRulesetRef struct {
	SystemID      string `json:"system_id"`
	ReleaseID     string `json:"release_id"`
	ContentHash   string `json:"content_hash"`
	ErrataVersion string `json:"errata_version"`
}

// CharacterRuntimeCommandPatch intentionally contains only engine-owned
// runtime channels. InventoryItems is a complete quantity snapshot: the
// transition validator permits consumption only and rejects additions,
// quantity increases and container moves. Equipment and item transfer remain
// separate mechanics and cannot be smuggled through a combat transaction.
type CharacterRuntimeCommandPatch struct {
	CurrentHP      *int               `json:"current_hp"`
	InventoryItems *InventoryItemRows `json:"inventory_items"`
	Resources      *JSONMap           `json:"resources"`
	MaxResources   *JSONMap           `json:"max_resources"`
	ActiveEffects  *ActiveEffectRows  `json:"active_effects"`
	TurnState      *JSONMap           `json:"turn_state"`
	Currency       *JSONMap           `json:"currency"`
}

type CharacterRuntimeCommandParticipant struct {
	CharacterID             string                       `json:"character_id"`
	ExpectedRuntimeRevision int64                        `json:"expected_runtime_revision"`
	Patch                   CharacterRuntimeCommandPatch `json:"patch"`
}

type CharacterRuntimeCommandEvent struct {
	CharacterID string  `json:"character_id"`
	Type        string  `json:"type"`
	Payload     JSONMap `json:"payload"`
}

type CharacterRuntimeCommandRequest struct {
	CommandID    string                               `json:"command_id"`
	RulesetRef   CharacterRuntimeCommandRulesetRef    `json:"ruleset_ref"`
	Participants []CharacterRuntimeCommandParticipant `json:"participants"`
	Events       []CharacterRuntimeCommandEvent       `json:"events"`
}

type CharacterRuntimeCommandParticipantResponse struct {
	CharacterID     string      `json:"character_id"`
	RuntimeRevision int64       `json:"runtime_revision"`
	Character       CharacterV3 `json:"character"`
}

type CharacterRuntimeCommandResponse struct {
	CommandID    string                                       `json:"command_id"`
	Replayed     bool                                         `json:"replayed"`
	Participants []CharacterRuntimeCommandParticipantResponse `json:"participants"`
}

// CharacterRuntimeCommandRecord is an append-only idempotency receipt. A
// matching retry returns Response and never appends CharacterEvent rows twice.
type CharacterRuntimeCommandRecord struct {
	UserID      uuid.UUID `json:"user_id" gorm:"type:uuid;primaryKey"`
	CommandID   uuid.UUID `json:"command_id" gorm:"type:uuid;primaryKey"`
	RequestHash string    `json:"request_hash" gorm:"type:varchar(71);not null"`
	RulesetRef  JSONMap   `json:"ruleset_ref" gorm:"type:jsonb;not null"`
	Response    JSONMap   `json:"response" gorm:"type:jsonb;not null"`
	CreatedAt   time.Time `json:"created_at"`
}

func (CharacterRuntimeCommandRecord) TableName() string { return "character_runtime_commands" }

type characterRuntimeCommandError struct {
	Status                  int
	Code                    string
	Message                 string
	CharacterID             string
	ExpectedRuntimeRevision *int64
	ActualRuntimeRevision   *int64
}

func (e *characterRuntimeCommandError) Error() string { return e.Message }

func writeCharacterRuntimeCommandError(c *gin.Context, err error) {
	var commandErr *characterRuntimeCommandError
	if !errors.As(err, &commandErr) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось сохранить команду правил"})
		return
	}
	payload := gin.H{"code": commandErr.Code, "error": commandErr.Message}
	if commandErr.CharacterID != "" {
		payload["character_id"] = commandErr.CharacterID
	}
	if commandErr.ExpectedRuntimeRevision != nil {
		payload["expected_runtime_revision"] = *commandErr.ExpectedRuntimeRevision
	}
	if commandErr.ActualRuntimeRevision != nil {
		payload["actual_runtime_revision"] = *commandErr.ActualRuntimeRevision
	}
	c.JSON(commandErr.Status, payload)
}

func invalidRuntimeCommand(message string) error {
	return &characterRuntimeCommandError{
		Status: http.StatusUnprocessableEntity,
		Code:   "invalid_runtime_command", Message: message,
	}
}

func decodeCharacterRuntimeCommand(raw []byte) (CharacterRuntimeCommandRequest, string, error) {
	var request CharacterRuntimeCommandRequest
	if len(raw) == 0 {
		return request, "", invalidRuntimeCommand("request body is required")
	}
	if int64(len(raw)) > maxCharacterRuntimeCommandBodyBytes {
		return request, "", &characterRuntimeCommandError{
			Status: http.StatusRequestEntityTooLarge,
			Code:   "runtime_command_too_large", Message: "request body is too large",
		}
	}
	_, canonical, err := canonicalizeRawJSON(raw)
	if err != nil {
		return request, "", invalidRuntimeCommand("request body must be unambiguous JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, "", invalidRuntimeCommand("request does not match the runtime command schema")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, "", invalidRuntimeCommand("request must contain exactly one JSON value")
	}
	return request, canonicalSHA256(canonical), nil
}

func validateRuntimeCommandMap(name string, value *JSONMap) error {
	if value == nil {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > maxRuntimeCommandTurnStateBytes {
		return invalidRuntimeCommand(name + " must be bounded JSON")
	}
	for key, raw := range *value {
		if strings.TrimSpace(key) == "" || len(key) > 255 {
			return invalidRuntimeCommand(name + " contains an invalid key")
		}
		if name == "turn_state" {
			continue
		}
		if raw == nil {
			return invalidRuntimeCommand(name + "." + key + " must be a bounded non-negative integer")
		}
		if !boundedJSONInteger(raw, 0, maxEncounterRuntimeValue) {
			return invalidRuntimeCommand(name + "." + key + " must be a bounded non-negative integer")
		}
	}
	return nil
}

func validateRuntimeCommandPatch(patch CharacterRuntimeCommandPatch) error {
	if patch.CurrentHP == nil && patch.Resources == nil && patch.MaxResources == nil &&
		patch.InventoryItems == nil && patch.ActiveEffects == nil && patch.TurnState == nil && patch.Currency == nil {
		return invalidRuntimeCommand("participant patch cannot be empty")
	}
	if patch.CurrentHP != nil && (*patch.CurrentHP < 0 || *patch.CurrentHP > maxEncounterRuntimeValue) {
		return invalidRuntimeCommand("current_hp must be a bounded non-negative integer")
	}
	for name, value := range map[string]*JSONMap{
		"resources": patch.Resources, "max_resources": patch.MaxResources,
		"turn_state": patch.TurnState, "currency": patch.Currency,
	} {
		if err := validateRuntimeCommandMap(name, value); err != nil {
			return err
		}
	}
	if patch.ActiveEffects != nil {
		if len(*patch.ActiveEffects) > maxEncounterRuntimeRows {
			return invalidRuntimeCommand("active_effects has too many rows")
		}
		for index, effect := range *patch.ActiveEffects {
			generic := jsonCompatible(effect)
			if !validActiveEffectValue(generic) {
				return invalidRuntimeCommand(fmt.Sprintf("active_effects[%d] is invalid", index))
			}
		}
	}
	if err := validateRuntimeCommandInventoryRows(patch.InventoryItems); err != nil {
		return err
	}
	return nil
}

func runtimeInventoryIdentity(row InventoryItemRow) string {
	return row.CardID + "\x00" + row.ContainerID
}

func canonicalRuntimeInventoryUUID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed != uuid.Nil && parsed.String() == value
}

func validateRuntimeCommandInventoryRows(rows *InventoryItemRows) error {
	if rows == nil {
		return nil
	}
	if len(*rows) > maxEncounterRuntimeRows {
		return invalidRuntimeCommand("inventory_items has too many rows")
	}
	identities := make(map[string]struct{}, len(*rows))
	cardIDs := make(map[string]struct{}, len(*rows))
	for index, row := range *rows {
		if !canonicalRuntimeInventoryUUID(row.CardID) {
			return invalidRuntimeCommand(fmt.Sprintf(
				"inventory_items[%d].card_id must be a canonical UUID", index,
			))
		}
		if row.Qty <= 0 || row.Qty > maxEncounterRuntimeValue {
			return invalidRuntimeCommand(fmt.Sprintf(
				"inventory_items[%d].qty must be a bounded positive integer", index,
			))
		}
		if row.ContainerID != "" {
			if !canonicalRuntimeInventoryUUID(row.ContainerID) || row.ContainerID == row.CardID {
				return invalidRuntimeCommand(fmt.Sprintf(
					"inventory_items[%d].container_id is invalid", index,
				))
			}
		}
		identity := runtimeInventoryIdentity(row)
		if _, duplicate := identities[identity]; duplicate {
			return invalidRuntimeCommand("inventory_items contains a duplicate card/container row")
		}
		identities[identity] = struct{}{}
		cardIDs[row.CardID] = struct{}{}
	}
	for index, row := range *rows {
		if row.ContainerID == "" {
			continue
		}
		if _, exists := cardIDs[row.ContainerID]; !exists {
			return invalidRuntimeCommand(fmt.Sprintf(
				"inventory_items[%d].container_id references a missing inventory card", index,
			))
		}
	}
	return nil
}

func validateRuntimeInventoryConsumption(
	current *InventoryItemRows,
	next *InventoryItemRows,
) error {
	if next == nil {
		return nil
	}
	if err := validateRuntimeCommandInventoryRows(current); err != nil {
		return invalidRuntimeCommand("stored inventory_items is not a valid runtime snapshot")
	}
	currentRows := InventoryItemRows{}
	if current != nil {
		currentRows = *current
	}
	available := make(map[string]int, len(currentRows))
	for _, row := range currentRows {
		available[runtimeInventoryIdentity(row)] = row.Qty
	}
	for _, row := range *next {
		quantity, exists := available[runtimeInventoryIdentity(row)]
		if !exists {
			return invalidRuntimeCommand(
				"inventory_items cannot add cards or move them between containers",
			)
		}
		if row.Qty > quantity {
			return invalidRuntimeCommand("inventory_items cannot increase quantities")
		}
	}
	return nil
}

func validateCharacterRuntimeCommand(request CharacterRuntimeCommandRequest) (uuid.UUID, []uuid.UUID, error) {
	commandID, err := uuid.Parse(request.CommandID)
	if err != nil || commandID == uuid.Nil || commandID.String() != request.CommandID {
		return uuid.Nil, nil, invalidRuntimeCommand("command_id must be a canonical UUID")
	}
	if request.RulesetRef.SystemID != DefaultCharacterSystemID ||
		strings.TrimSpace(request.RulesetRef.ReleaseID) == "" || request.RulesetRef.ReleaseID != strings.TrimSpace(request.RulesetRef.ReleaseID) || len(request.RulesetRef.ReleaseID) > 255 ||
		!runtimeCommandSHA256Pattern.MatchString(request.RulesetRef.ContentHash) ||
		strings.TrimSpace(request.RulesetRef.ErrataVersion) == "" || request.RulesetRef.ErrataVersion != strings.TrimSpace(request.RulesetRef.ErrataVersion) || len(request.RulesetRef.ErrataVersion) > 100 {
		return uuid.Nil, nil, invalidRuntimeCommand("ruleset_ref is incomplete or invalid")
	}
	if len(request.Participants) == 0 || len(request.Participants) > maxRuntimeCommandParticipants {
		return uuid.Nil, nil, invalidRuntimeCommand("participants must contain 1 to 16 characters")
	}
	if len(request.Events) > maxRuntimeCommandEvents {
		return uuid.Nil, nil, invalidRuntimeCommand("events has too many rows")
	}

	participantIDs := make([]uuid.UUID, 0, len(request.Participants))
	participantSet := make(map[uuid.UUID]struct{}, len(request.Participants))
	previous := ""
	for index, participant := range request.Participants {
		characterID, parseErr := uuid.Parse(participant.CharacterID)
		if parseErr != nil || characterID == uuid.Nil || characterID.String() != participant.CharacterID {
			return uuid.Nil, nil, invalidRuntimeCommand(fmt.Sprintf("participants[%d].character_id must be a canonical UUID", index))
		}
		if previous != "" && participant.CharacterID <= previous {
			return uuid.Nil, nil, invalidRuntimeCommand("participants must be unique and sorted by character_id")
		}
		previous = participant.CharacterID
		if participant.ExpectedRuntimeRevision < 0 {
			return uuid.Nil, nil, invalidRuntimeCommand("expected_runtime_revision cannot be negative")
		}
		if err := validateRuntimeCommandPatch(participant.Patch); err != nil {
			return uuid.Nil, nil, err
		}
		participantIDs = append(participantIDs, characterID)
		participantSet[characterID] = struct{}{}
	}
	for index, event := range request.Events {
		characterID, parseErr := uuid.Parse(event.CharacterID)
		if parseErr != nil || characterID == uuid.Nil || characterID.String() != event.CharacterID {
			return uuid.Nil, nil, invalidRuntimeCommand(fmt.Sprintf("events[%d].character_id must be a canonical UUID", index))
		}
		if _, ok := participantSet[characterID]; !ok {
			return uuid.Nil, nil, invalidRuntimeCommand("event character_id must be a command participant")
		}
		if err := validateCharacterEvent(event.Type, event.Payload); err != nil {
			return uuid.Nil, nil, invalidRuntimeCommand(fmt.Sprintf("events[%d]: %s", index, err))
		}
	}
	return commandID, participantIDs, nil
}

func mergeRuntimeCommandTurnState(current *JSONMap, patch *JSONMap) *JSONMap {
	if patch == nil {
		return current
	}
	merged := cloneJSONMapValue(current)
	for key, value := range *patch {
		if value == nil {
			delete(merged, key)
			continue
		}
		merged[key] = value
	}
	return &merged
}

func runtimeCommandUpdates(character CharacterV3, patch CharacterRuntimeCommandPatch) (map[string]interface{}, error) {
	updates := map[string]interface{}{}
	if patch.CurrentHP != nil {
		if *patch.CurrentHP > character.MaxHP {
			return nil, invalidRuntimeCommand("current_hp cannot exceed max_hp")
		}
		updates["current_hp"] = *patch.CurrentHP
	}
	if patch.InventoryItems != nil {
		if err := validateRuntimeInventoryConsumption(character.InventoryItems, patch.InventoryItems); err != nil {
			return nil, err
		}
		updates["inventory_items"] = patch.InventoryItems
	}
	if patch.Resources != nil {
		updates["resources"] = patch.Resources
	}
	if patch.MaxResources != nil {
		updates["max_resources"] = patch.MaxResources
	}
	effectiveResources := character.Resources
	if patch.Resources != nil {
		effectiveResources = patch.Resources
	}
	effectiveMaximums := character.MaxResources
	if patch.MaxResources != nil {
		effectiveMaximums = patch.MaxResources
	}
	if effectiveResources != nil && effectiveMaximums != nil {
		for resource, current := range *effectiveResources {
			maximum, bounded := (*effectiveMaximums)[resource]
			if !bounded {
				continue
			}
			currentNumber, currentOK := jsonNumberAsInt64(current)
			maximumNumber, maximumOK := jsonNumberAsInt64(maximum)
			if !currentOK || !maximumOK || currentNumber > maximumNumber {
				return nil, invalidRuntimeCommand("resource " + resource + " exceeds its declared maximum")
			}
		}
	}
	if patch.ActiveEffects != nil {
		updates["active_effects"] = patch.ActiveEffects
	}
	if patch.TurnState != nil {
		updates["turn_state"] = mergeRuntimeCommandTurnState(character.TurnState, patch.TurnState)
	}
	if patch.Currency != nil {
		updates["currency"] = patch.Currency
	}
	updates["runtime_revision"] = character.RuntimeRevision + 1
	return updates, nil
}

func jsonNumberAsInt64(value any) (int64, bool) {
	if !boundedJSONInteger(value, 0, maxEncounterRuntimeValue) {
		return 0, false
	}
	switch number := value.(type) {
	case json.Number:
		parsed, err := number.Int64()
		return parsed, err == nil
	case float64:
		return int64(number), true
	case float32:
		return int64(number), true
	case int:
		return int64(number), true
	case int8:
		return int64(number), true
	case int16:
		return int64(number), true
	case int32:
		return int64(number), true
	case int64:
		return number, true
	case uint:
		return int64(number), true
	case uint8:
		return int64(number), true
	case uint16:
		return int64(number), true
	case uint32:
		return int64(number), true
	case uint64:
		return int64(number), uint64(int64(number)) == number
	default:
		return 0, false
	}
}

func responseToJSONMap(response CharacterRuntimeCommandResponse) (JSONMap, error) {
	encoded, err := json.Marshal(response)
	if err != nil {
		return nil, err
	}
	var result JSONMap
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func rulesetRefToJSONMap(reference CharacterRuntimeCommandRulesetRef) (JSONMap, error) {
	encoded, err := json.Marshal(reference)
	if err != nil {
		return nil, err
	}
	var result JSONMap
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// PostCharacterRuntimeCommand atomically persists one deterministic rules-core
// result across all touched sheets owned by the caller. It supplies storage,
// CAS and replay guarantees only; semantic authority remains the pinned local
// rules artifact until a server worker executes the same release.
func (cc *CharacterV3Controller) PostCharacterRuntimeCommand(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	raw, err := c.GetRawData()
	if err != nil {
		writeCharacterRuntimeCommandError(c, invalidRuntimeCommand("request body cannot be read"))
		return
	}
	request, requestHash, err := decodeCharacterRuntimeCommand(raw)
	if err != nil {
		writeCharacterRuntimeCommandError(c, err)
		return
	}
	commandID, participantIDs, err := validateCharacterRuntimeCommand(request)
	if err != nil {
		writeCharacterRuntimeCommandError(c, err)
		return
	}

	var response JSONMap
	txErr := cc.db.Transaction(func(tx *gorm.DB) error {
		// A per-caller command lock closes the race between the initial replay
		// lookup and the unique ledger insert without blocking unrelated sheets.
		lockKey := userID.String() + ":" + commandID.String()
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", lockKey).Error; err != nil {
			return err
		}
		var receipt CharacterRuntimeCommandRecord
		lookup := tx.Where("user_id = ? AND command_id = ?", userID, commandID).First(&receipt)
		if lookup.Error == nil {
			if receipt.RequestHash != requestHash {
				return &characterRuntimeCommandError{
					Status: http.StatusConflict, Code: "command_id_reuse",
					Message: "command_id already belongs to another request",
				}
			}
			response = cloneJSONMapValue(&receipt.Response)
			response["replayed"] = true
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}

		var characters []CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id IN ? AND user_id = ?", participantIDs, userID).
			Order("id asc").Find(&characters).Error; err != nil {
			return err
		}
		if len(characters) != len(participantIDs) {
			return &characterRuntimeCommandError{
				Status: http.StatusForbidden, Code: "runtime_command_forbidden",
				Message: "all command participants must be writable characters owned by the caller",
			}
		}
		byID := make(map[string]CharacterV3, len(characters))
		for _, character := range characters {
			byID[character.ID.String()] = character
		}
		for _, participant := range request.Participants {
			character := byID[participant.CharacterID]
			if character.SystemID != request.RulesetRef.SystemID {
				return invalidRuntimeCommand("ruleset_ref system_id does not match a participant")
			}
			if character.CurrentEncounterID != nil {
				return &characterRuntimeCommandError{
					Status: http.StatusConflict, Code: "character_linked_encounter",
					Message:     "linked encounter runtime must be changed through encounter authority",
					CharacterID: participant.CharacterID,
				}
			}
			if character.RuntimeRevision != participant.ExpectedRuntimeRevision {
				expected := participant.ExpectedRuntimeRevision
				actual := character.RuntimeRevision
				return &characterRuntimeCommandError{
					Status: http.StatusConflict, Code: "runtime_revision_conflict",
					Message: "character runtime revision is stale", CharacterID: participant.CharacterID,
					ExpectedRuntimeRevision: &expected, ActualRuntimeRevision: &actual,
				}
			}
		}

		participantResponses := make([]CharacterRuntimeCommandParticipantResponse, 0, len(request.Participants))
		for _, participant := range request.Participants {
			character := byID[participant.CharacterID]
			updates, updateErr := runtimeCommandUpdates(character, participant.Patch)
			if updateErr != nil {
				return updateErr
			}
			result := tx.Model(&CharacterV3{}).
				Where("id = ? AND user_id = ? AND runtime_revision = ?", character.ID, userID, participant.ExpectedRuntimeRevision).
				Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				expected := participant.ExpectedRuntimeRevision
				return &characterRuntimeCommandError{
					Status: http.StatusConflict, Code: "runtime_revision_conflict",
					Message: "character runtime revision changed during commit", CharacterID: participant.CharacterID,
					ExpectedRuntimeRevision: &expected,
				}
			}
			var full CharacterV3
			if err := tx.Preload("User").Preload("Group").First(&full, "id = ?", character.ID).Error; err != nil {
				return err
			}
			full.AccessMode = characterV3AccessOwner
			participantResponses = append(participantResponses, CharacterRuntimeCommandParticipantResponse{
				CharacterID: full.ID.String(), RuntimeRevision: full.RuntimeRevision, Character: full,
			})
		}

		now := time.Now()
		for _, event := range request.Events {
			characterID := uuid.MustParse(event.CharacterID)
			row := CharacterEvent{
				CharacterID: characterID, Ts: now, Type: event.Type, Payload: event.Payload,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}

		committed := CharacterRuntimeCommandResponse{
			CommandID: request.CommandID, Replayed: false, Participants: participantResponses,
		}
		responseMap, mapErr := responseToJSONMap(committed)
		if mapErr != nil {
			return mapErr
		}
		rulesetMap, mapErr := rulesetRefToJSONMap(request.RulesetRef)
		if mapErr != nil {
			return mapErr
		}
		receipt = CharacterRuntimeCommandRecord{
			UserID: userID, CommandID: commandID, RequestHash: requestHash,
			RulesetRef: rulesetMap, Response: responseMap,
		}
		if err := tx.Create(&receipt).Error; err != nil {
			return err
		}
		response = responseMap
		return nil
	})
	if txErr != nil {
		writeCharacterRuntimeCommandError(c, txErr)
		return
	}
	c.JSON(http.StatusOK, response)
}

// stableCharacterRuntimeParticipantIDs is kept small and pure for tests and
// adapters that need to prove canonical participant ordering.
func stableCharacterRuntimeParticipantIDs(ids []string) []string {
	result := append([]string(nil), ids...)
	sort.Strings(result)
	return result
}
