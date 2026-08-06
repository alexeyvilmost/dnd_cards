package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const contentMigrationExactUpdateCAS = "protected_exact_current_api_response_v1"

var errContentMigrationInvalidUpdate = errors.New("invalid content migration exact update")

// ContentMigrationExactUpdateRequest deliberately separates the complete API
// preimage from the small reviewed field set. Identity, support and
// server-managed fields can therefore participate in CAS without becoming
// writable commands.
type ContentMigrationExactUpdateRequest struct {
	SchemaVersion   int                        `json:"schema_version"`
	PlanHash        string                     `json:"plan_hash"`
	OperationID     string                     `json:"operation_id"`
	CardNumber      string                     `json:"card_number"`
	ExpectedCurrent json.RawMessage            `json:"expected_current"`
	Fields          map[string]json.RawMessage `json:"fields"`
}

type contentMigrationExactUpdateFunc func(
	entityType string,
	entityID uuid.UUID,
	expectedCurrent JSONMap,
	fields map[string]json.RawMessage,
) (entity any, alreadyApplied bool, err error)

// The map is intentionally explicit. It contains content columns exposed by
// the corresponding update request, never identity, support, timestamps,
// soft-delete state or image-generation/provider bookkeeping.
var contentMigrationExactUpdateColumns = map[string]map[string]string{
	"card": {
		"name": "name", "name_en": "name_en", "properties": "properties",
		"description": "description", "detailed_description": "detailed_description",
		"rarity": "rarity", "custom_rarity_color": "custom_rarity_color",
		"image_url": "image_url", "price": "price", "price_currency": "price_currency",
		"price_abbreviated": "price_abbreviated", "weight": "weight",
		"bonus_type": "bonus_type", "bonus_value": "bonus_value", "damage_type": "damage_type",
		"elemental_damage_value": "elemental_damage_value", "elemental_damage_type": "elemental_damage_type",
		"enchant_bonus": "enchant_bonus", "defense_type": "defense_type",
		"description_font_size": "description_font_size", "text_alignment": "text_alignment",
		"text_font_size": "text_font_size", "show_detailed_description": "show_detailed_description",
		"detailed_description_alignment": "detailed_description_alignment",
		"detailed_description_font_size": "detailed_description_font_size",
		"is_extended":                    "is_extended", "author": "author", "source": "source", "type": "type",
		"weapon_type": "weapon_type", "mastery": "mastery", "related_cards": "related_cards",
		"related_actions": "related_actions", "related_effects": "related_effects",
		"attunement": "attunement", "requires_attunement": "requires_attunement",
		"range": "range", "tags": "tags", "is_template": "is_template", "slot": "slot",
		"effects": "effects", "mechanics": "mechanics", "battle_profile": "battle_profile",
		"container_mode": "container_mode", "contents": "contents",
	},
	"effect": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"effect_type": "effect_type", "condition_description": "condition_description",
		"script": "script", "mechanics": "mechanics", "type": "type", "author": "author",
		"source": "source", "tags": "tags", "price": "price", "weight": "weight",
		"properties": "properties", "related_cards": "related_cards",
		"related_actions": "related_actions", "related_effects": "related_effects",
		"repeatable": "repeatable", "is_extended": "is_extended",
		"description_font_size": "description_font_size", "text_alignment": "text_alignment",
		"text_font_size": "text_font_size", "show_detailed_description": "show_detailed_description",
		"detailed_description_alignment": "detailed_description_alignment",
		"detailed_description_font_size": "detailed_description_font_size",
	},
	"action": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"resources": "resource", "distance": "distance", "recharge": "recharge",
		"recharge_custom": "recharge_custom", "script": "script", "mechanics": "mechanics",
		"action_type": "action_type", "type": "type", "author": "author", "source": "source",
		"tags": "tags", "price": "price", "weight": "weight", "properties": "properties",
		"related_cards": "related_cards", "related_actions": "related_actions",
		"is_extended": "is_extended", "description_font_size": "description_font_size",
		"text_alignment": "text_alignment", "text_font_size": "text_font_size",
		"show_detailed_description":      "show_detailed_description",
		"detailed_description_alignment": "detailed_description_alignment",
		"detailed_description_font_size": "detailed_description_font_size",
	},
	"spell": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"level": "level", "school": "school", "casting_time": "casting_time", "range": "range",
		"component_verbal": "component_verbal", "component_somatic": "component_somatic",
		"component_material": "component_material", "material_text": "material_text",
		"duration": "duration", "classes": "classes", "subclasses": "subclasses",
		"concentration": "concentration", "ritual": "ritual", "resources": "resources",
		"damage": "damage", "area": "area", "is_healing": "is_healing", "heal_dice": "heal_dice",
		"save_outcome": "save_outcome", "upcast_description": "upcast_description",
		"mechanics": "mechanics", "type": "type", "author": "author", "source": "source",
		"tags": "tags", "is_extended": "is_extended",
	},
	"race": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"creature_type": "creature_type", "size": "size", "speed": "speed",
		"extra_speeds": "extra_speeds", "darkvision": "darkvision", "traits": "traits",
		"lineages": "lineages", "is_subrace": "is_subrace", "parent_race_id": "parent_race_id",
		"subrace_level": "subrace_level", "related_effects": "related_effects",
		"related_actions": "related_actions", "level_progression": "level_progression",
		"type": "type", "author": "author", "source": "source", "tags": "tags",
		"is_extended": "is_extended",
	},
	"class": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"hit_die": "hit_die", "primary_abilities": "primary_abilities",
		"recommended_abilities": "recommended_abilities", "saving_throws": "saving_throws",
		"armor_training": "armor_training", "weapon_proficiencies": "weapon_proficiencies",
		"tool_proficiencies": "tool_proficiencies", "skill_choices": "skill_choices",
		"starting_equipment": "starting_equipment", "equipment_options": "equipment_options",
		"level_progression": "level_progression", "resources": "resources",
		"is_subclass": "is_subclass", "parent_class_id": "parent_class_id",
		"subclass_level": "subclass_level", "related_effects": "related_effects",
		"related_actions": "related_actions", "type": "type", "author": "author",
		"source": "source", "tags": "tags", "is_extended": "is_extended",
	},
	"feat": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"category": "category", "prerequisite": "prerequisite", "ability_increase": "ability_increase",
		"related_effects": "related_effects", "related_actions": "related_actions",
		"repeatable": "repeatable", "type": "type", "author": "author", "source": "source",
		"tags": "tags", "is_extended": "is_extended",
	},
	"background": {
		"name": "name", "name_en": "name_en", "description": "description",
		"detailed_description": "detailed_description", "image_url": "image_url", "rarity": "rarity",
		"ability_scores": "ability_scores", "origin_feat": "origin_feat",
		"skill_proficiencies": "skill_proficiencies", "tool_proficiency": "tool_proficiency",
		"equipment": "equipment", "equipment_options": "equipment_options", "type": "type",
		"author": "author", "source": "source", "tags": "tags", "is_extended": "is_extended",
	},
}

func contentMigrationResponseForModel(model any) (any, error) {
	switch entity := model.(type) {
	case *Card:
		return entity.ToCardResponse(), nil
	case *Effect:
		return entity.ToEffectResponse(), nil
	case *Action:
		return entity.ToActionResponse(), nil
	case *Spell:
		return entity.ToSpellResponse(), nil
	case *Race:
		return entity.ToRaceResponse(), nil
	case *Class:
		return entity.ToClassResponse(), nil
	case *Feat:
		return entity.ToFeatResponse(), nil
	case *Background:
		return entity.ToBackgroundResponse(), nil
	default:
		return nil, errContentMigrationInvalidUpdate
	}
}

func newContentMigrationPatchModel(entityType string) (any, error) {
	switch entityType {
	case "card":
		return &Card{}, nil
	case "effect":
		return &Effect{}, nil
	case "action":
		return &Action{}, nil
	case "spell":
		return &Spell{}, nil
	case "race":
		return &Race{}, nil
	case "class":
		return &Class{}, nil
	case "feat":
		return &Feat{}, nil
	case "background":
		return &Background{}, nil
	default:
		return nil, errContentMigrationInvalidUpdate
	}
}

func decodeContentMigrationExactObject(raw json.RawMessage) (JSONMap, error) {
	if len(raw) == 0 {
		return nil, errContentMigrationInvalidUpdate
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errContentMigrationInvalidUpdate
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errContentMigrationInvalidUpdate
	}
	return JSONMap(object), nil
}

func contentMigrationDesiredUpdate(
	expected JSONMap,
	fields map[string]json.RawMessage,
) (JSONMap, error) {
	desired := make(JSONMap, len(expected))
	for key, value := range expected {
		desired[key] = value
	}
	changed := false
	for key, raw := range fields {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, errContentMigrationInvalidUpdate
		}
		if !reflect.DeepEqual(expected[key], value) {
			changed = true
		}
		desired[key] = value
	}
	if !changed {
		return nil, errContentMigrationInvalidUpdate
	}
	// Every accepted request changes at least one content column. The database
	// invalidation trigger must therefore clear any prior certification.
	desired["support"] = nil
	return desired, nil
}

func contentMigrationUpdateEquivalent(current, desired JSONMap) bool {
	return reflect.DeepEqual(
		contentMigrationComparableResponse(current),
		contentMigrationComparableResponse(desired),
	)
}

func validateContentMigrationExactUpdateFields(
	entityType string,
	expected JSONMap,
	fields map[string]json.RawMessage,
) ([]string, error) {
	allowlist, ok := contentMigrationExactUpdateColumns[entityType]
	if !ok || len(fields) == 0 {
		return nil, errContentMigrationInvalidUpdate
	}
	columns := make([]string, 0, len(fields))
	seenColumns := make(map[string]bool, len(fields))
	for field := range fields {
		column, allowed := allowlist[field]
		if !allowed {
			return nil, errContentMigrationInvalidUpdate
		}
		if _, present := expected[field]; !present {
			return nil, errContentMigrationInvalidUpdate
		}
		if !seenColumns[column] {
			columns = append(columns, column)
			seenColumns[column] = true
		}
	}
	sort.Strings(columns)
	return columns, nil
}

func (cc *ContentMigrationController) updateExactContent(
	entityType string,
	entityID uuid.UUID,
	expectedCurrent JSONMap,
	fields map[string]json.RawMessage,
) (entity any, alreadyApplied bool, err error) {
	columns, err := validateContentMigrationExactUpdateFields(entityType, expectedCurrent, fields)
	if err != nil {
		return nil, false, err
	}
	desired, err := contentMigrationDesiredUpdate(expectedCurrent, fields)
	if err != nil {
		return nil, false, err
	}
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		model, response, loadErr := loadContentMigrationEntityForUpdate(tx, entityType, entityID)
		if errors.Is(loadErr, gorm.ErrRecordNotFound) {
			return errContentMigrationNotFound
		}
		if loadErr != nil {
			return loadErr
		}
		current, mapErr := apiResponseAsJSONMap(response)
		if mapErr != nil {
			return mapErr
		}
		if !reflect.DeepEqual(current, expectedCurrent) {
			if contentMigrationUpdateEquivalent(current, desired) {
				entity = response
				alreadyApplied = true
				return nil
			}
			return errContentMigrationConflict
		}

		// Decode into a fresh patch model. Decoding into the already-loaded model
		// would merge JSON objects into non-nil maps (encoding/json semantics),
		// turning an exact mechanics replacement into an accidental deep merge.
		// Only the explicitly selected columns are written below, so zero values
		// on every other patch-model field cannot become implicit commands.
		patchModel, patchErr := newContentMigrationPatchModel(entityType)
		encodedFields, marshalErr := json.Marshal(fields)
		if patchErr != nil || marshalErr != nil || json.Unmarshal(encodedFields, patchModel) != nil {
			return errContentMigrationInvalidUpdate
		}
		candidateResponse, responseErr := contentMigrationResponseForModel(patchModel)
		if responseErr != nil {
			return responseErr
		}
		candidate, mapErr := apiResponseAsJSONMap(candidateResponse)
		if mapErr != nil {
			return mapErr
		}
		for field := range fields {
			if !reflect.DeepEqual(candidate[field], desired[field]) {
				return errContentMigrationInvalidUpdate
			}
		}

		update := tx.Model(model).Where("id = ?", entityID).Select(columns).Updates(patchModel)
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errContentMigrationConflict
		}
		_, updatedResponse, loadErr := loadContentMigrationEntityForUpdate(tx, entityType, entityID)
		if loadErr != nil {
			return loadErr
		}
		updated, mapErr := apiResponseAsJSONMap(updatedResponse)
		if mapErr != nil {
			return mapErr
		}
		if !contentMigrationUpdateEquivalent(updated, desired) {
			return errContentMigrationConflict
		}
		entity = updatedResponse
		return nil
	})
	return entity, alreadyApplied, err
}

func (cc *ContentMigrationController) ExactUpdate(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	if _, err := uuid.Parse(c.Param("bundleId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный bundle ID"})
		return
	}
	entityType := c.Param("entityType")
	if _, ok := contentMigrationExactUpdateColumns[entityType]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неподдерживаемый тип exact update"})
		return
	}
	entityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID сущности"})
		return
	}
	var request ContentMigrationExactUpdateRequest
	if err = decodeStrictContentMigrationJSON(c, &request); err != nil || request.SchemaVersion != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный exact update payload"})
		return
	}
	if err = validateContentMigrationIdentity(request.PlanHash, request.OperationID, request.CardNumber); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидная migration identity"})
		return
	}
	expected, err := decodeContentMigrationExactObject(request.ExpectedCurrent)
	if err != nil || expected["id"] != entityID.String() || expected["card_number"] != request.CardNumber {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected_current identity не совпадает с маршрутом"})
		return
	}
	if _, ok := expected["support"]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected_current должен содержать support"})
		return
	}
	if _, err = validateContentMigrationExactUpdateFields(entityType, expected, request.Fields); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fields содержат неразрешённую или неявную команду"})
		return
	}
	if cc.exactUpdate == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Exact update API не настроен"})
		return
	}
	entity, alreadyApplied, err := cc.exactUpdate(entityType, entityID, expected, request.Fields)
	if err != nil {
		switch {
		case errors.Is(err, errContentMigrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Сущность exact update не найдена"})
		case errors.Is(err, errContentMigrationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "Current content изменился; exact update отменён"})
		case errors.Is(err, errContentMigrationInvalidUpdate):
			c.JSON(http.StatusBadRequest, gin.H{"error": "Exact update не прошёл allowlist/type validation"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Exact update не выполнен"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"schema_version": 1, "entity_type": entityType, "entity_id": entityID,
		"card_number": request.CardNumber, "entity": entity,
		"already_applied": alreadyApplied, "cas": contentMigrationExactUpdateCAS,
	})
}
