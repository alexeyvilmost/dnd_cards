package migrations

import "testing"

func TestCloudGoliathTeleportMigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != cloudGoliathTeleportMigrationVersion {
		t.Fatalf("last migration is %s, want %s", last.Version, cloudGoliathTeleportMigrationVersion)
	}
	if migrations[len(migrations)-2].Version != woodElfSpeedMigrationVersion {
		t.Fatal("migration 132 must immediately follow 131")
	}
}

func TestRepairCloudGoliathTeleportIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE actions (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO actions (id, card_number, mechanics, support) VALUES ($1::uuid, $2, '{
		  "activation":{"mode":"active"},
		  "effects":[{"resolution":"auto","result":[
		    {"kind":"movement","mode":"teleport","distance":30}
		  ]}]
		}'::jsonb, '{"status":"verified_partial"}'::jsonb)
	`, cloudGoliathActionID, cloudGoliathActionCard); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairCloudGoliathTeleport(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var mode, distance string
	var legacyModeIsNull, supportIsNull bool
	if err := db.QueryRow(`
		SELECT mechanics #>> '{effects,0,result,0,value}',
		       mechanics #>> '{effects,0,result,0,distance}',
		       mechanics #> '{effects,0,result,0,mode}' IS NULL,
		       support IS NULL
		FROM actions WHERE id=$1::uuid AND card_number=$2
	`, cloudGoliathActionID, cloudGoliathActionCard).Scan(
		&mode, &distance, &legacyModeIsNull, &supportIsNull,
	); err != nil {
		t.Fatal(err)
	}
	if mode != "teleport" || distance != "30" || !legacyModeIsNull || !supportIsNull {
		t.Fatalf("unexpected postimage: mode=%q distance=%q legacyModeIsNull=%t supportIsNull=%t",
			mode, distance, legacyModeIsNull, supportIsNull)
	}
}
