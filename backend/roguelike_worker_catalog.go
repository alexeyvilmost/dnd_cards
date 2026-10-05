package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"sort"
	"strings"
)

type roguelikeFrozenCatalog struct {
	SchemaVersion       int                  `json:"schemaVersion"`
	Entities            map[string][]JSONMap `json:"entities"`
	Variables           []Variable           `json:"variables"`
	VariablesComplete   bool                 `json:"variablesComplete"`
	CompleteEffectTypes []string             `json:"completeEffectTypes"`
}

const catalogSpellAliasSQL = `trim(both '_' from lower(regexp_replace(regexp_replace(coalesce(name_en, ''), '''', '', 'g'), '[^a-zA-Z0-9]+', '_', 'g')))`

func emptyRoguelikeFrozenCatalog() roguelikeFrozenCatalog {
	catalog := roguelikeFrozenCatalog{SchemaVersion: 1, Entities: map[string][]JSONMap{}, Variables: []Variable{}, CompleteEffectTypes: []string{}}
	for _, kind := range []string{"race", "class", "background", "feat", "effect", "action", "spell", "card", "resource"} {
		catalog.Entities[kind] = []JSONMap{}
	}
	return catalog
}
func projectFrozenCatalogEntity(kind string, entity any) (JSONMap, error) {
	row, err := mapFromJSON(entity)
	if err != nil {
		return nil, err
	}
	id, _ := row["id"].(string)
	if id == "" {
		return nil, fmt.Errorf("catalog entity missing id")
	}
	// Art is loaded independently by the canonical image endpoint. Freeze the
	// complete mechanics/text, not hundreds of KB of base64 on every 5ft move.
	// Only new catalogs use this projection; historical envelopes stay intact.
	if image, ok := row["image_url"].(string); ok && strings.HasPrefix(image, "data:image/") {
		tables := map[string]string{"race": "races", "class": "classes", "background": "backgrounds", "feat": "feats", "effect": "effects", "action": "actions", "spell": "spells", "card": "cards", "resource": "resources"}
		if table := tables[kind]; table != "" {
			row["image_url"] = "/api/content-images/" + table + "/" + id
		}
	}
	return row, nil
}
func (catalog *roguelikeFrozenCatalog) add(kind string, entity any) error {
	row, err := projectFrozenCatalogEntity(kind, entity)
	if err != nil {
		return err
	}
	id := row["id"].(string)
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
	defer performanceSince(tx.Statement.Context, "catalog_fulfill_ms")()
	performanceAdd(tx.Statement.Context, "catalog_needs_count", 1)
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
		// grant_spell values often use the English-name slug (bane, hunters_mark)
		// while the library row keeps a SPELL-xxxx card_number. Resolve that alias
		// for spells only; other kinds stay exact card_number/id lookups.
		if errors.Is(err, gorm.ErrRecordNotFound) && need.EntityType == "spell" && column == "card_number" {
			alias := strings.ToLower(strings.TrimSpace(need.Reference))
			if alias != "" {
				var spells []Spell
				if aliasErr := tx.Where(catalogSpellAliasSQL+" = ?", alias).
					Order("id").Limit(2).Find(&spells).Error; aliasErr != nil {
					return aliasErr
				}
				if len(spells) > 1 {
					return &roguelikeWorkerRejection{"combat_catalog_ambiguous_ref", "Английское имя заклинания неоднозначно. Укажите его ID или номер в данных способности. Действие не применено."}
				}
				if len(spells) == 1 {
					return catalog.add(need.EntityType, spells[0])
				}
			}
		}
		return fmt.Errorf("missing pinned %s %s: %w", need.EntityType, need.Reference, err)
	}
	return catalog.add(need.EntityType, entity)
}

// Resolve the existing assembler's dependency closure. The final snapshot is
// immutable; an incomplete optional dependency cannot silently remove a feature.
func initializeRoguelikeWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, run *RoguelikeRun, seed string, initiativeManeuverActionID string) (*roguelikeWorkerResult, JSONMap, error) {
	defer performanceSince(ctx, "catalog_resolution_total_ms")()
	tx = tx.WithContext(ctx)
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
	input["mapId"] = run.Encounter["map_id"]
	input["enemyEffects"] = run.Encounter["enemy_effects"]
	if index, ok := run.Encounter["map_index"]; ok {
		input["mapIndex"] = index
	}
	if seed, ok := run.Encounter["map_seed"]; ok {
		input["mapSeed"] = seed
	}
	if roguelikePartySize(run) > 1 {
		input["characters"] = run.Characters
	}
	for round := 0; round < 16; round++ {
		result, err := client.call(ctx, "/initialize", map[string]any{"input": input})
		if err != nil {
			return nil, nil, err
		}
		if result.Status != "needs_content" {
			if performanceFrom(ctx) != nil {
				encoded, _ := json.Marshal(catalog)
				performanceAdd(ctx, "catalog_final_bytes", float64(len(encoded)))
			}
			frozen, err := mapFromJSON(catalog)
			if err == nil {
				frozen["artifactHash"] = result.Envelope["artifactHash"]
			}
			return result, frozen, err
		}
		performanceAdd(ctx, "catalog_needs_rounds", 1)
		previous, _ := json.Marshal(catalog)
		if err = catalog.fulfillWave(tx, result.Needs); err != nil {
			return nil, nil, err
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
			"masteryChoices": request.Payload["mastery_choices"], "elapsedSeconds": roguelikeRestElapsedSeconds(run, request.Type), "preservePreparation": roguelikePartySize(run) > 1 || request.Payload["preserve_preparation"] == true,
			"slotRecoverySelections": request.Payload["slot_recovery_selections"], "spellSwapSelections": request.Payload["spell_swap_selections"], "spellPreparation": request.Payload["spell_preparation"],
		}})
		if err != nil {
			return nil, err
		}
		if result.Status != "needs_content" {
			return result, nil
		}
		performanceAdd(ctx, "catalog_needs_rounds", 1)
		previous, _ := json.Marshal(catalog)
		if err = catalog.fulfillWave(tx, result.Needs); err != nil {
			return nil, err
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, fmt.Errorf("rest catalog resolution made no progress")
		}
	}
	return nil, fmt.Errorf("rest catalog dependency budget exceeded")
}

func executeRoguelikeCampActionWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, character *CharacterV3, request RoguelikeCommandRequest, party ...*CharacterV3) (*roguelikeWorkerResult, error) {
	seed, err := newRoguelikeSeed()
	if err != nil {
		return nil, err
	}
	return executeSeededRoguelikeCampActionWorker(ctx, tx, client, character, request, seed, party...)
}

// The HTTP command always obtains its seed from newRoguelikeSeed above. A
// separate deterministic boundary permits exact resolver differential tests;
// there is no browser-supplied seed and no alternate mechanics implementation.
func executeSeededRoguelikeCampActionWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, character *CharacterV3, request RoguelikeCommandRequest, seed string, party ...*CharacterV3) (*roguelikeWorkerResult, error) {
	catalog := emptyRoguelikeFrozenCatalog()
	var basics []Action
	if err := tx.Where("type = ?", "basic").Order("id").Find(&basics).Error; err != nil {
		return nil, err
	}
	ids := []string{}
	for _, action := range basics {
		ids = append(ids, action.ID.String())
		if err := catalog.add("action", action); err != nil {
			return nil, err
		}
	}
	input := map[string]any{"character": character, "catalog": &catalog, "basicActionIds": ids, "seed": seed,
		"commandId": request.CommandID.String(), "actionId": roguelikePayloadString(request, "action_id"), "itemCardId": roguelikePayloadString(request, "card_id"), "nextTurn": request.Type == "camp_turn",
		"choices": request.Payload["choices"], "spell": request.Payload["spell"], "worldInput": request.Payload["world_input"], "companion": request.Payload["companion"]}
	if len(party) > 0 {
		input["characters"] = party
		input["targetIds"] = request.Payload["target_ids"]
	}
	for attempt := 0; attempt < 32; attempt++ {
		result, err := client.call(ctx, "/camp-action", map[string]any{"input": input})
		if err != nil {
			return nil, err
		}
		if result.Status != "needs_content" {
			return result, nil
		}
		performanceAdd(ctx, "catalog_needs_rounds", 1)
		previous, _ := json.Marshal(catalog)
		if err = catalog.fulfillWave(tx, result.Needs); err != nil {
			return nil, err
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, fmt.Errorf("camp catalog resolution made no progress")
		}
	}
	return nil, fmt.Errorf("camp catalog dependency budget exceeded")
}
