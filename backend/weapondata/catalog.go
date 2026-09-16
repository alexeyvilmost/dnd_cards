package weapondata

import (
	_ "embed"
	"encoding/json"
)

// Generated from frontend/utils/weapon_types.json. The equality test prevents drift.
//
//go:embed weapon_types.generated.json
var raw []byte
var categories = func() map[string]string {
	var catalog struct {
		Basic []struct {
			Name    string
			Weapons []struct{ Name string }
		}
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		panic(err)
	}
	result := map[string]string{}
	for _, group := range catalog.Basic {
		for _, weapon := range group.Weapons {
			result[weapon.Name] = group.Name
		}
	}
	return result
}()

func Category(weaponType string) string { return categories[weaponType] }
