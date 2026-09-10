package main

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"strings"
)

// A committed level-up retry cannot spend the replacement allowance again.
func validateRoguelikeLevelChoiceReplacements(tx *gorm.DB, before CharacterV3, after *JSONMap, nextLevel int) error {
	if before.ResolvedChoices == nil {
		return nil
	}
	featureIDs := []uuid.UUID{}
	for key := range *before.ResolvedChoices {
		parts := strings.Split(key, ":")
		if len(parts) != 4 || parts[0] != "class" {
			continue
		}
		id, err := uuid.Parse(parts[2])
		if err == nil {
			featureIDs = append(featureIDs, id)
		}
	}
	if len(featureIDs) == 0 {
		return nil
	}
	var effects []Effect
	if err := tx.Select("id", "mechanics").Where("id IN ?", featureIDs).Find(&effects).Error; err != nil {
		return err
	}
	limits := map[string]int{}
	for _, effect := range effects {
		if effect.Mechanics == nil {
			continue
		}
		entries, _ := (*effect.Mechanics)["effects"].([]interface{})
		for _, entry := range entries {
			declaration, ok := entry.(map[string]interface{})
			if !ok {
				continue
			}
			id, _ := declaration["id"].(string)
			limit, valid := numberFromJSON(declaration["replace_on_level_up"])
			if valid && limit > 0 {
				limits[effect.ID.String()+":"+id] = limit
			}
		}
	}
	for key, original := range *before.ResolvedChoices {
		parts := strings.Split(key, ":")
		if len(parts) != 4 {
			continue
		}
		limit, ok := limits[parts[2]+":"+parts[3]]
		if !ok {
			continue
		}
		if nextLevel <= before.Level {
			limit = 0
		}
		var selected interface{}
		if after != nil {
			selected = (*after)[key]
		}
		if !roguelikeChoiceReplacementAllowed(original, selected, limit) {
			return roguelikeMutationError("roguelike_choice_replacement_forbidden", "Превышено число замен ранее выбранных способностей на этом уровне", before.ID)
		}
	}
	return nil
}

func roguelikeChoiceReplacementAllowed(original, selected interface{}, limit int) bool {
	originalSet := map[string]bool{}
	selectedSet := map[string]bool{}
	read := func(raw interface{}, out map[string]bool) {
		switch values := raw.(type) {
		case []interface{}:
			for _, value := range values {
				if id, ok := value.(string); ok {
					out[id] = true
				}
			}
		case []string:
			for _, id := range values {
				out[id] = true
			}
		}
	}
	read(original, originalSet)
	read(selected, selectedSet)
	removed := 0
	for id := range originalSet {
		if !selectedSet[id] {
			removed++
		}
	}
	return removed <= limit
}
