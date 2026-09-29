package main

import "github.com/google/uuid"

func validateRuntimeEquipmentMap(equipment *JSONMap) error {
	if equipment == nil {
		return nil
	}
	allowed := map[string]bool{"head": true, "body": true, "main_hand": true, "off_hand": true, "gloves": true, "boots": true, "cloak": true, "necklace": true, "ring_1": true, "ring_2": true}
	for slot, raw := range *equipment {
		if !allowed[slot] {
			return invalidRuntimeCommand("unknown equipment slot")
		}
		if raw == nil {
			continue
		}
		id, ok := raw.(string)
		if !ok {
			return invalidRuntimeCommand("equipment must contain item identities")
		}
		parsed, err := uuid.Parse(id)
		if err != nil || parsed.String() != id {
			return invalidRuntimeCommand("equipment identity must be canonical UUID")
		}
	}
	return nil
}

// Equipment transfers preserve physical quantities. Only uncontained inventory
// can move into a slot; triggers may consume items but cannot mint any copies.
func validateRuntimeEquipmentTransition(character CharacterV3, patch CharacterRuntimeCommandPatch) error {
	if err := validateRuntimeEquipmentMap(patch.Equipment); err != nil {
		return err
	}
	totals := func(items *InventoryItemRows, equipment *JSONMap) map[string]int {
		out := map[string]int{}
		if items != nil {
			for _, row := range *items {
				out[runtimeInventoryIdentity(row)] += row.Qty
			}
		}
		seen := map[string]bool{}
		if equipment != nil {
			for _, raw := range *equipment {
				id, ok := raw.(string)
				if ok && id != "" && !seen[id] {
					seen[id] = true
					out[runtimeInventoryIdentity(InventoryItemRow{CardID: id})]++
				}
			}
		}
		return out
	}
	next := patch.InventoryItems
	if next == nil {
		next = character.InventoryItems
	}
	before, after := totals(character.InventoryItems, character.Equipment), totals(next, patch.Equipment)
	for key, qty := range after {
		if qty > before[key] {
			return invalidRuntimeCommand("equipment transition cannot add items or move container contents")
		}
	}
	return nil
}
