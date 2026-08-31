package migrations

import "testing"

func TestLevelOneMonkRuntimeContractsMigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != levelOneMonkRuntimeContractsMigrationVersion {
		t.Fatalf("last migration is %s, want %s", last.Version, levelOneMonkRuntimeContractsMigrationVersion)
	}
	if migrations[len(migrations)-2].Version != levelOneSpeciesRuntimeContractsMigrationVersion {
		t.Fatal("migration 129 must immediately follow 128")
	}
}

func TestRepairLevelOneMonkRuntimeContractsIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE classes (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, resources JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, name TEXT, description TEXT, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE actions (
			id UUID PRIMARY KEY, name TEXT, name_en TEXT, description TEXT, image_url TEXT,
			rarity TEXT, card_number TEXT UNIQUE NOT NULL, action_type TEXT, type TEXT,
			resource TEXT, mechanics JSONB, author TEXT, source TEXT, support JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ
		)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO classes (id, card_number, resources) VALUES
		($1::uuid, $2, '{"focus":{"count":"self_level","per":"short_rest"}}'::jsonb);
		INSERT INTO effects (id, name, description, card_number, mechanics) VALUES
		($3::uuid, 'Боевые искусства', 'legacy', $4,
		 '{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"legacy"}]}]}'::jsonb)
	`, monkClassID, monkClassCard, martialArtsEffectID, martialArtsEffectCard); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairLevelOneMonkRuntimeContracts(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var focusAtOne *string
	var focusAtTwo, die, abilities string
	if err := db.QueryRow(`
		SELECT resources #>> '{focus,by_level,1}', resources #>> '{focus,by_level,2}'
		FROM classes WHERE id=$1::uuid AND card_number=$2
	`, monkClassID, monkClassCard).Scan(&focusAtOne, &focusAtTwo); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT mechanics #>> '{effects,0,result,0,dice}',
		       mechanics #>> '{effects,0,result,0,ability_options}'
		FROM effects WHERE id=$1::uuid AND card_number=$2
	`, martialArtsEffectID, martialArtsEffectCard).Scan(&die, &abilities); err != nil {
		t.Fatal(err)
	}
	if focusAtOne != nil || focusAtTwo != "2" || die != "martial_arts_die" || abilities != `["str", "dex"]` {
		t.Fatalf("unexpected postimage focus1=%v focus2=%q die=%q abilities=%q", focusAtOne, focusAtTwo, die, abilities)
	}

	var actionCount int
	if err := db.QueryRow(`
		SELECT count(*) FROM actions
		WHERE (id=$1::uuid AND card_number=$2 AND mechanics #>> '{activation,trigger,event}'='hit')
		   OR (id=$3::uuid AND card_number=$4 AND mechanics #>> '{activation,trigger,event}'='miss')
	`, martialArtsHitActionID, martialArtsHitActionCard,
		martialArtsMissActionID, martialArtsMissActionCard).Scan(&actionCount); err != nil {
		t.Fatal(err)
	}
	if actionCount != 2 {
		t.Fatalf("expected two exact Martial Arts follow-up actions, got %d", actionCount)
	}
}
