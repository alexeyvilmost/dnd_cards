package migrations

import "testing"

func TestMageHandControlMigrationFollowsSpearRepair(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != mageHandControlMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("122 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != spearWeaponProfileMigrationVersion {
			t.Fatal("migration 122 must immediately follow 121")
		}
		return
	}
	t.Fatal("migration 122 is not registered")
}

func TestRepairMageHandControlNarrativeIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE spells (
			id UUID PRIMARY KEY,
			card_number TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			mechanics JSONB NOT NULL,
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			deleted_at TIMESTAMPTZ
		);
		CREATE OR REPLACE FUNCTION protect_certified_content_mechanics()
		RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
		CREATE TRIGGER protect_spells_certified_mechanics
		BEFORE UPDATE OR DELETE ON spells
		FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, name, mechanics, support)
		VALUES ($1::uuid, $2, 'Волшебная рука', jsonb_build_object(
		  'effects', jsonb_build_array(jsonb_build_object(
		    'resolution', 'auto',
		    'result', jsonb_build_array(
		      jsonb_build_object('kind', 'remote_manipulator', 'max_distance_ft', 30),
		      jsonb_build_object('kind', 'narrative', 'description', $3::text)
		    )
		  ))
		), '{"status":"verified_mechanical","mechanics_locked":true}'::jsonb)
	`, mageHandEntityID, mageHandCardNumber, mageHandControlOldNarrative); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairMageHandControlNarrative(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var narrative, status string
	var locked bool
	if err := db.QueryRow(`
		SELECT mechanics #>> '{effects,0,result,1,description}',
		       support->>'status', (support->>'mechanics_locked')::boolean
		FROM spells WHERE card_number = $1
	`, mageHandCardNumber).Scan(&narrative, &status, &locked); err != nil {
		t.Fatal(err)
	}
	if narrative != mageHandControlNewNarrative || status != "untested" || locked {
		t.Fatalf("unexpected postimage: narrative=%q status=%q locked=%t", narrative, status, locked)
	}
}
