package migrations

import (
	"encoding/json"
	"testing"
)

func TestPolymorphedConditionDeclarationAndRegistration(t *testing.T) {
	var mechanics map[string]any
	if err := json.Unmarshal([]byte(polymorphedConditionMechanics), &mechanics); err != nil {
		t.Fatalf("invalid polymorphed condition JSON: %v", err)
	}
	condition := mechanics["condition"].(map[string]any)
	if condition["id"] != "polymorphed" {
		t.Fatalf("unexpected polymorphed condition identity: %#v", condition)
	}

	migrations := GetAllMigrations()
	found := false
	for _, migration := range migrations {
		if migration.Version == polymorphedConditionMigrationVersion {
			found = true
		}
	}
	if !found {
		t.Fatalf("migration %s is not registered", polymorphedConditionMigrationVersion)
	}
	if migrations[len(migrations)-1].Version != polymorphedConditionMigrationVersion {
		t.Fatalf("migration %s must remain the latest migration", polymorphedConditionMigrationVersion)
	}
}
