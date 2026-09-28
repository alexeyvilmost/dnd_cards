package main

// This catalog-only projection mirrors the ordinary item gate. No caller may
// submit a capacity value through turn_state or obtain capacity from an item it
// does not own. Existing attunement choices are never silently truncated.
func catalogAttunementCapacity(cards []Card, equipment *JSONMap, inventory *InventoryItemRows, attuned []string) int {
	capacity := 3
	set := map[string]bool{}
	for _, id := range attuned {
		set[id] = true
	}
	seen := map[string]bool{}
	for _, card := range cards {
		id := card.ID.String()
		if seen[id] || card.Mechanics == nil {
			continue
		}
		seen[id] = true
		if card.RequiresAttunement != nil && *card.RequiresAttunement && !set[id] {
			continue
		}
		equipped, carried := false, false
		if equipment != nil {
			for _, raw := range *equipment {
				if raw == id {
					equipped = true
				}
			}
		}
		if inventory != nil {
			for _, row := range *inventory {
				if row.CardID == id && row.Qty > 0 {
					carried = true
				}
			}
		}
		m := *card.Mechanics
		activation, _ := m["activation"].(map[string]any)
		if activation == nil {
			if value, ok := m["activation"].(JSONMap); ok {
				activation = value
			}
		}
		mode, _ := activation["mode"].(string)
		if mode != "" && mode != "passive" {
			continue
		}
		while, _ := activation["while"].(string)
		if while == "" {
			while, _ = m["while"].(string)
		}
		eligible := equipped
		if while == "carried" {
			eligible = equipped || carried
		}
		if while == "attuned" {
			eligible = set[id]
		}
		if !eligible {
			continue
		}
		for _, payload := range itemCapacityPayloads(m) {
			if payload["kind"] != "attunement_capacity" {
				continue
			}
			amount, ok := numberFromJSON(payload["amount"])
			if ok {
				capacity += amount
			}
		}
	}
	if capacity < 0 {
		return 0
	}
	return capacity
}

func itemCapacityPayloads(m JSONMap) []map[string]any {
	if m["kind"] == "attunement_capacity" {
		return []map[string]any{m}
	}
	rows, ok := m["effects"].([]any)
	if !ok {
		rows, _ = m["interactions"].([]any)
	}
	var result []map[string]any
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		payloads, ok := row["result"].([]any)
		if !ok {
			payloads, _ = row["results"].([]any)
		}
		for _, value := range payloads {
			if payload, ok := value.(map[string]any); ok {
				result = append(result, payload)
			}
		}
	}
	return result
}
