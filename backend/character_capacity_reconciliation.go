package main

import (
	"math"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// A build changes maximum vitality, not the already committed damage share.
// Temporary HP and encounter-owned vitality are separate runtime channels.
func characterCurrentHPForMaximum(current, previousMaximum, nextMaximum int) int {
	if nextMaximum <= 0 || current <= 0 {
		return 0
	}
	if previousMaximum <= 0 {
		return min(current, nextMaximum)
	}
	current = min(current, previousMaximum)
	return min(nextMaximum, max(1, int(math.Round(float64(current)*float64(nextMaximum)/float64(previousMaximum)))))
}

func characterCurrentResourceForMaximum(current, previousMaximum, nextMaximum int) int {
	return max(0, min(nextMaximum, current+max(0, nextMaximum-previousMaximum)))
}

func resourceCapacityNumber(value any) (int, bool) {
	number, ok := numericJSONValue(value)
	if !ok || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) || number != math.Floor(number) {
		return 0, false
	}
	return int(number), true
}

// Override requested currents only for changed capacity. The locked row is
// the baseline, so a stale/full browser projection cannot restore old spent
// slots while gaining one new slot. Manual adjustments at unchanged maxima
// and ordinary rest commands retain their existing semantics.
func reconcileCharacterResourceCapacities(character CharacterV3, req PatchCharacterRuntimeRequest, dormantItemPools map[string]bool) *JSONMap {
	if req.MaxResources == nil {
		return req.Resources
	}
	resources := cloneJSONMapValue(character.Resources)
	if req.Resources != nil {
		resources = cloneJSONMapValue(req.Resources)
	}
	changed := false
	for key, rawMaximum := range *req.MaxResources {
		maximum, valid := resourceCapacityNumber(rawMaximum)
		if !valid {
			continue
		}
		var oldMaximum int
		var knownMaximum bool
		if character.MaxResources != nil {
			oldMaximum, knownMaximum = resourceCapacityNumber((*character.MaxResources)[key])
		}
		if knownMaximum && maximum == oldMaximum {
			continue
		}
		var current int
		var knownCurrent bool
		if character.Resources != nil {
			current, knownCurrent = resourceCapacityNumber((*character.Resources)[key])
		}
		if !knownCurrent {
			resources[key] = maximum
		} else if !knownMaximum {
			// A historical pool lacking a maximum does not prove fresh capacity.
			resources[key] = min(current, maximum)
		} else if oldMaximum == 0 && dormantItemPools[key] {
			resources[key] = min(current, maximum)
		} else {
			resources[key] = characterCurrentResourceForMaximum(current, oldMaximum, maximum)
		}
		changed = true
	}
	if !changed && req.Resources == nil {
		return nil
	}
	return &resources
}

// An unequipped item may retain an empty initialized pool. Re-equipping it
// reactivates the same capacity and must not manufacture restored charges.
// Resource keys are read from owned item grant primitives, never item names.
func dormantCharacterItemResourcePools(db *gorm.DB, character CharacterV3, req PatchCharacterRuntimeRequest) (map[string]bool, error) {
	keys := map[string]bool{}
	if req.MaxResources == nil || character.MaxResources == nil {
		return keys, nil
	}
	needsItems := false
	for key, next := range *req.MaxResources {
		before, known := resourceCapacityNumber((*character.MaxResources)[key])
		after, valid := resourceCapacityNumber(next)
		if known && valid && before == 0 && after > 0 {
			needsItems = true
			break
		}
	}
	if !needsItems {
		return keys, nil
	}
	ids := map[uuid.UUID]bool{}
	if character.InventoryItems != nil {
		for _, row := range *character.InventoryItems {
			if id, err := uuid.Parse(row.CardID); err == nil {
				ids[id] = true
			}
		}
	}
	if character.Equipment != nil {
		for _, value := range *character.Equipment {
			if reference, ok := value.(string); ok {
				if id, err := uuid.Parse(reference); err == nil {
					ids[id] = true
				}
			}
		}
	}
	if len(ids) == 0 {
		return keys, nil
	}
	itemIDs := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		itemIDs = append(itemIDs, id)
	}
	var cards []Card
	if err := db.Select("id", "mechanics").Where("id IN ?", itemIDs).Find(&cards).Error; err != nil {
		return nil, err
	}
	var collect func(any)
	collect = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if node["kind"] == "resource" && node["op"] == "grant" {
				if key, ok := node["id"].(string); ok {
					keys[key] = true
				}
			}
			for _, child := range node {
				collect(child)
			}
		case []any:
			for _, child := range node {
				collect(child)
			}
		}
	}
	for _, card := range cards {
		if card.Mechanics != nil {
			collect(map[string]any(*card.Mechanics))
		}
	}
	return keys, nil
}
