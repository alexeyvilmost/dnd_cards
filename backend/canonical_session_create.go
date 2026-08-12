package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxCanonicalSessionCreateBodyBytes int64 = 2 << 20

type canonicalSessionCreateRequest struct {
	CharacterIDs      []string        `json:"characterIds"`
	RulesArtifactHash string          `json:"rulesArtifactHash"`
	World             json.RawMessage `json:"world"`
}

func (controller *CanonicalSessionController) CloseServerSession(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication is required"})
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil || sessionID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid canonical session id"})
		return
	}
	err = controller.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var session canonicalSessionRow
		result := tx.Raw(`
			SELECT id, authority_mode, status, revision, snapshot_seq, state_hash
			FROM game_sessions WHERE id = ? FOR UPDATE
		`, sessionID).Scan(&session)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return canonicalProblem(http.StatusNotFound, "canonical session was not found")
		}
		var owner int64
		if queryErr := tx.Raw(`
			SELECT count(*) FROM game_session_members
			WHERE session_id = ? AND user_id = ? AND role IN ('owner', 'gm') AND status = 'active'
		`, sessionID, userID).Scan(&owner).Error; queryErr != nil {
			return queryErr
		}
		if owner != 1 {
			return canonicalProblem(http.StatusForbidden, "only an active session owner or GM may close it")
		}
		if session.AuthorityMode != "server" {
			return canonicalProblem(http.StatusConflict, "only server-authority sessions use this close endpoint")
		}
		if session.Status == "closed" {
			return nil
		}
		if session.Status != "active" {
			return canonicalProblem(http.StatusConflict, "canonical session is not active")
		}
		var openDecisions int64
		if queryErr := tx.Raw(`
			SELECT count(*) FROM decision_requests WHERE session_id = ? AND status = 'open'
		`, sessionID).Scan(&openDecisions).Error; queryErr != nil {
			return queryErr
		}
		if openDecisions != 0 {
			return canonicalProblem(http.StatusConflict, "resolve the pending decision before closing the session")
		}
		now := time.Now().UTC()
		// The character rows are compatibility projections only. Remove their
		// continuation marker in the same transaction that releases the server
		// writer lock, so a closed session cannot leave sheets permanently blocked.
		if queryErr := tx.Exec(`
			UPDATE characters_v3
			SET turn_state = COALESCE(turn_state, '{}'::jsonb) - 'canonical_pending_combat_v1',
				runtime_revision = runtime_revision + 1, updated_at = ?
			WHERE id IN (
				SELECT character_id FROM game_session_actors
				WHERE session_id = ? AND lifecycle_status = 'active' AND character_id IS NOT NULL
			)
		`, now, sessionID).Error; queryErr != nil {
			return normalizeCanonicalDatabaseError(queryErr)
		}
		if queryErr := tx.Exec(`
			UPDATE game_sessions SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?
		`, now, now, sessionID).Error; queryErr != nil {
			return normalizeCanonicalDatabaseError(queryErr)
		}
		return tx.Exec(`
			UPDATE game_session_actors
			SET lifecycle_status = 'removed', character_id = NULL, updated_at = ?
			WHERE session_id = ? AND lifecycle_status = 'active'
		`, now, sessionID).Error
	})
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessionId": sessionID, "status": "closed"})
}

func decodeCanonicalSessionCreate(body io.Reader) (canonicalSessionCreateRequest, any, []byte, error) {
	var request canonicalSessionCreateRequest
	raw, err := io.ReadAll(io.LimitReader(body, maxCanonicalSessionCreateBodyBytes+1))
	if err != nil || int64(len(raw)) > maxCanonicalSessionCreateBodyBytes {
		return request, nil, nil, canonicalProblem(http.StatusRequestEntityTooLarge, "canonical session genesis is too large")
	}
	root, _, err := canonicalizeRawJSON(raw)
	if err != nil {
		return request, nil, nil, canonicalProblem(http.StatusBadRequest, "canonical session genesis contains invalid JSON")
	}
	object, ok := root.(map[string]any)
	if !ok || len(object) != 3 {
		return request, nil, nil, canonicalProblem(http.StatusBadRequest, "canonical session genesis has unknown or missing fields")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&request); err != nil || requireJSONEOF(decoder) != nil {
		return request, nil, nil, canonicalProblem(http.StatusBadRequest, "canonical session genesis envelope is invalid")
	}
	if len(request.CharacterIDs) < 2 || len(request.CharacterIDs) > 16 ||
		!canonicalTransportSHA256Pattern.MatchString(request.RulesArtifactHash) {
		return request, nil, nil, canonicalProblem(http.StatusUnprocessableEntity, "canonical session requires 2-16 characters and a pinned rules artifact")
	}
	previous := ""
	for _, value := range request.CharacterIDs {
		parsed, parseErr := uuid.Parse(value)
		if parseErr != nil || parsed == uuid.Nil || parsed.String() != value || (previous != "" && value <= previous) {
			return request, nil, nil, canonicalProblem(http.StatusUnprocessableEntity, "characterIds must contain sorted unique canonical UUIDs")
		}
		previous = value
	}
	worldValue, worldCanonical, err := canonicalizeRawJSON(request.World)
	if err != nil {
		return request, nil, nil, canonicalProblem(http.StatusUnprocessableEntity, "canonical session WorldState is invalid")
	}
	if _, err = inspectCanonicalWorld(worldValue); err != nil {
		return request, nil, nil, err
	}
	return request, worldValue, worldCanonical, nil
}

func normalizedServerGenesis(value any, controllerID uuid.UUID) (any, []byte, canonicalWorldView, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, nil, canonicalWorldView{}, err
	}
	cloned, _, err := canonicalizeRawJSON(encoded)
	if err != nil {
		return nil, nil, canonicalWorldView{}, err
	}
	root := cloned.(map[string]any)
	actors := root["actors"].(map[string]any)
	for _, rawActor := range actors {
		actor, ok := rawActor.(map[string]any)
		if !ok {
			return nil, nil, canonicalWorldView{}, canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis contains an invalid actor")
		}
		actor["controllerId"] = controllerID.String()
	}
	canonical, err := canonicalJSON(root)
	if err != nil {
		return nil, nil, canonicalWorldView{}, err
	}
	world, err := inspectCanonicalWorld(root)
	return root, canonical, world, err
}

func persistedCombatGenesis(character CharacterV3) ([]byte, []string, error) {
	if character.TurnState == nil {
		return nil, nil, canonicalProblem(http.StatusConflict, "character has no imported canonical combat genesis")
	}
	envelope, ok := (*character.TurnState)["canonical_pending_combat_v1"].(map[string]any)
	if !ok {
		return nil, nil, canonicalProblem(http.StatusConflict, "character has no imported canonical combat genesis")
	}
	world, ok := envelope["world"].(map[string]any)
	if !ok {
		return nil, nil, canonicalProblem(http.StatusConflict, "stored canonical combat genesis is malformed")
	}
	participants, ok := envelope["participantRevisions"].(map[string]any)
	if !ok {
		return nil, nil, canonicalProblem(http.StatusConflict, "stored canonical combat participant set is malformed")
	}
	ids := make([]string, 0, len(participants))
	for id := range participants {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	canonical, err := canonicalJSON(world)
	return canonical, ids, err
}

func sameStringSlice(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

var genesisRuleCardFields = []string{
	"id", "card_number", "properties", "bonus_value", "damage_type", "enchant_bonus",
	"defense_type", "type", "weapon_type", "mastery", "attunement",
	"requires_attunement", "range", "tags", "slot", "effects", "mechanics",
	"battle_profile", "container_mode", "contents",
}

func canonicalRuleCardProjection(card map[string]any) ([]byte, error) {
	projection := make(map[string]any, len(genesisRuleCardFields))
	for _, field := range genesisRuleCardFields {
		projection[field] = card[field]
	}
	return canonicalJSON(projection)
}

func validateGenesisActorCards(tx *gorm.DB, actor map[string]any) error {
	context, ok := actor["character"].(map[string]any)
	if !ok {
		return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis character context is invalid")
	}
	declared := make(map[string][]byte)
	for _, field := range []string{"knownCards", "equippedCards"} {
		rawCards, present := context[field]
		if !present {
			continue
		}
		cards, ok := rawCards.([]any)
		if !ok {
			return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis "+field+" is invalid")
		}
		for _, rawCard := range cards {
			card, ok := rawCard.(map[string]any)
			cardID, idOK := card["id"].(string)
			parsedCardID, parseErr := uuid.Parse(cardID)
			if !ok || !idOK || parseErr != nil || parsedCardID == uuid.Nil {
				return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis contains an invalid Card reference")
			}
			projection, projectionErr := canonicalRuleCardProjection(card)
			if projectionErr != nil {
				return projectionErr
			}
			if previous, exists := declared[cardID]; exists && !bytes.Equal(previous, projection) {
				return canonicalProblem(http.StatusConflict, "canonical genesis contains conflicting Card projections")
			}
			declared[cardID] = projection
		}
	}
	if len(declared) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(declared))
	for id := range declared {
		ids = append(ids, uuid.MustParse(id))
	}
	var stored []Card
	if err := tx.Where("id IN ?", ids).Find(&stored).Error; err != nil {
		return err
	}
	if len(stored) != len(declared) {
		return canonicalProblem(http.StatusConflict, "canonical genesis references a Card absent from the database")
	}
	for _, card := range stored {
		encoded, err := json.Marshal(card.ToCardResponse())
		if err != nil {
			return err
		}
		var value map[string]any
		if err = json.Unmarshal(encoded, &value); err != nil {
			return err
		}
		projection, err := canonicalRuleCardProjection(value)
		if err != nil {
			return err
		}
		if !bytes.Equal(projection, declared[card.ID.String()]) {
			return canonicalProblem(http.StatusConflict, "canonical genesis Card mechanics differ from the database")
		}
	}
	return nil
}

func validateGenesisActorAgainstCharacter(tx *gorm.DB, actor map[string]any, character CharacterV3) error {
	if actor["id"] != character.ID.String() || actor["kind"] != "playerCharacter" {
		return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis actor identity differs from its character")
	}
	runtime, ok := actor["runtime"].(map[string]any)
	if !ok {
		return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis actor runtime is invalid")
	}
	hp, hpOK := runtime["hp"].(map[string]any)
	currentHP, currentOK := canonicalJSONInteger(hp["current"])
	maxHP, maxOK := canonicalJSONInteger(hp["max"])
	tempHP, tempOK := canonicalJSONInteger(hp["temp"])
	storedTemp := int64(0)
	if character.TurnState != nil {
		if rawTemp, exists := (*character.TurnState)["temp_hp"]; exists {
			storedTemp, tempOK = jsonNumberAsInt64(rawTemp)
		}
	}
	if !hpOK || !currentOK || !maxOK || !tempOK || currentHP != int64(character.CurrentHP) ||
		maxHP != int64(character.MaxHP) || tempHP != storedTemp {
		return canonicalProblem(http.StatusConflict, "canonical genesis HP differs from the stored character runtime")
	}
	// CharacterV3 predates the canonical runtime contract and represents an
	// untouched JSONB container as SQL NULL. The domain model has no nullable
	// collection here: its neutral values are {} for maps and [] for effects.
	// Compare those semantic values so a freshly-created, unequipped character
	// can enter its first authoritative session without weakening validation of
	// any populated runtime field.
	storedResources := any(map[string]any{})
	if character.Resources != nil {
		storedResources = character.Resources
	}
	storedMaxResources := any(map[string]any{})
	if character.MaxResources != nil {
		storedMaxResources = character.MaxResources
	}
	storedEquipment := any(map[string]any{})
	if character.Equipment != nil {
		storedEquipment = character.Equipment
	}
	storedActiveEffects := any([]any{})
	if character.ActiveEffects != nil {
		storedActiveEffects = character.ActiveEffects
	}
	for label, values := range map[string][2]any{
		"resources":     {runtime["resources"], storedResources},
		"maxResources":  {runtime["maxResources"], storedMaxResources},
		"equipment":     {runtime["equipment"], storedEquipment},
		"activeEffects": {runtime["activeEffects"], storedActiveEffects},
	} {
		left, leftErr := canonicalRuntimeProjectionValue(values[0])
		right, rightErr := canonicalRuntimeProjectionValue(values[1])
		if leftErr != nil || rightErr != nil || !bytes.Equal(left, right) {
			return canonicalProblem(http.StatusConflict, "canonical genesis "+label+" differs from the stored character runtime")
		}
	}
	expectedInventory := make([]map[string]any, 0)
	if character.InventoryItems != nil {
		for _, row := range *character.InventoryItems {
			projected := map[string]any{"cardId": row.CardID, "qty": row.Qty}
			if row.ContainerID != "" {
				projected["containerId"] = row.ContainerID
			}
			expectedInventory = append(expectedInventory, projected)
		}
	}
	leftInventory, _ := canonicalRuntimeProjectionValue(runtime["inventory"])
	rightInventory, _ := canonicalRuntimeProjectionValue(expectedInventory)
	if !bytes.Equal(leftInventory, rightInventory) {
		return canonicalProblem(http.StatusConflict, "canonical genesis inventory differs from the stored character runtime")
	}
	context, ok := actor["character"].(map[string]any)
	if !ok {
		return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis character context is invalid")
	}
	level, levelOK := canonicalJSONInteger(context["level"])
	profBonus, profOK := canonicalJSONInteger(context["profBonus"])
	if !levelOK || !profOK || level != int64(character.Level) || profBonus != int64(character.ProficiencyBonus) {
		return canonicalProblem(http.StatusConflict, "canonical genesis level/proficiency differs from the stored character build")
	}
	return validateGenesisActorCards(tx, actor)
}

func (controller *CanonicalSessionController) CreateServerSession(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication is required"})
		return
	}
	request, clientWorldValue, clientWorldCanonical, err := decodeCanonicalSessionCreate(c.Request.Body)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	_, normalizedCanonical, normalizedWorld, err := normalizedServerGenesis(clientWorldValue, userID)
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	stateHash := canonicalSHA256(normalizedCanonical)
	validation, err := controller.worker.Validate(c.Request.Context(), rulesWorkerValidateRequest{
		ProtocolVersion: rulesWorkerProtocolVersion, RulesArtifactHash: request.RulesArtifactHash,
		StateHash: stateHash, World: json.RawMessage(normalizedCanonical),
	})
	if err != nil {
		writeCanonicalError(c, canonicalProblem(http.StatusUnprocessableEntity, err.Error()))
		return
	}

	characterUUIDs := make([]uuid.UUID, len(request.CharacterIDs))
	for index, id := range request.CharacterIDs {
		characterUUIDs[index] = uuid.MustParse(id)
	}
	var sessionID uuid.UUID
	err = controller.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var activeRows []struct {
			SessionID uuid.UUID `gorm:"column:session_id"`
		}
		if queryErr := tx.Raw(`
			SELECT DISTINCT actor.session_id
			FROM game_session_actors actor
			JOIN game_sessions session ON session.id = actor.session_id
			WHERE actor.character_id IN ? AND actor.lifecycle_status = 'active'
				AND session.status = 'active' AND session.authority_mode = 'server'
		`, characterUUIDs).Scan(&activeRows).Error; queryErr != nil {
			return queryErr
		}
		if len(activeRows) > 0 {
			if len(activeRows) != 1 {
				return canonicalProblem(http.StatusConflict, "characters already belong to different active rules sessions")
			}
			var existingIDs []string
			if queryErr := tx.Raw(`
				SELECT character_id::text FROM game_session_actors
				WHERE session_id = ? AND lifecycle_status = 'active' AND character_id IS NOT NULL
				ORDER BY character_id::text
			`, activeRows[0].SessionID).Scan(&existingIDs).Error; queryErr != nil {
				return queryErr
			}
			var membership int64
			if queryErr := tx.Raw(`
				SELECT count(*) FROM game_session_members
				WHERE session_id = ? AND user_id = ? AND status = 'active' AND role <> 'observer'
			`, activeRows[0].SessionID, userID).Scan(&membership).Error; queryErr != nil {
				return queryErr
			}
			if !sameStringSlice(existingIDs, request.CharacterIDs) || membership != 1 {
				return canonicalProblem(http.StatusConflict, "an active rules session has another participant set or controller")
			}
			sessionID = activeRows[0].SessionID
			return nil
		}

		var characters []CharacterV3
		if queryErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id IN ? AND user_id = ?", characterUUIDs, userID).
			Order("id asc").Find(&characters).Error; queryErr != nil {
			return queryErr
		}
		if len(characters) != len(characterUUIDs) {
			return canonicalProblem(http.StatusForbidden, "all canonical session characters must be owned by the caller")
		}
		for _, character := range characters {
			if character.CurrentEncounterID != nil {
				return canonicalProblem(http.StatusConflict, "a canonical session character is already linked to an online encounter")
			}
			storedWorld, participantIDs, storedErr := persistedCombatGenesis(character)
			if storedErr != nil {
				return storedErr
			}
			if !bytes.Equal(storedWorld, clientWorldCanonical) || !sameStringSlice(participantIDs, request.CharacterIDs) {
				return canonicalProblem(http.StatusConflict, "stored legacy genesis differs from the requested canonical session")
			}
			actor, ok := normalizedWorld.actors[character.ID.String()].(map[string]any)
			if !ok {
				return canonicalProblem(http.StatusUnprocessableEntity, "canonical genesis misses a character actor")
			}
			if actorErr := validateGenesisActorAgainstCharacter(tx, actor, character); actorErr != nil {
				return actorErr
			}
		}
		var release struct {
			ID                uuid.UUID `gorm:"column:id"`
			SerializerVersion string    `gorm:"column:serializer_version"`
		}
		ruleset := normalizedWorld.root["ruleset"].(map[string]any)
		result := tx.Raw(`
			SELECT id, serializer_version FROM ruleset_releases
			WHERE rules_artifact_hash = ? AND content_hash = ? AND status = 'active'
		`, request.RulesArtifactHash, ruleset["contentHash"]).Scan(&release)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return canonicalProblem(http.StatusConflict, "the certified rules release is not registered in the database")
		}
		sessionID = uuid.New()
		if queryErr := tx.Exec(`
			INSERT INTO game_sessions (
				id, ruleset_release_id, rules_artifact_hash, created_by_user_id,
				mode, authority_mode, status, current_snapshot, snapshot_canonical_bytes,
				snapshot_schema_version, serializer_version, snapshot_seq, revision, state_hash
			) VALUES (?, ?, ?, ?, ?, 'server', 'active', ?::jsonb, ?, 5, ?, 0, ?, ?)
		`, sessionID, release.ID, request.RulesArtifactHash, userID, normalizedWorld.mode,
			string(normalizedCanonical), normalizedCanonical, release.SerializerVersion,
			normalizedWorld.revision, stateHash).Error; queryErr != nil {
			return normalizeCanonicalDatabaseError(queryErr)
		}
		if queryErr := tx.Exec(`
			INSERT INTO game_session_members (id, session_id, user_id, role, status, can_control_unowned_actors)
			VALUES (?, ?, ?, 'owner', 'active', TRUE)
		`, uuid.New(), sessionID, userID).Error; queryErr != nil {
			return normalizeCanonicalDatabaseError(queryErr)
		}
		characterSet := make(map[string]struct{}, len(request.CharacterIDs))
		for _, id := range request.CharacterIDs {
			characterSet[id] = struct{}{}
		}
		for worldActorID, rawActor := range normalizedWorld.actors {
			actor := rawActor.(map[string]any)
			kind, _ := actor["kind"].(string)
			actorKind := "summoned_actor"
			var characterID any
			if _, primary := characterSet[worldActorID]; primary {
				if kind != "playerCharacter" {
					return canonicalProblem(http.StatusUnprocessableEntity, "a characterId does not identify a playerCharacter actor")
				}
				actorKind, characterID = "player_character", worldActorID
			} else if kind != "summonedActor" {
				return canonicalProblem(http.StatusUnprocessableEntity, "legacy genesis may contain only participant PCs and their summoned actors")
			}
			projection, canonicalErr := canonicalJSON(actor)
			if canonicalErr != nil {
				return canonicalErr
			}
			if queryErr := tx.Exec(`
				INSERT INTO game_session_actors (
					id, session_id, ruleset_release_id, rules_artifact_hash, character_id,
					owner_user_id, controller_user_id, actor_kind, lifecycle_status,
					build_snapshot, build_canonical_bytes, build_hash,
					state_projection, state_hash, projection_schema_version, projection_seq
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?::jsonb, ?, ?, ?::jsonb, ?, 5, 0)
			`, uuid.New(), sessionID, release.ID, request.RulesArtifactHash, characterID,
				userID, userID, actorKind, string(projection), projection, canonicalSHA256(projection),
				string(projection), canonicalSHA256(projection)).Error; queryErr != nil {
				return normalizeCanonicalDatabaseError(queryErr)
			}
		}
		return normalizeCanonicalDatabaseError(tx.Exec(`
			INSERT INTO session_snapshots (
				id, session_id, seq, revision, ruleset_release_id, rules_artifact_hash,
				snapshot_schema_version, serializer_version, snapshot, canonical_bytes,
				state_hash, last_event_hash
			) VALUES (?, ?, 0, ?, ?, ?, 5, ?, ?::jsonb, ?, ?, NULL)
		`, uuid.New(), sessionID, normalizedWorld.revision, release.ID, request.RulesArtifactHash,
			release.SerializerVersion, string(normalizedCanonical), normalizedCanonical, stateHash).Error)
	})
	if err != nil {
		writeCanonicalError(c, err)
		return
	}
	_ = validation
	c.Params = gin.Params{{Key: "id", Value: sessionID.String()}}
	controller.GetCurrent(c)
}
