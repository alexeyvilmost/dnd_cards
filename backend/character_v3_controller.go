package main

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CharacterV3Controller — контроллер персонажей V3 (сущностно-ориентированное хранение).
type CharacterV3Controller struct {
	db *gorm.DB
}

func NewCharacterV3Controller(db *gorm.DB) *CharacterV3Controller {
	return &CharacterV3Controller{db: db}
}

const legacyPublicUsername = "public"

const (
	characterV3AccessOwner                = "owner"
	characterV3AccessLegacyPublicReadonly = "legacy_public_readonly"
)

var (
	errCharacterV3OwnerChanged = errors.New("character owner row changed")
	errCharacterV3InEncounter  = errors.New("character is linked to an encounter")
)

func cloneJSONMapValue(value *JSONMap) JSONMap {
	cloned := JSONMap{}
	if value == nil {
		return cloned
	}
	for key, item := range *value {
		cloned[key] = item
	}
	return cloned
}

// runtimeUpdatesForLockedCharacter builds a field-level PATCH after the row
// lock has established whether encounter runtime owns HP/effects/temp HP.
// Other runtime fields (including other turn_state keys) remain independently
// editable while the character participates in an encounter.
func runtimeUpdatesForLockedCharacter(character CharacterV3, req PatchCharacterRuntimeRequest) map[string]interface{} {
	updates := make(map[string]interface{})
	linked := character.CurrentEncounterID != nil
	if req.CurrentHP != nil && !linked {
		updates["current_hp"] = *req.CurrentHP
	}
	if req.MaxHP != nil {
		updates["max_hp"] = *req.MaxHP
	}
	if req.Equipment != nil {
		updates["equipment"] = req.Equipment
	}
	if req.InventoryItems != nil {
		updates["inventory_items"] = req.InventoryItems
	}
	if req.Resources != nil {
		updates["resources"] = req.Resources
	}
	if req.MaxResources != nil {
		updates["max_resources"] = req.MaxResources
	}
	if req.ActiveEffects != nil && !linked {
		updates["active_effects"] = req.ActiveEffects
	}
	if req.TurnState != nil {
		turnState := cloneJSONMapValue(req.TurnState)
		if linked {
			currentTurnState := cloneJSONMapValue(character.TurnState)
			if tempHP, exists := currentTurnState["temp_hp"]; exists {
				turnState["temp_hp"] = tempHP
			} else {
				delete(turnState, "temp_hp")
			}
		}
		updates["turn_state"] = &turnState
	}
	if req.Currency != nil {
		updates["currency"] = req.Currency
	}
	return updates
}

type characterV3AccessMode int

const (
	characterV3Read characterV3AccessMode = iota
	characterV3Write
)

// requireCharacterV3UserID is defense in depth for direct controller calls.
// Production routes also run StrictAuthMiddleware, so an absent/invalid JWT is
// rejected before the controller and can never become the shared public user.
func requireCharacterV3UserID(c *gin.Context) (uuid.UUID, bool) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return uuid.Nil, false
	}
	return userID, true
}

// loadCharacterV3ForAccess implements the migration-period access policy:
// owners have full access; authenticated users may read legacy rows owned by
// the historical `public` account; every other cross-user access is forbidden.
func (cc *CharacterV3Controller) loadCharacterV3ForAccess(
	c *gin.Context,
	characterID uuid.UUID,
	userID uuid.UUID,
	mode characterV3AccessMode,
) (*CharacterV3, bool) {
	var character CharacterV3
	result := cc.db.Preload("User").Preload("Group").First(&character, "id = ?", characterID)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		}
		return nil, false
	}
	if character.User.Username == legacyPublicUsername {
		if mode == characterV3Read {
			character.AccessMode = characterV3AccessLegacyPublicReadonly
			return &character, true
		}
		c.JSON(http.StatusForbidden, gin.H{
			"error": "legacy public персонаж доступен только для чтения",
		})
		return nil, false
	}
	if character.UserID == userID {
		character.AccessMode = characterV3AccessOwner
		return &character, true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "нет доступа к персонажу"})
	return nil, false
}

func (cc *CharacterV3Controller) rejectLegacyPublicIdentity(c *gin.Context, userID uuid.UUID) bool {
	var count int64
	if err := cc.db.Model(&User{}).
		Where("id = ? AND username = ?", userID, legacyPublicUsername).
		Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка проверки владельца персонажа"})
		return true
	}
	if count > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "legacy public профиль доступен только для чтения"})
		return true
	}
	return false
}

// applyCharacterV3Defaults проставляет разумные значения по умолчанию.
func applyCharacterV3Defaults(ch *CharacterV3) {
	if ch.SystemID == "" {
		ch.SystemID = DefaultCharacterSystemID
	}
	if ch.RulesetVersion == "" {
		ch.RulesetVersion = DefaultCharacterRuleset
	}
	if ch.CharacterType == "" {
		ch.CharacterType = DefaultCharacterType
	}
	if ch.CharacterSchemaVersion <= 0 {
		ch.CharacterSchemaVersion = CurrentCharacterSchemaVersion
	}
	if ch.Level <= 0 {
		ch.Level = 1
	}
	if ch.Speed <= 0 {
		ch.Speed = 30
	}
	if ch.ProficiencyBonus <= 0 {
		ch.ProficiencyBonus = 2
	}
	if ch.ArmorClass <= 0 {
		ch.ArmorClass = 10
	}
	if ch.PassivePerception <= 0 {
		ch.PassivePerception = 10
	}
}

// CreateCharacterV3 создаёт нового персонажа V3.
func (cc *CharacterV3Controller) CreateCharacterV3(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	if cc.rejectLegacyPublicIdentity(c, userID) {
		return
	}

	var req CreateCharacterV3Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса", "details": err.Error()})
		return
	}
	systemID, rulesetVersion, characterType, schemaVersion := requestedCharacterMetadata(
		req.SystemID,
		req.RulesetVersion,
		req.CharacterType,
		req.CharacterSchemaVersion,
	)
	if err := validateNewCharacterMetadata(systemID, rulesetVersion, characterType, schemaVersion); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные метаданные персонажа", "details": err.Error()})
		return
	}

	character := CharacterV3{
		UserID:                   userID,
		Name:                     req.Name,
		AvatarURL:                req.AvatarURL,
		Description:              req.Description,
		Notes:                    req.Notes,
		SystemID:                 systemID,
		RulesetVersion:           rulesetVersion,
		CharacterType:            characterType,
		CharacterSchemaVersion:   schemaVersion,
		RaceID:                   req.RaceID,
		LineageID:                req.LineageID,
		ClassID:                  req.ClassID,
		BackgroundID:             req.BackgroundID,
		Level:                    req.Level,
		FeatIDs:                  req.FeatIDs,
		SpellIDs:                 req.SpellIDs,
		ActionIDs:                req.ActionIDs,
		EffectIDs:                req.EffectIDs,
		ResourceIDs:              req.ResourceIDs,
		Abilities:                req.Abilities,
		SkillProficiencies:       req.SkillProficiencies,
		SkillExpertise:           req.SkillExpertise,
		SavingThrowProficiencies: req.SavingThrowProficiencies,
		ToolProficiencies:        req.ToolProficiencies,
		ToolExpertise:            req.ToolExpertise,
		Languages:                req.Languages,
		ResolvedChoices:          req.ResolvedChoices,
		RuleState:                req.RuleState,
		MaxHP:                    req.MaxHP,
		CurrentHP:                req.CurrentHP,
		Speed:                    req.Speed,
		ProficiencyBonus:         req.ProficiencyBonus,
		ArmorClass:               req.ArmorClass,
		InitiativeBonus:          req.InitiativeBonus,
		PassivePerception:        req.PassivePerception,
		Equipment:                req.Equipment,
		InventoryItems:           req.InventoryItems,
		Resources:                req.Resources,
		MaxResources:             req.MaxResources,
		ActiveEffects:            req.ActiveEffects,
		TurnState:                req.TurnState,
		Currency:                 req.Currency,
	}
	applyCharacterV3Defaults(&character)

	tx := cc.db.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка начала создания персонажа"})
		return
	}
	defer tx.Rollback()

	if err := tx.Create(&character).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания персонажа", "details": err.Error()})
		return
	}

	var full CharacterV3
	if err := tx.Preload("User").Preload("Group").First(&full, character.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения данных персонажа"})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка завершения создания персонажа"})
		return
	}
	full.AccessMode = characterV3AccessOwner
	c.JSON(http.StatusCreated, full)
}

// GetCharactersV3 возвращает список персонажей V3 текущего пользователя.
func (cc *CharacterV3Controller) GetCharactersV3(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	var characters []CharacterV3
	if err := cc.db.Preload("User").Preload("Group").
		Where("characters_v3.user_id = ?", userID).
		Order("characters_v3.created_at DESC").Find(&characters).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения списка персонажей"})
		return
	}
	for index := range characters {
		characters[index].AccessMode = characterV3AccessOwner
	}
	c.JSON(http.StatusOK, characters)
}

// GetCharacterV3 возвращает персонажа V3 по ID (в рамках текущего пользователя).
func (cc *CharacterV3Controller) GetCharacterV3(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	character, allowed := cc.loadCharacterV3ForAccess(c, characterID, userID, characterV3Read)
	if !allowed {
		return
	}
	c.JSON(http.StatusOK, character)
}

// UpdateCharacterV3 обновляет персонажа V3 (полная замена полей черновика).
func (cc *CharacterV3Controller) UpdateCharacterV3(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	character, allowed := cc.loadCharacterV3ForAccess(c, characterID, userID, characterV3Write)
	if !allowed {
		return
	}

	var req UpdateCharacterV3Request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса", "details": err.Error()})
		return
	}
	if err := validateCharacterMetadataUpdate(*character, req); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "нельзя изменить принадлежность персонажа", "details": err.Error()})
		return
	}

	var full CharacterV3
	txErr := cc.db.Transaction(func(tx *gorm.DB) error {
		var locked CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ?", characterID, userID).
			First(&locked).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCharacterV3OwnerChanged
			}
			return err
		}

		if req.Name != "" {
			locked.Name = req.Name
		}
		locked.AvatarURL = req.AvatarURL
		locked.Description = req.Description
		locked.Notes = req.Notes
		locked.RaceID = req.RaceID
		locked.LineageID = req.LineageID
		locked.ClassID = req.ClassID
		locked.BackgroundID = req.BackgroundID
		locked.Level = req.Level
		locked.FeatIDs = req.FeatIDs
		locked.SpellIDs = req.SpellIDs
		locked.ActionIDs = req.ActionIDs
		locked.EffectIDs = req.EffectIDs
		locked.ResourceIDs = req.ResourceIDs
		locked.Abilities = req.Abilities
		locked.SkillProficiencies = req.SkillProficiencies
		locked.SkillExpertise = req.SkillExpertise
		locked.SavingThrowProficiencies = req.SavingThrowProficiencies
		locked.ToolProficiencies = req.ToolProficiencies
		locked.ToolExpertise = req.ToolExpertise
		locked.Languages = req.Languages
		locked.ResolvedChoices = req.ResolvedChoices
		locked.RuleState = req.RuleState
		locked.MaxHP = req.MaxHP
		if locked.CurrentEncounterID == nil {
			locked.CurrentHP = req.CurrentHP
		}
		locked.Speed = req.Speed
		locked.ProficiencyBonus = req.ProficiencyBonus
		locked.ArmorClass = req.ArmorClass
		locked.InitiativeBonus = req.InitiativeBonus
		locked.PassivePerception = req.PassivePerception
		applyCharacterV3Defaults(&locked)

		result := tx.Model(&CharacterV3{}).
			Where("id = ? AND user_id = ?", characterID, userID).
			Updates(map[string]interface{}{
				"name":                       locked.Name,
				"avatar_url":                 locked.AvatarURL,
				"description":                locked.Description,
				"notes":                      locked.Notes,
				"race_id":                    locked.RaceID,
				"lineage_id":                 locked.LineageID,
				"class_id":                   locked.ClassID,
				"background_id":              locked.BackgroundID,
				"level":                      locked.Level,
				"feat_ids":                   locked.FeatIDs,
				"spell_ids":                  locked.SpellIDs,
				"action_ids":                 locked.ActionIDs,
				"effect_ids":                 locked.EffectIDs,
				"resource_ids":               locked.ResourceIDs,
				"abilities":                  locked.Abilities,
				"skill_proficiencies":        locked.SkillProficiencies,
				"skill_expertise":            locked.SkillExpertise,
				"saving_throw_proficiencies": locked.SavingThrowProficiencies,
				"tool_proficiencies":         locked.ToolProficiencies,
				"tool_expertise":             locked.ToolExpertise,
				"languages":                  locked.Languages,
				"resolved_choices":           locked.ResolvedChoices,
				"rule_state":                 locked.RuleState,
				"max_hp":                     locked.MaxHP,
				"current_hp":                 locked.CurrentHP,
				"speed":                      locked.Speed,
				"proficiency_bonus":          locked.ProficiencyBonus,
				"armor_class":                locked.ArmorClass,
				"initiative_bonus":           locked.InitiativeBonus,
				"passive_perception":         locked.PassivePerception,
				"runtime_revision":           locked.RuntimeRevision + 1,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errCharacterV3OwnerChanged
		}
		return tx.Preload("User").Preload("Group").First(&full, locked.ID).Error
	})
	if errors.Is(txErr, errCharacterV3OwnerChanged) {
		c.JSON(http.StatusConflict, gin.H{"error": "владелец персонажа изменился; повторите запрос"})
		return
	}
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления персонажа", "details": txErr.Error()})
		return
	}
	full.AccessMode = characterV3AccessOwner
	c.JSON(http.StatusOK, full)
}

// DeleteCharacterV3 удаляет персонажа V3.
func (cc *CharacterV3Controller) DeleteCharacterV3(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	if _, allowed := cc.loadCharacterV3ForAccess(c, characterID, userID, characterV3Write); !allowed {
		return
	}
	txErr := cc.db.Transaction(func(tx *gorm.DB) error {
		var locked CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "user_id", "current_encounter_id").
			Where("id = ? AND user_id = ?", characterID, userID).
			First(&locked).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCharacterV3OwnerChanged
			}
			return err
		}
		if locked.CurrentEncounterID != nil {
			return errCharacterV3InEncounter
		}
		result := tx.Where("id = ? AND user_id = ?", characterID, userID).Delete(&CharacterV3{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errCharacterV3OwnerChanged
		}
		return nil
	})
	if errors.Is(txErr, errCharacterV3InEncounter) {
		c.JSON(http.StatusConflict, gin.H{"error": "сначала уберите персонажа из текущего боя"})
		return
	}
	if errors.Is(txErr, errCharacterV3OwnerChanged) {
		c.JSON(http.StatusConflict, gin.H{"error": "владелец персонажа изменился; повторите запрос"})
		return
	}
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка удаления персонажа"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "персонаж удалён"})
}

// GetCharacterEvents возвращает журнал событий персонажа (новые сверху).
func (cc *CharacterV3Controller) GetCharacterEvents(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	if _, allowed := cc.loadCharacterV3ForAccess(c, characterID, userID, characterV3Read); !allowed {
		return
	}

	var events []CharacterEvent
	if err := cc.db.Where("character_id = ?", characterID).Order("ts DESC, created_at DESC").Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения журнала"})
		return
	}
	c.JSON(http.StatusOK, events)
}

// PostCharacterEvents добавляет пакет событий в журнал персонажа.
func (cc *CharacterV3Controller) PostCharacterEvents(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	if _, allowed := cc.loadCharacterV3ForAccess(c, characterID, userID, characterV3Write); !allowed {
		return
	}

	var req BatchCharacterEventsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса", "details": err.Error()})
		return
	}
	if len(req.Events) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "пустой список событий"})
		return
	}
	if len(req.Events) > 200 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "в одном пакете допустимо не более 200 событий"})
		return
	}
	for index, item := range req.Events {
		if err := validateCharacterEvent(item.Type, item.Payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "неверное событие журнала",
				"details": fmt.Sprintf("events[%d]: %s", index, err),
			})
			return
		}
	}

	rows := make([]CharacterEvent, 0, len(req.Events))
	now := time.Now()
	tx := cc.db.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка начала сохранения событий"})
		return
	}
	defer tx.Rollback()
	var lockedCharacter CharacterV3
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").Where("id = ? AND user_id = ?", characterID, userID).
		First(&lockedCharacter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusConflict, gin.H{"error": "владелец персонажа изменился; повторите запрос"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка проверки владельца персонажа"})
		}
		return
	}

	for _, item := range req.Events {
		ts := now
		if item.Ts != nil {
			ts = *item.Ts
		}
		row := CharacterEvent{
			CharacterID:   characterID,
			ClientEventID: item.ClientEventID,
			Ts:            ts,
			Type:          item.Type,
			Payload:       item.Payload,
		}

		var create *gorm.DB
		if item.ClientEventID != nil {
			create = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		} else {
			create = tx.Create(&row)
		}
		if create.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка сохранения событий"})
			return
		}
		if item.ClientEventID != nil && create.RowsAffected == 0 {
			if err := tx.Where("character_id = ? AND client_event_id = ?", characterID, *item.ClientEventID).First(&row).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка чтения сохранённого события"})
				return
			}
		}
		rows = append(rows, row)
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка завершения сохранения событий"})
		return
	}
	c.JSON(http.StatusCreated, rows)
}

// PatchCharacterRuntime обновляет только runtime-поля (экипировка, инвентарь, ресурсы).
func (cc *CharacterV3Controller) PatchCharacterRuntime(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}

	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	_, allowed := cc.loadCharacterV3ForAccess(c, characterID, userID, characterV3Write)
	if !allowed {
		return
	}

	var req PatchCharacterRuntimeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса", "details": err.Error()})
		return
	}

	var full CharacterV3
	txErr := cc.db.Transaction(func(tx *gorm.DB) error {
		var locked CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ?", characterID, userID).
			First(&locked).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCharacterV3OwnerChanged
			}
			return err
		}
		updates := runtimeUpdatesForLockedCharacter(locked, req)
		if req.ExpectedRuntimeRevision != nil && locked.RuntimeRevision != *req.ExpectedRuntimeRevision {
			expected := *req.ExpectedRuntimeRevision
			actual := locked.RuntimeRevision
			return &characterRuntimeCommandError{
				Status: http.StatusConflict, Code: "runtime_revision_conflict",
				Message: "character runtime revision is stale", CharacterID: characterID.String(),
				ExpectedRuntimeRevision: &expected, ActualRuntimeRevision: &actual,
			}
		}
		if len(updates) > 0 {
			updates["runtime_revision"] = locked.RuntimeRevision + 1
			result := tx.Model(&CharacterV3{}).
				Where("id = ? AND user_id = ? AND runtime_revision = ?", characterID, userID, locked.RuntimeRevision).
				Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errCharacterV3OwnerChanged
			}
		}
		return tx.Preload("User").Preload("Group").First(&full, locked.ID).Error
	})
	if errors.Is(txErr, errCharacterV3OwnerChanged) {
		c.JSON(http.StatusConflict, gin.H{"error": "владелец персонажа изменился; повторите запрос"})
		return
	}
	var runtimeConflict *characterRuntimeCommandError
	if errors.As(txErr, &runtimeConflict) {
		writeCharacterRuntimeCommandError(c, txErr)
		return
	}
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления runtime", "details": txErr.Error()})
		return
	}
	full.AccessMode = characterV3AccessOwner
	c.JSON(http.StatusOK, full)
}
