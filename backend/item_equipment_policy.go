package main

import "gorm.io/gorm"

func itemCannotRemove(card Card) bool {
	if card.Mechanics == nil {
		return false
	}
	m := *card.Mechanics
	if m["kind"] == "equipment_policy" && m["cannot_remove"] == true {
		return true
	}
	for _, payload := range itemCapacityPayloads(m) {
		if payload["kind"] == "equipment_policy" && payload["cannot_remove"] == true {
			return true
		}
	}
	return false
}

// Catalog policy is checked under the same transaction/character row lock as
// every runtime patch. Client-submitted mechanics and attunement cannot bypass it.
func validateItemEquipmentChange(tx *gorm.DB, character CharacterV3, next *JSONMap) error {
	if next == nil || character.Equipment == nil {
		return nil
	}
	var ids []string
	for slot, raw := range *character.Equipment {
		id, ok := raw.(string)
		if ok && id != "" && (*next)[slot] != id {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var cards []Card
	if err := tx.Unscoped().Where("id IN ?", ids).Find(&cards).Error; err != nil {
		return err
	}
	for _, card := range cards {
		if itemCannotRemove(card) {
			return roguelikeMutationError("item_cannot_remove", "свойство предмета запрещает снятие: "+card.Name, character.ID)
		}
	}
	return nil
}
