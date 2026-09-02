package migrations

import "testing"

func TestRuntimeEffectIconMigrationIdentityAndRegistration(t *testing.T) {
	if frostGoliathRuntimeEffectCard == "" || rayOfFrostIconSourceCard == "" {
		t.Fatal("runtime effect icon identities must remain exact")
	}
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, runtimeEffectIconsMigrationVersion)
	if index == 0 || migrations[index-1].Version != miniMVPRuntimeEffectsMigrationVersion {
		t.Fatalf("migration %s must remain immediately after runtime effect materialization", runtimeEffectIconsMigrationVersion)
	}
}
