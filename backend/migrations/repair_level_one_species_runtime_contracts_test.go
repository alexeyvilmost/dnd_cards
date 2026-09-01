package migrations

import "testing"

func TestLevelOneSpeciesRuntimeContractsMigrationIsRegisteredBeforeMonkRepairs(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, levelOneSpeciesRuntimeContractsMigrationVersion)
	registered := migrations[index]
	if registered.Version != levelOneSpeciesRuntimeContractsMigrationVersion {
		t.Fatalf("penultimate migration is %s, want %s", registered.Version, levelOneSpeciesRuntimeContractsMigrationVersion)
	}
	if index == 0 || migrations[index-1].Version != missingWeaponMasteryProfilesMigrationVersion {
		t.Fatal("migration 128 must immediately follow 127")
	}
	if index+1 >= len(migrations) || migrations[index+1].Version != levelOneMonkRuntimeContractsMigrationVersion {
		t.Fatal("migration 129 must immediately follow 128")
	}
}

func TestRepairLevelOneSpeciesRuntimeContractsIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE effects (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE actions (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO effects (id, card_number, mechanics) VALUES ($1::uuid, $2,
		'{"effects":[{"result":[{"kind":"grant_spell","value":"minor_illusion"},{"kind":"grant_spell","value":"SPELL-0277","freeuse":{"count":"prof_bonus","recharge":"long_rest"}}]}]}'::jsonb);
		INSERT INTO actions (id, card_number, mechanics) VALUES ($3::uuid, $4,
		'{"effects":[{"result":[{"kind":"healing","amount":"prof d4"}]}]}'::jsonb)
	`, forestGnomeEffectID, forestGnomeCard, healingHandsID, healingHandsCard); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairLevelOneSpeciesRuntimeContracts(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var label, amount string
	if err := db.QueryRow(`SELECT mechanics #>> '{effects,0,result,1,label}' FROM effects WHERE card_number=$1`, forestGnomeCard).Scan(&label); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics #>> '{effects,0,result,0,amount}' FROM actions WHERE card_number=$1`, healingHandsCard).Scan(&amount); err != nil {
		t.Fatal(err)
	}
	if label != "always_prepared" || amount != "prof_bonus d4" {
		t.Fatalf("unexpected postimage label=%q amount=%q", label, amount)
	}
}
