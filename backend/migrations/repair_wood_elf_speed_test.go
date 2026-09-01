package migrations

import "testing"

func registeredMigrationIndex(t *testing.T, version string) int {
	t.Helper()
	for index, migration := range GetAllMigrations() {
		if migration.Version == version {
			return index
		}
	}
	t.Fatalf("migration %s is not registered", version)
	return -1
}

func TestWoodElfSpeedMigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != woodElfSpeedMigrationVersion {
		t.Fatalf("last migration is %s, want %s", last.Version, woodElfSpeedMigrationVersion)
	}
	if migrations[len(migrations)-2].Version != barbarianRageStackingMigrationVersion {
		t.Fatal("migration 131 must immediately follow 130")
	}
}

func TestRepairWoodElfSpeedIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE actions (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO effects (id, card_number, mechanics, support) VALUES ($1::uuid, $2, '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[
		    {"kind":"grant_speed","mode":"walk","value":"35"},
		    {"kind":"grant_spell","value":"druidcraft","level_gate":1}
		  ]}]
		}'::jsonb, '{"status":"verified_partial"}'::jsonb)
	`, woodElfEffectID, woodElfEffectCard); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairWoodElfSpeed(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var speed, spell string
	var supportIsNull bool
	if err := db.QueryRow(`
		SELECT mechanics #>> '{effects,0,result,0,value}',
		       mechanics #>> '{effects,0,result,1,value}',
		       support IS NULL
		FROM effects WHERE id=$1::uuid AND card_number=$2
	`, woodElfEffectID, woodElfEffectCard).Scan(&speed, &spell, &supportIsNull); err != nil {
		t.Fatal(err)
	}
	if speed != "5" || spell != "druidcraft" || !supportIsNull {
		t.Fatalf("unexpected postimage: speed=%q spell=%q supportIsNull=%t", speed, spell, supportIsNull)
	}
}

func TestRepairWoodElfSpeedFailsClosedOnIdentityDrift(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE actions (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO effects (id, card_number, mechanics) VALUES
		('13100000-0000-4000-8000-000000000001', $1, '{"effects":[]}'::jsonb)`, woodElfEffectCard); err != nil {
		t.Fatal(err)
	}
	if err := repairWoodElfSpeed(db); err == nil {
		t.Fatal("identity drift unexpectedly succeeded")
	}
}
