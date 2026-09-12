package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"sort"
)

type roguelikeFrozenCatalog struct {
	SchemaVersion       int                  `json:"schemaVersion"`
	Entities            map[string][]JSONMap `json:"entities"`
	Variables           []Variable           `json:"variables"`
	VariablesComplete   bool                 `json:"variablesComplete"`
	CompleteEffectTypes []string             `json:"completeEffectTypes"`
}

func emptyRoguelikeFrozenCatalog() roguelikeFrozenCatalog {
	catalog := roguelikeFrozenCatalog{SchemaVersion: 1, Entities: map[string][]JSONMap{}, Variables: []Variable{}, CompleteEffectTypes: []string{}}
	for _, kind := range []string{"race", "class", "background", "feat", "effect", "action", "spell", "card", "resource"} {
		catalog.Entities[kind] = []JSONMap{}
	}
	return catalog
}
func (catalog *roguelikeFrozenCatalog) add(kind string, entity any) error {
	row, err := mapFromJSON(entity)
	if err != nil {
		return err
	}
	id, _ := row["id"].(string)
	if id == "" {
		return fmt.Errorf("catalog entity missing id")
	}
	for _, existing := range catalog.Entities[kind] {
		if existing["id"] == id {
			return nil
		}
	}
	catalog.Entities[kind] = append(catalog.Entities[kind], row)
	sort.Slice(catalog.Entities[kind], func(i, j int) bool {
		return catalog.Entities[kind][i]["id"].(string) < catalog.Entities[kind][j]["id"].(string)
	})
	return nil
}
func (catalog *roguelikeFrozenCatalog) fulfill(tx *gorm.DB, need roguelikeWorkerNeed) error {
	if need.Kind == "variables" {
		if err := tx.Order("id").Find(&catalog.Variables).Error; err != nil {
			return err
		}
		catalog.VariablesComplete = true
		return nil
	}
	if need.Kind == "effect_type" {
		var rows []Effect
		if err := tx.Where("type = ?", need.EffectType).Order("id").Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if err := catalog.add("effect", row); err != nil {
				return err
			}
		}
		for _, kind := range catalog.CompleteEffectTypes {
			if kind == need.EffectType {
				return nil
			}
		}
		catalog.CompleteEffectTypes = append(catalog.CompleteEffectTypes, need.EffectType)
		sort.Strings(catalog.CompleteEffectTypes)
		return nil
	}
	if need.Kind != "entity" || need.Reference == "" {
		return fmt.Errorf("unknown catalog dependency")
	}
	var entity any
	switch need.EntityType {
	case "race":
		entity = &Race{}
	case "class":
		entity = &Class{}
	case "background":
		entity = &Background{}
	case "feat":
		entity = &Feat{}
	case "effect":
		entity = &Effect{}
	case "action":
		entity = &Action{}
	case "spell":
		entity = &Spell{}
	case "card":
		entity = &Card{}
	case "resource":
		entity = &ResourceDefinition{}
	default:
		return fmt.Errorf("unknown catalog entity type")
	}
	column := "card_number"
	if need.EntityType == "resource" {
		column = "resource_id"
	}
	if _, err := uuid.Parse(need.Reference); err == nil {
		column = "id"
	}
	if err := tx.Where(column+" = ?", need.Reference).First(entity).Error; err != nil {
		return fmt.Errorf("missing pinned %s: %w", need.EntityType, err)
	}
	return catalog.add(need.EntityType, entity)
}

// Resolve the existing assembler's dependency closure. The final snapshot is
// immutable; an incomplete optional dependency cannot silently remove a feature.
func initializeRoguelikeWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, run *RoguelikeRun, seed string, initiativeManeuverActionID string) (*roguelikeWorkerResult, JSONMap, error) {
	// Each initialization starts a new attempt with its current owned loadout.
	// The opponent roster/stat blocks remain frozen in run.Encounter. Once this
	// initialization commits, transitions use its exact artifact/catalog envelope.
	catalog := emptyRoguelikeFrozenCatalog()
	var basics []Action
	if err := tx.Where("type = ?", "basic").Order("id").Find(&basics).Error; err != nil {
		return nil, nil, err
	}
	ids := []string{}
	for _, action := range basics {
		ids = append(ids, action.ID.String())
		if err := catalog.add("action", action); err != nil {
			return nil, nil, err
		}
	}
	input := map[string]any{"character": run.Character, "catalog": &catalog, "basicActionIds": ids,
		"monsters": run.Encounter["catalog"], "roster": run.Encounter["roster"], "seed": seed, "initiativeManeuverActionId": initiativeManeuverActionID}
	for round := 0; round < 16; round++ {
		result, err := client.call(ctx, "/initialize", map[string]any{"input": input})
		if err != nil {
			return nil, nil, err
		}
		if result.Status != "needs_content" {
			frozen, err := mapFromJSON(catalog)
			if err == nil {
				frozen["artifactHash"] = result.Envelope["artifactHash"]
			}
			return result, frozen, err
		}
		previous, _ := json.Marshal(catalog)
		for _, need := range result.Needs {
			if err = catalog.fulfill(tx, need); err != nil {
				return nil, nil, err
			}
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, nil, fmt.Errorf("catalog resolution made no progress")
		}
	}
	return nil, nil, fmt.Errorf("catalog dependency budget exceeded")
}

// Rest inputs are derived from the saved character; browser runtime patches are never executed.
func executeRoguelikeRestWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, run *RoguelikeRun, request RoguelikeCommandRequest) (*roguelikeWorkerResult, error) {
	catalog := emptyRoguelikeFrozenCatalog()
	var binding any
	var recall any
	if request.Type == "recall_weapon" {
		recall = map[string]any{"objectId": roguelikePayloadString(request, "object_id"), "hand": roguelikePayloadString(request, "hand"), "commandId": request.CommandID.String()}
	}
	if request.Type == "bind_weapon" {
		binding = map[string]any{"cardId": roguelikePayloadString(request, "card_id"), "instanceId": request.CommandID.String() + ":weapon-bond", "replaceObjectId": roguelikePayloadString(request, "replace_object_id")}
	}
	for attempt := 0; attempt < 32; attempt++ {
		result, err := client.call(ctx, "/rest", map[string]any{"input": map[string]any{
			"character": run.Character, "catalog": catalog, "long": request.Type == "long_rest", "hitDieRolls": request.Payload["hit_die_rolls"], "bindWeapon": binding, "recallWeapon": recall,
			"masteryChoices": request.Payload["mastery_choices"], "elapsedSeconds": roguelikeRestElapsedSeconds(run, request.Type),
			"slotRecoverySelections": request.Payload["slot_recovery_selections"], "spellSwapSelections": request.Payload["spell_swap_selections"], "spellPreparation": request.Payload["spell_preparation"],
		}})
		if err != nil {
			return nil, err
		}
		if result.Status != "needs_content" {
			return result, nil
		}
		previous, _ := json.Marshal(catalog)
		for _, need := range result.Needs {
			if err = catalog.fulfill(tx, need); err != nil {
				return nil, err
			}
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, fmt.Errorf("rest catalog resolution made no progress")
		}
	}
	return nil, fmt.Errorf("rest catalog dependency budget exceeded")
}

func executeRoguelikeCampActionWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, character *CharacterV3, request RoguelikeCommandRequest) (*roguelikeWorkerResult, error) {
	catalog := emptyRoguelikeFrozenCatalog()
	seed, err := newRoguelikeSeed()
	if err != nil {
		return nil, err
	}
	var basics []Action
	if err = tx.Where("type = ?", "basic").Order("id").Find(&basics).Error; err != nil {
		return nil, err
	}
	ids := []string{}
	for _, action := range basics {
		ids = append(ids, action.ID.String())
		if err = catalog.add("action", action); err != nil {
			return nil, err
		}
	}
	input := map[string]any{"character": character, "catalog": &catalog, "basicActionIds": ids, "seed": seed,
		"commandId": request.CommandID.String(), "actionId": roguelikePayloadString(request, "action_id"), "itemCardId": roguelikePayloadString(request, "card_id"), "nextTurn": request.Type == "camp_turn",
		"choices": request.Payload["choices"], "spell": request.Payload["spell"], "worldInput": request.Payload["world_input"], "companion": request.Payload["companion"]}
	for attempt := 0; attempt < 32; attempt++ {
		result, err := client.call(ctx, "/camp-action", map[string]any{"input": input})
		if err != nil {
			return nil, err
		}
		if result.Status != "needs_content" {
			return result, nil
		}
		previous, _ := json.Marshal(catalog)
		for _, need := range result.Needs {
			if err = catalog.fulfill(tx, need); err != nil {
				return nil, err
			}
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, fmt.Errorf("camp catalog resolution made no progress")
		}
	}
	return nil, fmt.Errorf("camp catalog dependency budget exceeded")
}
