package migrations

import "testing"

func TestTrueStrikeMigrationFollowsFriendsMindSliverRepair(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, trueStrikeCantripMigrationVersion)
	if index == 0 || migrations[index-1].Version != friendsMindSliverCantripMigrationVersion {
		t.Fatal("migration 134 must immediately follow 133")
	}
	if index != len(migrations)-1 {
		t.Fatal("migration 134 must remain the latest migration")
	}
}

func TestRepairTrueStrikeCantripIsExactAndIdempotent(t *testing.T) {
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
	if _, err := db.Exec(`INSERT INTO spells (id, card_number, mechanics) VALUES ($1::uuid,$2,'{"targeting":{"shape":"self"}}'::jsonb)`, trueStrikeSpellID, trueStrikeCardNumber); err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		if err := repairTrueStrikeCantrip(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var shape, relation, ability, radiantType, status string
	var rangeFt int
	if err := db.QueryRow(`
		SELECT mechanics #>> '{targeting,shape}',
		       mechanics #>> '{targeting,allowed_relations,0}',
		       (mechanics #>> '{targeting,range_ft}')::int,
		       mechanics #>> '{effects,0,ability}',
		       mechanics #>> '{effects,0,on_hit,0,options,items,1,grants,0,type}',
		       support #>> '{status}'
		FROM spells WHERE id=$1::uuid AND card_number=$2
	`, trueStrikeSpellID, trueStrikeCardNumber).Scan(&shape, &relation, &rangeFt, &ability, &radiantType, &status); err != nil {
		t.Fatal(err)
	}
	if shape != "single" || relation != "enemy" || rangeFt != 600 || ability != "spellcasting" || radiantType != "radiant" || status != "untested" {
		t.Fatalf("True Strike contract = (%q,%q,%d,%q,%q,%q)", shape, relation, rangeFt, ability, radiantType, status)
	}
}
