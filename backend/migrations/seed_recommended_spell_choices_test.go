package migrations

import (
	"testing"
)

func TestRecommendedSpellChoicesMatchDeclaredCounts(t *testing.T) {
	if len(recommendedSpellChoices) < 10 {
		t.Fatalf("recommended spell seeds = %d, want at least paladin+other casters", len(recommendedSpellChoices))
	}
	seen := map[string]bool{}
	for _, seed := range recommendedSpellChoices {
		key := seed.EntityReference + ":" + seed.ChoiceID
		if seen[key] {
			t.Fatalf("duplicate seed %s", key)
		}
		seen[key] = true
		if seed.EntityType != "effect" {
			t.Fatalf("%s: entity type %q", key, seed.EntityType)
		}
		if _, err := normalizedRecommendedOptions(seed.Options); err != nil {
			t.Fatalf("%s: %v", key, err)
		}
	}
	if !seen["EFF-paladin-spellcasting:paladin_spells_l1"] {
		t.Fatal("missing paladin spell recommendations")
	}
}

func TestRecommendedSpellChoicesValidateOnSnapshotWithoutChangingMechanics(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ROGUELIKE_MIGRATION_TEST_DSN")
	// Copy only the required columns into a disposable schema. The source
	// snapshot is read-only; this exercises real choice domains and spell IDs.
	if _, err := db.Exec(`CREATE TABLE effects AS SELECT id,card_number,mechanics,support,deleted_at FROM public.effects;
CREATE TABLE spells AS SELECT id,card_number,deleted_at FROM public.spells;
CREATE TABLE content_choice_recommendations(entity_type text,entity_reference text,choice_id text,recommended_options jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(entity_type,entity_reference,choice_id));`); err != nil {
		t.Fatal(err)
	}
	if err := seedRecommendedSpellChoices(db); err != nil {
		t.Fatal(err)
	}
	if err := seedRecommendedSpellChoices(db); err != nil {
		t.Fatalf("repeat seed: %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM content_choice_recommendations`).Scan(&count); err != nil || count != len(recommendedSpellChoices) {
		t.Fatalf("recommendation count = %d: %v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM effects copy JOIN public.effects original USING(id) WHERE copy.mechanics IS DISTINCT FROM original.mechanics OR copy.support IS DISTINCT FROM original.support`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("recommendation migration changed mechanics or review: %d %v", count, err)
	}
}

func TestRecommendedSpellChoicesRejectChangedChoiceContracts(t *testing.T) {
	for _, mechanics := range []string{
		`{"choices":[{"id":"known","count":2,"options":{"source":"feat"}}]}`,
		`{"choices":[{"id":"known","count":1,"options":{"source":"spell"}}]}`,
		`{"choices":[{"id":"different","count":2,"options":{"source":"spell"}}]}`,
	} {
		if validateEffectSpellRecommendation([]byte(mechanics), "known", []string{"one", "two"}) == nil {
			t.Fatalf("changed choice accepted: %s", mechanics)
		}
	}
}
