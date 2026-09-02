package migrations

import (
	"encoding/json"
	"testing"
)

func TestMiniMVPAreaTargetingDeclarationsAndRegistration(t *testing.T) {
	for raw, expected := range map[string]struct {
		kind string
		size float64
	}{
		armsOfHadarTargeting: {kind: "emanation", size: 10},
		colorSprayTargeting:  {kind: "cone", size: 15},
	} {
		var targeting map[string]any
		if err := json.Unmarshal([]byte(raw), &targeting); err != nil {
			t.Fatalf("invalid area targeting JSON: %v", err)
		}
		area := targeting["area"].(map[string]any)
		size := area["radius_ft"]
		if size == nil {
			size = area["size_ft"]
		}
		if targeting["shape"] != "area" || area["kind"] != expected.kind || size != expected.size {
			t.Fatalf("unexpected area targeting declaration: %#v", targeting)
		}
	}

	migrations := GetAllMigrations()
	found := false
	for _, migration := range migrations {
		if migration.Version == miniMVPAreaTargetingMigrationVersion {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("migration %s must remain registered", miniMVPAreaTargetingMigrationVersion)
	}
}
