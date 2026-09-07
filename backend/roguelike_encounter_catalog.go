package main

import (
	"fmt"

	"gorm.io/gorm"
)

// Freeze the actual records, not just their ids: a later library edit must
// not silently change an encounter between drawing it and entering the board.
func freezeRoguelikeMonsterCatalog(tx *gorm.DB, monsters []Monster) (JSONMap, error) {
	actions := []Action{}
	effects := []Effect{}
	actionIds, effectIds := map[string]bool{}, map[string]bool{}
	for _, monster := range monsters {
		if monster.ActionIDs == nil || len(*monster.ActionIDs) == 0 {
			return nil, fmt.Errorf("monster %s has no actions", monster.Slug)
		}
		for _, id := range *monster.ActionIDs {
			actionIds[id] = true
		}
		if monster.EffectIDs != nil {
			for _, id := range *monster.EffectIDs {
				effectIds[id] = true
			}
		}
	}
	ids := []string{}
	for id := range actionIds {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("empty monster catalog")
	}
	if err := tx.Where("id IN ?", ids).Order("id").Find(&actions).Error; err != nil {
		return nil, err
	}
	if len(actions) != len(ids) {
		return nil, fmt.Errorf("encounter has missing actions")
	}
	ids = []string{}
	for id := range effectIds {
		ids = append(ids, id)
	}
	if len(ids) > 0 {
		if err := tx.Where("id IN ?", ids).Order("id").Find(&effects).Error; err != nil {
			return nil, err
		}
		if len(effects) != len(ids) {
			return nil, fmt.Errorf("encounter has missing effects")
		}
	}

	return mapFromJSON(map[string]any{
		"version": 1, "monsters": monsters, "actions": actions, "effects": effects,
	})
}
