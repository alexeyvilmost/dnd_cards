package migrations

import "testing"

func TestTrueStrikeZeroDamageMigrationFollowsTrueStrikeRepair(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, trueStrikeZeroDamageMigrationVersion)
	if index == 0 || migrations[index-1].Version != trueStrikeCantripMigrationVersion {
		t.Fatal("migration 135 must immediately follow 134")
	}
	if index != len(migrations)-1 {
		t.Fatal("migration 135 must remain the latest migration")
	}
}

func TestSuppressTrueStrikeZeroDamageIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE actions (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	encoded := mustJSON(t, canonicalTrueStrikeMechanics())
	if _, err := db.Exec(`INSERT INTO spells (id, card_number, mechanics) VALUES ($1::uuid,$2,$3::jsonb)`, trueStrikeSpellID, trueStrikeCardNumber, encoded); err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		if err := suppressTrueStrikeZeroDamage(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var ordinaryOmit, ordinarySuppress, radiantOmit, radiantSuppress bool
	if err := db.QueryRow(`
		SELECT (mechanics #>> '{effects,0,on_hit,0,options,items,0,grants,1,omit_if_zero}')::bool,
		       (mechanics #>> '{effects,0,on_hit,0,options,items,0,grants,1,suppress_damage_modifiers}')::bool,
		       (mechanics #>> '{effects,0,on_hit,0,options,items,1,grants,1,omit_if_zero}')::bool,
		       (mechanics #>> '{effects,0,on_hit,0,options,items,1,grants,1,suppress_damage_modifiers}')::bool
		FROM spells WHERE id=$1::uuid AND card_number=$2
	`, trueStrikeSpellID, trueStrikeCardNumber).Scan(&ordinaryOmit, &ordinarySuppress, &radiantOmit, &radiantSuppress); err != nil {
		t.Fatal(err)
	}
	if !ordinaryOmit || !ordinarySuppress || !radiantOmit || !radiantSuppress {
		t.Fatalf("True Strike scaling flags = (%t,%t,%t,%t)", ordinaryOmit, ordinarySuppress, radiantOmit, radiantSuppress)
	}
}
