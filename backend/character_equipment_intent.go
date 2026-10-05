package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CharacterEquipmentIntent struct {
	CommandID               string            `json:"command_id"`
	ExpectedRuntimeRevision int64             `json:"expected_runtime_revision"`
	RoguelikeRunID          string            `json:"roguelike_run_id,omitempty"`
	ExpectedRunRevision     *int64            `json:"expected_run_revision,omitempty"`
	Operation               map[string]string `json:"operation"`
}

type preparedEquipmentIntent struct {
	Character    CharacterV3
	Run          *RoguelikeRun
	CatalogStamp string
	InputRows    []equipmentInputRow
	Needs        []roguelikeWorkerNeed
	Result       *roguelikeWorkerResult
	Updates      map[string]interface{}
}

type equipmentInputRow struct {
	Table string
	ID    uuid.UUID
}

func equipmentInputHash(value any) string {
	raw, _ := json.Marshal(value)
	_, canonical, err := canonicalizeRawJSON(raw)
	if err != nil {
		return ""
	}
	return canonicalSHA256(canonical)
}

func decodeEquipmentIntent(raw []byte) (CharacterEquipmentIntent, error) {
	var request CharacterEquipmentIntent
	if len(raw) == 0 || len(raw) > 4096 {
		return request, invalidRuntimeCommand("equipment intent must be bounded JSON")
	}
	decoded, _, err := canonicalizeRawJSON(raw)
	if err != nil {
		return request, invalidRuntimeCommand("equipment intent must be unambiguous JSON")
	}
	object, ok := decoded.(map[string]interface{})
	if !ok || object["expected_runtime_revision"] == nil {
		return request, invalidRuntimeCommand("expected runtime revision is required")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, invalidRuntimeCommand("invalid equipment intent schema")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, invalidRuntimeCommand("one equipment intent is required")
	}
	id, err := uuid.Parse(request.CommandID)
	if err != nil || id == uuid.Nil || id.String() != request.CommandID || request.ExpectedRuntimeRevision < 0 || len(request.Operation) != 1 {
		return request, invalidRuntimeCommand("invalid equipment intent identity")
	}
	if item, ok := request.Operation["equip"]; ok {
		id, err = uuid.Parse(item)
		if err != nil || id == uuid.Nil || id.String() != item {
			return request, invalidRuntimeCommand("equip requires a canonical item UUID")
		}
	} else if slot, ok := request.Operation["unequip"]; ok {
		row := JSONMap{slot: nil}
		if err := validateRuntimeEquipmentMap(&row); err != nil {
			return request, err
		}
	} else {
		return request, invalidRuntimeCommand("one equip or unequip operation is required")
	}
	return request, nil
}

// Recheck persistent rights rather than retaining an is_admin bit from the
// beginning of a potentially slow request. The configured allowlist is server
// policy; client-supplied claims cannot alter it.
func equipmentOwner(tx *gorm.DB, callerID uuid.UUID, character CharacterV3) error {
	var caller, owner User
	if err := tx.First(&caller, "id = ?", callerID).Error; err != nil {
		return invalidEquipmentAccess()
	}
	if callerID == character.UserID {
		owner = caller
	} else {
		if err := tx.First(&owner, "id = ?", character.UserID).Error; err != nil {
			return invalidEquipmentAccess()
		}
	}
	admins, _ := parseContentAdminUserIDs(os.Getenv("CONTENT_ADMIN_USER_IDS"))
	_, admin := admins[callerID]
	if caller.Username == legacyPublicUsername || owner.Username == legacyPublicUsername || (callerID != character.UserID && !caller.IsAdmin && !admin) {
		return invalidEquipmentAccess()
	}
	return nil
}
func invalidEquipmentAccess() error {
	return &characterRuntimeCommandError{Status: 403, Code: "equipment_forbidden", Message: "Нет доступа к изменению экипировки"}
}
func staleEquipmentInput() error {
	return &characterRuntimeCommandError{Status: 409, Code: "equipment_input_changed", Message: "Данные персонажа, забега или каталога изменились. Обновите лист и повторите выбор."}
}

// A bounded dependency-version check, not another rules build. Include query
// membership (basics/effect types/aliases), so an inserted or newly matching row
// invalidates preparation too. xmin is an attempt-local MVCC stamp, never a
// durable catalog version or a shared cache key. Only its aggregate hash leaves
// this function. No mechanics or user fields are emitted.
func equipmentCatalogStamp(tx *gorm.DB, needs []roguelikeWorkerNeed, userIDs []uuid.UUID, inputRows ...equipmentInputRow) (string, error) {
	return equipmentCatalogFingerprint(tx, needs, userIDs, false, inputRows...)
}

// Content mode is a fresh SHA256 over complete selected rows and membership.
// Unlike the attempt-local xmin stamp, it can validate immutable cache bytes.
func equipmentCatalogFingerprint(tx *gorm.DB, needs []roguelikeWorkerNeed, userIDs []uuid.UUID, content bool, inputRows ...equipmentInputRow) (string, error) {
	tables := map[string]string{"race": "races", "class": "classes", "background": "backgrounds", "feat": "feats", "effect": "effects", "action": "actions", "spell": "spells", "card": "cards", "resource": "resources"}
	conditions := map[string][]string{"action": {"type = ?"}}
	argsByKind := map[string][]any{"action": {"basic"}}
	variables := false
	seen := map[string]bool{}
	for _, need := range needs {
		key := equipmentInputHash(need)
		if seen[key] {
			continue
		}
		seen[key] = true
		if len(seen) > 4096 {
			return "", fmt.Errorf("equipment dependency stamp budget exceeded")
		}
		switch need.Kind {
		case "variables":
			variables = true
		case "effect_type":
			conditions["effect"] = append(conditions["effect"], "type = ?")
			argsByKind["effect"] = append(argsByKind["effect"], need.EffectType)
		case "entity":
			if tables[need.EntityType] == "" {
				return "", fmt.Errorf("invalid catalog stamp kind")
			}
			column, reference := "card_number", need.Reference
			if id, err := uuid.Parse(reference); err == nil {
				column = "id"
				reference = id.String()
			} else if need.EntityType == "resource" {
				column = "resource_id"
			}
			condition := column + " = ?"
			values := []any{reference}
			if need.EntityType == "spell" && column == "card_number" {
				condition = "(" + condition + " OR " + catalogSpellAliasSQL + " = ?)"
				values = append(values, strings.ToLower(strings.TrimSpace(reference)))
			}
			conditions[need.EntityType] = append(conditions[need.EntityType], condition)
			argsByKind[need.EntityType] = append(argsByKind[need.EntityType], values...)
		default:
			return "", fmt.Errorf("invalid catalog stamp need")
		}
	}
	kinds := []string{}
	for kind := range conditions {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	selects := []string{}
	args := []any{}
	version := "xmin::text"
	if content {
		// `source` is also a real entity column. source.* explicitly denotes
		// the complete composite row, never that provenance field alone.
		version = "encode(sha256(convert_to(to_jsonb(source.*)::text, 'UTF8')), 'hex')"
	}
	for _, kind := range kinds {
		selects = append(selects, "SELECT '"+kind+":' || id::text || ':' || "+version+" AS stamp FROM "+tables[kind]+" AS source WHERE deleted_at IS NULL AND ("+strings.Join(conditions[kind], " OR ")+")")
		args = append(args, argsByKind[kind]...)
	}
	if variables {
		selects = append(selects, "SELECT 'variable:' || id::text || ':' || "+version+" AS stamp FROM variables AS source WHERE deleted_at IS NULL")
	}
	selects = append(selects, "SELECT 'user:' || id::text || ':' || "+version+" AS stamp FROM users AS source WHERE deleted_at IS NULL AND id IN ?")
	args = append(args, userIDs)
	for _, row := range inputRows {
		if row.Table != "characters_v3" && row.Table != "roguelike_runs" {
			return "", fmt.Errorf("invalid equipment input table")
		}
		selects = append(selects, "SELECT '"+row.Table+":' || id::text || ':' || xmin::text AS stamp FROM "+row.Table+" WHERE id = ?")
		args = append(args, row.ID)
	}
	var rows []struct{ Stamp string }
	if err := tx.Raw(strings.Join(selects, " UNION ALL "), args...).Scan(&rows).Error; err != nil {
		return "", err
	}
	stamps := make([]string, len(rows))
	for i, row := range rows {
		stamps[i] = row.Stamp
	}
	sort.Strings(stamps)
	if content {
		stamps = append(stamps, "policy-v1:"+os.Getenv("CONTENT_ADMIN_USER_IDS"))
	}
	return equipmentInputHash(stamps), nil
}

func prepareEquipmentWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, callerID uuid.UUID, character CharacterV3, request CharacterEquipmentIntent) (*roguelikeWorkerResult, []roguelikeWorkerNeed, error) {
	defer performanceSince(ctx, "equipment_intent_prepare_ms")()
	seed, err := newRoguelikeSeed()
	if err != nil {
		return nil, nil, err
	}
	return prepareCharacterWorker(ctx, tx, client, "/equipment", callerID, character, map[string]any{
		"commandId": request.CommandID, "seed": seed, "operation": request.Operation,
	})
}

// A shared dependency resolver for character commands and read-only offers.
// The caller supplies an owned, consistent saved snapshot. No write lock or
// live browser resolver belongs here. The artifact is fixed from the first reply.
func prepareCharacterWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, endpoint string, callerID uuid.UUID, character CharacterV3, extra map[string]any) (*roguelikeWorkerResult, []roguelikeWorkerNeed, error) {
	catalog := emptyRoguelikeFrozenCatalog()
	prefetch := newCatalogPrefetch(character.UserID)
	ids := []string{}
	cold := func() error {
		prefetch = newCatalogPrefetch(character.UserID)
		catalog = emptyRoguelikeFrozenCatalog()
		ids = []string{}
		var basics []Action
		if err := tx.Where("type = ?", "basic").Order("id").Find(&basics).Error; err != nil {
			return err
		}
		for _, action := range basics {
			ids = append(ids, action.ID.String())
			if err := catalog.add("action", action); err != nil {
				return err
			}
		}
		return nil
	}
	candidate, cached, err := validatedPreparationCatalog(ctx, tx, callerID, character)
	if err != nil {
		return nil, nil, err
	}
	if candidate != nil {
		catalog = *cached
		ids = append([]string(nil), candidate.BasicIDs...)
	} else if err := cold(); err != nil {
		return nil, nil, err
	}
	cacheEnabled := os.Getenv("RULES_PREPARATION_CACHE_ENABLED") == "1"
	if cacheEnabled {
		if extra == nil {
			extra = map[string]any{}
		} else {
			copy := map[string]any{}
			for key, value := range extra {
				copy[key] = value
			}
			extra = copy
		}
		extra["catalogProjectionVersion"] = 1
	}
	character.AccessMode = characterV3AccessOwner
	input := map[string]any{"character": character, "catalog": &catalog, "basicActionIds": ids}
	for key, value := range extra {
		input[key] = value
	}
	needs := []roguelikeWorkerNeed{}
	artifact := ""
	for attempt := 0; attempt < 32; attempt++ {
		result, err := client.call(ctx, endpoint, map[string]any{"input": input, "artifactHash": artifact})
		if err != nil {
			if candidate != nil {
				// A newer executable may reject an older candidate before it can
				// report its identity. Preparation is stateless: retry once from
				// fresh basics, retaining any artifact already chosen this attempt.
				candidate = nil
				needs = nil
				performanceAdd(ctx, "preparation_cache_rejected_candidate", 1)
				if err := cold(); err != nil {
					return nil, nil, err
				}
				input["catalog"] = &catalog
				input["basicActionIds"] = ids
				continue
			}
			return nil, nil, err
		}
		if !runtimeCommandSHA256Pattern.MatchString(result.ArtifactHash) || (artifact != "" && artifact != result.ArtifactHash) {
			return nil, nil, fmt.Errorf("equipment worker artifact changed")
		}
		artifact = result.ArtifactHash
		if candidate != nil && (candidate.Artifact != artifact || result.Status == "needs_content" || result.CatalogSelection == nil || !preparationReadsCovered(candidate.Needs, result.CatalogSelection.Reads)) {
			// Fresh commands select the current worker. An immutable candidate
			// never pins a new command to a previous executable artifact.
			// A new selector is not proven by a prior UUID read. In particular,
			// newly requested spell aliases/effect memberships require the fresh
			// resolver before a candidate result can become authoritative.
			performanceAdd(ctx, "preparation_cache_artifact_miss", 1)
			candidate = nil
			needs = nil
			if err := cold(); err != nil {
				return nil, nil, err
			}
			input["catalog"] = &catalog
			input["basicActionIds"] = ids
			continue
		}
		if result.Status != "needs_content" {
			if result.CatalogSelection != nil {
				needs = append(needs, result.CatalogSelection.Reads...)
			}
			if candidate != nil {
				performanceAdd(ctx, "preparation_cache_hit", 1)
			}
			if err := rememberPreparationCatalog(ctx, tx, callerID, character, catalog, ids, result, candidate); err != nil {
				return nil, nil, err
			}
			return result, needs, nil
		}
		needs = append(needs, result.Needs...)
		performanceAdd(ctx, "catalog_needs_rounds", 1)
		before := equipmentInputHash(catalog)
		if err := prefetch.fulfill(tx, &catalog, result.Needs); err != nil {
			return nil, nil, err
		}
		if equipmentInputHash(catalog) == before {
			return nil, nil, fmt.Errorf("equipment catalog resolution stalled")
		}
	}
	return nil, nil, fmt.Errorf("equipment catalog dependency budget exceeded")
}

func equipmentReceipt(tx *gorm.DB, userID, commandID uuid.UUID, hash string) (JSONMap, error) {
	var receipt CharacterRuntimeCommandRecord
	err := tx.Where("user_id = ? AND command_id = ?", userID, commandID).First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if receipt.RequestHash != hash {
		return nil, &characterRuntimeCommandError{Status: 409, Code: "command_id_reuse", Message: "command_id already belongs to another request"}
	}
	result := cloneJSONMapValue(&receipt.Response)
	result["replayed"] = true
	return result, nil
}

func (cc *CharacterV3Controller) PostCharacterEquipmentIntent(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeCharacterRuntimeCommandError(c, invalidRuntimeCommand("invalid character identity"))
		return
	}
	raw, err := c.GetRawData()
	if err != nil {
		writeCharacterRuntimeCommandError(c, invalidRuntimeCommand("cannot read equipment intent"))
		return
	}
	request, err := decodeEquipmentIntent(raw)
	if err != nil {
		writeCharacterRuntimeCommandError(c, err)
		return
	}
	commandID := uuid.MustParse(request.CommandID)
	hash := equipmentInputHash(map[string]any{"kind": "equipment-intent-v1", "character_id": characterID.String(), "request": request})
	db := cc.db.WithContext(c.Request.Context())
	prepared := preparedEquipmentIntent{}
	var response JSONMap
	// Consistent read snapshot only: no write/advisory/row locks while resolving
	// dependencies or waiting on worker HTTP. Uncommitted preparation is disposable.
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&prepared.Character, "id = ?", characterID).Error; err != nil {
			return invalidEquipmentAccess()
		}
		if err := equipmentOwner(tx, userID, prepared.Character); err != nil {
			return err
		}
		var err error
		response, err = equipmentReceipt(tx, userID, commandID, hash)
		if err != nil || response != nil {
			return err
		}
		// Rollback disables new execution, but accepted receipts remain readable.
		// A temporary disable is not proof that a concurrently submitted command
		// never committed; the client must retain its original pending identity.
		if os.Getenv("RULES_EQUIPMENT_INTENT_ENABLED") != "1" {
			return &characterRuntimeCommandError{Status: 503, Code: "equipment_intent_disabled", Message: "Серверное изменение экипировки временно недоступно"}
		}
		if prepared.Character.RuntimeRevision != request.ExpectedRuntimeRevision {
			return staleEquipmentInput()
		}
		if prepared.Character.CurrentEncounterID != nil || characterSaleCombatActive(prepared.Character.TurnState) {
			return invalidRuntimeCommand("equipment intent requires an inactive sheet")
		}
		if prepared.Character.CharacterType != "dungeon_crawl" && request.RoguelikeRunID != "" {
			return invalidRuntimeCommand("unexpected roguelike context")
		}
		prepared.Run, err = authorizeRoguelikeCharacterMutation(tx, prepared.Character, prepared.Character.UserID, request.RoguelikeRunID, roguelikeIntentCamp)
		if err != nil {
			return err
		}
		if prepared.Run != nil && (request.ExpectedRunRevision == nil || *request.ExpectedRunRevision != prepared.Run.Revision) {
			return staleEquipmentInput()
		}
		prepared.InputRows = []equipmentInputRow{{Table: "characters_v3", ID: characterID}}
		if prepared.Run != nil {
			prepared.InputRows = append(prepared.InputRows, equipmentInputRow{Table: "roguelike_runs", ID: prepared.Run.ID})
		}
		prepared.Result, prepared.Needs, err = prepareEquipmentWorker(c.Request.Context(), tx, roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}, userID, prepared.Character, request)
		if err != nil {
			var rejection *roguelikeWorkerRejection
			if errors.As(err, &rejection) {
				return &characterRuntimeCommandError{Status: 422, Code: rejection.Code, Message: rejection.Message}
			}
			return err
		}
		result := prepared.Result
		if result.Status != "ready" || result.PreparedCommand == nil {
			return fmt.Errorf("equipment worker did not return a prepared command")
		}
		command := result.PreparedCommand
		if command.CommandID != request.CommandID || len(command.Participants) != 1 || command.Participants[0].CharacterID != characterID.String() || command.Participants[0].ExpectedRuntimeRevision != request.ExpectedRuntimeRevision {
			return fmt.Errorf("equipment worker returned another command")
		}
		if _, _, err := validateCharacterRuntimeCommand(*command); err != nil {
			return err
		}
		prepared.Updates, err = runtimeCommandUpdates(prepared.Character, command.Participants[0].Patch)
		if err != nil {
			return err
		}
		prepared.CatalogStamp, err = equipmentCatalogStamp(tx, prepared.Needs, []uuid.UUID{userID, prepared.Character.UserID}, prepared.InputRows...)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		writeCharacterRuntimeCommandError(c, err)
		return
	}
	if response != nil {
		c.JSON(http.StatusOK, response)
		return
	}
	err = performanceTransaction(db, c.Request.Context(), func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", userID.String()+":"+commandID.String()).Error; err != nil {
			return err
		}
		var run *RoguelikeRun
		if prepared.Run != nil {
			run = &RoguelikeRun{}
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(run, "id = ?", prepared.Run.ID).Error; err != nil {
				return staleEquipmentInput()
			}
		}
		var current CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ?", characterID).Error; err != nil {
			return invalidEquipmentAccess()
		}
		if err := equipmentOwner(tx, userID, current); err != nil {
			return err
		}
		var err error
		response, err = equipmentReceipt(tx, userID, commandID, hash)
		if err != nil || response != nil {
			return err
		}
		if current.RuntimeRevision != request.ExpectedRuntimeRevision || current.UserID != prepared.Character.UserID {
			return staleEquipmentInput()
		}
		stamp, err := equipmentCatalogStamp(tx, prepared.Needs, []uuid.UUID{userID, current.UserID}, prepared.InputRows...)
		if err != nil {
			return err
		}
		if stamp != prepared.CatalogStamp {
			return staleEquipmentInput()
		}
		// Validation above is this command's catalog/rights observation point.
		// There is no worker call, rules assembly or dependency discovery below.
		result := tx.Model(&CharacterV3{}).Where("id = ? AND runtime_revision = ?", characterID, request.ExpectedRuntimeRevision).Updates(prepared.Updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return staleEquipmentInput()
		}
		var full CharacterV3
		if err := tx.Preload("User").Preload("Group").First(&full, "id = ?", characterID).Error; err != nil {
			return err
		}
		full.AccessMode = characterV3AccessOwner
		for _, event := range prepared.Result.PreparedCommand.Events {
			if err := tx.Create(&CharacterEvent{CharacterID: characterID, Ts: time.Now(), Type: event.Type, Payload: event.Payload}).Error; err != nil {
				return err
			}
		}
		response, err = responseToJSONMap(CharacterRuntimeCommandResponse{CommandID: request.CommandID, Participants: []CharacterRuntimeCommandParticipantResponse{{CharacterID: characterID.String(), RuntimeRevision: full.RuntimeRevision, Character: full}}})
		if err != nil {
			return err
		}
		rules, err := rulesetRefToJSONMap(prepared.Result.PreparedCommand.RulesetRef)
		if err != nil {
			return err
		}
		rules["artifact_hash"] = prepared.Result.ArtifactHash
		rules["input_catalog_stamp"] = prepared.CatalogStamp
		rules["content_manifest_hash"] = prepared.Result.ContentManifestHash
		return tx.Create(&CharacterRuntimeCommandRecord{UserID: userID, CommandID: commandID, RequestHash: hash, RulesetRef: rules, Response: response}).Error
	})
	if err != nil {
		writeCharacterRuntimeCommandError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
