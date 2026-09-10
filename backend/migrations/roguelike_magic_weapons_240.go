package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
)

var roguelikeMagicWeapons = []struct{ ID, Number, Base string }{
	{"a68f0b7a-5713-475b-a16a-fd055f307b6c", "CARD-0081", "CARD-0319"},
	{"4931d810-b058-49e3-ae5e-90a5422a97ef", "CARD-0118", "CARD-0323"},
}

// Carry the base weapon's declared rules into its +1 variant. The enchantment
// belongs to this weapon, rather than granting a bonus to every owned attack.
func roguelikeMagicWeaponMechanics(baseJSON, currentJSON []byte) ([]byte, error) {
	var base, current map[string]any
	if err := json.Unmarshal(baseJSON, &base); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(currentJSON, &current); err != nil {
		return nil, err
	}
	if current == nil {
		return nil, fmt.Errorf("magic weapon mechanics missing")
	}
	profile, ok := base["weapon_profile"].(map[string]any)
	if !ok || profile["weapon_type"] == nil {
		return nil, fmt.Errorf("base weapon profile missing")
	}
	profile["enchantment"] = map[string]any{"attack_bonus": 1, "damage_bonus": 1, "extra_damage_lines": []any{}}
	if declared := current["weapon_profile"]; declared != nil && !reflect.DeepEqual(declared, profile) {
		// JSON numbers decode as float64, including an already migrated profile.
		expected, _ := json.Marshal(profile)
		var normalized any
		json.Unmarshal(expected, &normalized)
		if !reflect.DeepEqual(declared, normalized) {
			return nil, fmt.Errorf("magic weapon profile drifted")
		}
	}
	current["weapon_profile"] = profile
	if effects, ok := current["effects"].([]any); ok {
		kept := []any{}
		for _, value := range effects {
			effect, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid magic weapon effect")
			}
			if results, ok := effect["result"].([]any); ok {
				remaining := []any{}
				for _, value := range results {
					result, _ := value.(map[string]any)
					applies, _ := result["applies_to"].(map[string]any)
					if result["kind"] == "modifier" && result["op"] == "add" && result["value"] == "+1" && (applies["roll"] == "attack" || applies["roll"] == "damage") {
						continue
					}
					remaining = append(remaining, value)
				}
				effect["result"] = remaining
				if len(remaining) == 0 {
					continue
				}
			}
			kept = append(kept, effect)
		}
		if len(kept) == 0 {
			delete(current, "effects")
		} else {
			current["effects"] = kept
		}
	}
	return json.Marshal(current)
}

func materializeRoguelikeMagicWeapons(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range roguelikeMagicWeapons {
		var base, current []byte
		if err := tx.QueryRow(`SELECT mechanics FROM cards WHERE card_number=$1 AND deleted_at IS NULL`, row.Base).Scan(&base); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT mechanics FROM cards WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL FOR UPDATE`, row.ID, row.Number).Scan(&current); err != nil {
			return err
		}
		next, err := roguelikeMagicWeaponMechanics(base, current)
		if err != nil {
			return fmt.Errorf("%s: %w", row.Number, err)
		}
		if _, err := tx.Exec(`UPDATE cards SET mechanics=$2::jsonb, updated_at=NOW() WHERE id=$1::uuid AND mechanics IS DISTINCT FROM $2::jsonb`, row.ID, next); err != nil {
			return err
		}
	}
	return tx.Commit()
}
