package main

import (
	"fmt"

	"gorm.io/gorm"
)

// Freeze the actual records, not just their ids: a later library edit must
// not silently change an encounter between drawing it and entering the board.
func freezeRoguelikeMonsterCatalog(tx *gorm.DB, monster Monster) (JSONMap, error) {
	actions := []Action{}
	effects := []Effect{}
	if monster.ActionIDs == nil || len(*monster.ActionIDs) == 0 {
		return nil, fmt.Errorf("monster %s has no actions", monster.Slug)
	}
	if err := tx.Where("id IN ?", []string(*monster.ActionIDs)).Order("id").Find(&actions).Error; err != nil {
		return nil, err
	}
	if len(actions) != len(*monster.ActionIDs) {
		return nil, fmt.Errorf("monster %s has missing actions", monster.Slug)
	}
	if monster.EffectIDs != nil && len(*monster.EffectIDs) > 0 {
		if err := tx.Where("id IN ?", []string(*monster.EffectIDs)).Order("id").Find(&effects).Error; err != nil {
			return nil, err
		}
		if len(effects) != len(*monster.EffectIDs) {
			return nil, fmt.Errorf("monster %s has missing effects", monster.Slug)
		}
	}
	return mapFromJSON(map[string]any{
		"version": 1, "monsters": []Monster{monster}, "actions": actions, "effects": effects,
	})
}
