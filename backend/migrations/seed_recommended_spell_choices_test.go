package migrations

import (
	"os"
	"path/filepath"
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
	// Use checked-in public source data, not whatever happens to be in the
	// database's public schema. Real choice declarations are independent of the
	// recommendation implementation; no generated mirror of its option counts.
	if _, err := db.Exec(`CREATE TABLE effects(id uuid PRIMARY KEY,card_number text,mechanics jsonb,support jsonb,deleted_at timestamptz);
CREATE TABLE spells(id uuid PRIMARY KEY,card_number text,deleted_at timestamptz);
CREATE TABLE content_choice_recommendations(entity_type text,entity_reference text,choice_id text,recommended_options jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(entity_type,entity_reference,choice_id));`); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"effects", "spells"} {
		data, err := os.ReadFile(filepath.Join("..", "..", "officials", "canon", "prod-snapshot", table+".json"))
		if err != nil {
			t.Fatal(err)
		}
		fields := "id uuid,card_number text,deleted_at timestamptz"
		columns := "id,card_number,deleted_at"
		if table == "effects" {
			fields += ",mechanics jsonb,support jsonb"
			columns += ",mechanics,support"
		}
		if _, err = db.Exec("INSERT INTO "+table+"("+columns+") SELECT "+columns+" FROM jsonb_to_recordset($1::jsonb) AS source("+fields+")", string(data)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE original_effects AS TABLE effects`); err != nil {
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
	if err := db.QueryRow(`SELECT count(*) FROM effects copy FULL JOIN original_effects original USING(id) WHERE copy.id IS NULL OR original.id IS NULL OR to_jsonb(copy) IS DISTINCT FROM to_jsonb(original)`).Scan(&count); err != nil || count != 0 {
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
