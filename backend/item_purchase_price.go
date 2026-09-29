package main

import (
	"gorm.io/gorm"
)

// Only current catalog sources and the locked character's equipment/attunement
// determine discounts; never trust client price quotes or submitted passives.
func catalogPurchaseCopper(tx *gorm.DB, character *CharacterV3, listed int) (int, error) {
	if character == nil {
		return listed, nil
	}
	owned, err := roguelikeItemOwnership(character.Equipment, character.InventoryItems)
	if err != nil {
		return 0, err
	}
	if len(owned) == 0 {
		return listed, nil
	}
	ids := make([]string, 0, len(owned))
	for id := range owned {
		ids = append(ids, id)
	}
	var cards []Card
	if err = tx.Where("id IN ?", ids).Find(&cards).Error; err != nil {
		return 0, err
	}
	attuned, err := roguelikeAttunedIDs(character.TurnState)
	if err != nil {
		return 0, err
	}
	attunedSet := map[string]bool{}
	for _, id := range attuned {
		attunedSet[id] = true
	}
	result := listed
	for _, card := range cards {
		if card.Mechanics == nil {
			continue
		}
		id := card.ID.String()
		if card.RequiresAttunement != nil && *card.RequiresAttunement && !attunedSet[id] {
			continue
		}
		m := *card.Mechanics
		activation, _ := m["activation"].(map[string]any)
		if mode, _ := activation["mode"].(string); mode != "" && mode != "passive" {
			continue
		}
		while, _ := activation["while"].(string)
		if while == "" {
			while, _ = m["while"].(string)
		}
		equipped := false
		if character.Equipment != nil {
			for _, raw := range *character.Equipment {
				if raw == id {
					equipped = true
				}
			}
		}
		eligible := equipped
		if while == "carried" {
			eligible = owned[id] > 0
		}
		if while == "attuned" {
			eligible = attunedSet[id]
		}
		if !eligible {
			continue
		}
		payloads := itemCapacityPayloads(m)
		if m["kind"] == "purchase_price_policy" {
			payloads = []map[string]any{m}
		}
		for _, p := range payloads {
			if p["kind"] != "purchase_price_policy" {
				continue
			}
			discount, ok := numberFromJSON(p["discount_copper"])
			if ok && discount >= 0 {
				result -= discount
				if result < 0 {
					result = 0
				}
			}
		}
	}
	return result, nil
}
