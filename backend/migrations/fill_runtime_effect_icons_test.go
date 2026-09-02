package migrations

import "testing"

func TestRuntimeEffectIconMigrationIdentityAndRegistration(t *testing.T) {
	if frostGoliathRuntimeEffectCard == "" || rayOfFrostIconSourceCard == "" {
		t.Fatal("runtime effect icon identities must remain exact")
	}
	migrations := GetAllMigrations()
	if migrations[len(migrations)-1].Version != runtimeEffectIconsMigrationVersion {
		t.Fatalf("migration %s must remain the latest migration", runtimeEffectIconsMigrationVersion)
	}
}
