package migrations

import (
	"encoding/json"
	"testing"
)

func TestMagicInitiate2024RepairIsRegisteredAfterCurrentHead(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != "098_repair_magic_initiate_2024" {
			continue
		}
		if index == 0 || migrations[index-1].Version != "097_repair_micro_mvp_rules_release_identity" {
			t.Fatalf("098 predecessor = %q", migrations[index-1].Version)
		}
		return
	}
	t.Fatal("098_repair_magic_initiate_2024 is not registered")
}

func TestMagicInitiate2024RepairDeclaresGeneric2024Contract(t *testing.T) {
	document, err := parseMagicInitiate2024Repair()
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"magic_initiate_cleric": "жрец",
		"EFFECT-0006":           "друид",
	}
	for _, variant := range document.Variants {
		if want[variant.Effect.CardNumber] != variant.SpellList {
			t.Fatalf("%s spell list = %q", variant.Effect.CardNumber, variant.SpellList)
		}
		delete(want, variant.Effect.CardNumber)

		var mechanics struct {
			Activation struct {
				Mode string `json:"mode"`
			} `json:"activation"`
			Effects []map[string]any `json:"effects"`
		}
		if err := json.Unmarshal(variant.Mechanics, &mechanics); err != nil {
			t.Fatalf("decode %s target: %v", variant.Effect.CardNumber, err)
		}
		if mechanics.Activation.Mode != "passive" || len(mechanics.Effects) != 3 {
			t.Fatalf("%s must have one passive three-choice contract", variant.Effect.CardNumber)
		}

		ability := mechanics.Effects[0]
		if ability["kind"] != "choice" || ability["resolution"] != "on_acquire" {
			t.Fatalf("%s spellcasting ability is not a creation choice", variant.Effect.CardNumber)
		}
		abilityGrant := ability["grant"].(map[string]any)
		if abilityGrant["kind"] != "spellcasting_ability" {
			t.Fatalf("%s ability choice grant = %v", variant.Effect.CardNumber, abilityGrant)
		}
		items := ability["options"].(map[string]any)["items"].([]any)
		if len(items) != 3 {
			t.Fatalf("%s ability options = %d", variant.Effect.CardNumber, len(items))
		}

		levelOne := mechanics.Effects[2]
		grant := levelOne["grant"].(map[string]any)
		freeuse := grant["freeuse"].(map[string]any)
		if grant["kind"] != "grant_spell" || grant["label"] != "always_prepared" ||
			freeuse["count"] != float64(1) || freeuse["recharge"] != "long_rest" {
			t.Fatalf("%s level-one grant = %v", variant.Effect.CardNumber, grant)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing Magic Initiate variants: %v", want)
	}
}

func TestMagicInitiate2024RepairExecutesIdempotentlyAndFailsClosed(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "TEST_DATABASE_URL")
	document, err := parseMagicInitiate2024Repair()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`
		CREATE TABLE feats (
			id uuid PRIMARY KEY,
			card_number text NOT NULL,
			related_effects jsonb,
			deleted_at timestamptz
		);
		CREATE TABLE effects (
			id uuid PRIMARY KEY,
			card_number text NOT NULL,
			mechanics jsonb NOT NULL,
			updated_at timestamptz,
			deleted_at timestamptz
		);
	`); err != nil {
		t.Fatal(err)
	}
	for _, variant := range document.Variants {
		links, _ := json.Marshal([]string{variant.Effect.ID})
		if _, err = db.Exec(`INSERT INTO feats (id, card_number, related_effects) VALUES ($1, $2, $3::jsonb)`,
			variant.Feat.ID, variant.Feat.CardNumber, string(links)); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO effects (id, card_number, mechanics) VALUES ($1, $2, $3::jsonb)`,
			variant.Effect.ID, variant.Effect.CardNumber, string(variant.ExpectedBeforeMechanics)); err != nil {
			t.Fatal(err)
		}
	}

	if err = repairMagicInitiate2024(db); err != nil {
		t.Fatal(err)
	}
	if err = repairMagicInitiate2024(db); err != nil {
		t.Fatalf("idempotent repair: %v", err)
	}
	for _, variant := range document.Variants {
		var equal bool
		if err = db.QueryRow(`SELECT mechanics = $2::jsonb FROM effects WHERE id = $1`,
			variant.Effect.ID, string(variant.Mechanics)).Scan(&equal); err != nil || !equal {
			t.Fatalf("%s target was not persisted: equal=%v err=%v", variant.Effect.CardNumber, equal, err)
		}
	}

	first := document.Variants[0]
	second := document.Variants[1]
	if _, err = db.Exec(`UPDATE effects SET mechanics = $2::jsonb WHERE id = $1`,
		first.Effect.ID, string(first.ExpectedBeforeMechanics)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE effects SET mechanics = '{"unexpected":true}'::jsonb WHERE id = $1`, second.Effect.ID); err != nil {
		t.Fatal(err)
	}
	if err = repairMagicInitiate2024(db); err == nil {
		t.Fatal("expected drifted second variant to reject the transaction")
	}
	var firstStillPreimage bool
	if err = db.QueryRow(`SELECT mechanics = $2::jsonb FROM effects WHERE id = $1`,
		first.Effect.ID, string(first.ExpectedBeforeMechanics)).Scan(&firstStillPreimage); err != nil {
		t.Fatal(err)
	}
	if !firstStillPreimage {
		t.Fatal("first variant update was not rolled back after second-variant drift")
	}
}
