package migrations

import "testing"

func TestConditionLibraryIconSourcesAndRegistration(t *testing.T) {
	for conditionCard, sourceCard := range map[string]string{
		petrifiedConditionCard:  petrifiedIconSourceCard,
		exhaustionConditionCard: exhaustionIconSourceCard,
	} {
		if conditionCard == "" || sourceCard == "" {
			t.Fatalf("condition icon identity must be exact: condition=%q source=%q", conditionCard, sourceCard)
		}
	}

	migrations := GetAllMigrations()
	if migrations[len(migrations)-3].Version != conditionLibraryIconsMigrationVersion {
		t.Fatalf("migration %s must remain immediately before runtime effect materialization", conditionLibraryIconsMigrationVersion)
	}
	if migrations[len(migrations)-2].Version != miniMVPRuntimeEffectsMigrationVersion {
		t.Fatalf("migration %s must remain immediately before runtime icon completion", miniMVPRuntimeEffectsMigrationVersion)
	}
}
