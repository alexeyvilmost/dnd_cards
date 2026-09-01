package migrations

import (
	"fmt"
	"testing"
)

func TestBarbarianRageStackingMigrationFollowsMonkRepairs(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, barbarianRageStackingMigrationVersion)
	if index == 0 || migrations[index-1].Version != levelOneMonkRuntimeContractsMigrationVersion {
		t.Fatal("migration 130 must immediately follow 129")
	}
}

func TestRepairBarbarianRageStackingIsExactAndIdempotent(t *testing.T) {
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
		INSERT INTO actions (id, card_number, mechanics) VALUES ($1::uuid, $2, '{
		  "activation":{"mode":"active"},
		  "effects":[{"resolution":"auto","result":[
		    {"kind":"narrative"},
		    {"kind":"modifier"},
		    {"kind":"resistance","damage_type":"bludgeoning"},
		    {"kind":"resistance","damage_type":"piercing"},
		    {"kind":"resistance","damage_type":"slashing"},
		    {"kind":"modifier","applies_to":{"roll":"ability_check"}},
		    {"kind":"modifier","applies_to":{"roll":"saving_throw"}}
		  ]}]
		}'::jsonb)
	`, barbarianRageActionID, barbarianRageActionCard); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairBarbarianRageStacking(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	for index, want := range barbarianRageStackIDs {
		var got string
		path := fmt.Sprintf("{effects,0,result,%d,stack_id}", index+1)
		if err := db.QueryRow(`SELECT mechanics #>> $3::text[] FROM actions WHERE id=$1::uuid AND card_number=$2`,
			barbarianRageActionID, barbarianRageActionCard, path).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("payload %d stack id = %q, want %q", index+1, got, want)
		}
	}
}
