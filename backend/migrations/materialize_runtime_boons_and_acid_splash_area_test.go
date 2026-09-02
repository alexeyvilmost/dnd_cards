package migrations

import (
	"encoding/json"
	"testing"
)

func TestRuntimeBoonAndAcidSplashDeclarations(t *testing.T) {
	var boon, action, targeting map[string]any
	for raw, destination := range map[string]*map[string]any{
		bardicBoonMechanics:     &boon,
		bardicGrantMechanics:    &action,
		acidSplashAreaTargeting: &targeting,
	} {
		if err := json.Unmarshal([]byte(raw), destination); err != nil {
			t.Fatalf("invalid migration JSON: %v", err)
		}
	}
	if boon["kind"] != "boon" || boon["die"] != "1d6" {
		t.Fatalf("invalid Bardic boon contract: %#v", boon)
	}
	effects := action["effects"].([]any)
	result := effects[0].(map[string]any)["result"].([]any)
	if result[0].(map[string]any)["value"] != bardicBoonEffectCard {
		t.Fatalf("Bardic action does not grant the library effect")
	}
	area := targeting["area"].(map[string]any)
	if targeting["shape"] != "area" || area["kind"] != "sphere" || area["radius_ft"] != float64(5) {
		t.Fatalf("Acid Splash targeting is not a 5-foot sphere: %#v", targeting)
	}

	found := false
	migrations := GetAllMigrations()
	for _, migration := range migrations {
		if migration.Version == runtimeBoonsAreaMigrationVersion {
			found = true
		}
	}
	if !found {
		t.Fatalf("migration %s is not registered", runtimeBoonsAreaMigrationVersion)
	}
	if migrations[len(migrations)-1].Version != runtimeBoonsAreaMigrationVersion {
		t.Fatalf("migration %s must remain the latest migration", runtimeBoonsAreaMigrationVersion)
	}
}
