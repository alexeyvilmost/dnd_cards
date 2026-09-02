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
	if migrations[len(migrations)-1].Version != conditionLibraryIconsMigrationVersion {
		t.Fatalf("migration %s must remain the latest migration", conditionLibraryIconsMigrationVersion)
	}
}
