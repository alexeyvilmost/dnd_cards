package migrations

import "testing"

func TestFriendsMindSliverMigrationFollowsCloudGoliathRepair(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, friendsMindSliverCantripMigrationVersion)
	if index == 0 || migrations[index-1].Version != cloudGoliathTeleportMigrationVersion {
		t.Fatal("migration 133 must immediately follow 132")
	}
}

func TestRepairFriendsMindSliverCantripsIsExactAndIdempotent(t *testing.T) {
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
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics) VALUES
		($1::uuid,$2,'{"effects":[{"resolution":"save","on_fail":[{"kind":"condition","value":"charmed"}]}]}'::jsonb),
		($3::uuid,$4,'{"effects":[{"resolution":"save","on_fail":[{"kind":"damage"},{"kind":"narrative"}]}]}'::jsonb)
	`, friendsSpellID, friendsCardNumber, mindSliverSpellID, mindSliverCardNumber); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairFriendsMindSliverCantrips(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var relation, excludedType, modifierKind, consume, duration string
	var sign int
	if err := db.QueryRow(`
		SELECT mechanics #>> '{effects,0,automatic_success,if_target_relation}',
		       mechanics #>> '{effects,0,automatic_success,if_target_creature_type_not}'
		FROM spells WHERE id=$1::uuid AND card_number=$2
	`, friendsSpellID, friendsCardNumber).Scan(&relation, &excludedType); err != nil {
		t.Fatal(err)
	}
	if relation != "enemy" || excludedType != "humanoid" {
		t.Fatalf("Friends auto-success = (%q,%q)", relation, excludedType)
	}
	if err := db.QueryRow(`
		SELECT mechanics #>> '{effects,0,on_fail,1,kind}',
		       mechanics #>> '{effects,0,on_fail,1,consume}',
		       mechanics #>> '{effects,0,on_fail,1,duration,type}',
		       (mechanics #>> '{effects,0,on_fail,1,sign}')::int
		FROM spells WHERE id=$1::uuid AND card_number=$2
	`, mindSliverSpellID, mindSliverCardNumber).Scan(&modifierKind, &consume, &duration, &sign); err != nil {
		t.Fatal(err)
	}
	if modifierKind != "modifier" || consume != "next" || duration != "until_end_of_source_next_turn" || sign != -1 {
		t.Fatalf("Mind Sliver modifier = (%q,%q,%q,%d)", modifierKind, consume, duration, sign)
	}
}
