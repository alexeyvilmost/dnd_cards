package migrations

import (
	"encoding/json"
	"testing"
)

func TestCanonicalSpearWeaponProfileDeclaresBothModesAndVersatileGrip(t *testing.T) {
	profile := canonicalSpearWeaponProfile()
	if profile["weapon_type"] != "spear" || profile["proficiency_category"] != "simple" {
		t.Fatalf("invalid spear identity: %#v", profile)
	}
	if profile["mastery_effect_id"] != spearMasteryEffectID || profile["ammo"] != nil {
		t.Fatalf("invalid spear mastery/ammo: %#v", profile)
	}
	versatile := profile["versatile_grip"].(map[string]any)
	if versatile["dice"] != "1d8" || versatile["type"] != "piercing" {
		t.Fatalf("invalid versatile grip: %#v", versatile)
	}
	modes := profile["attack_modes"].([]map[string]any)
	if len(modes) != 2 || modes[0]["kind"] != "melee" || modes[1]["kind"] != "ranged" {
		t.Fatalf("invalid spear attack modes: %#v", modes)
	}
	if _, err := json.Marshal(profile); err != nil {
		t.Fatalf("profile is not JSON serializable: %v", err)
	}
}

func TestSpearWeaponProfileMigrationFollowsBardicInspirationRepair(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != spearWeaponProfileMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("121 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != bardicInspirationMigrationVersion {
			t.Fatal("migration 121 must immediately follow 120")
		}
		return
	}
	t.Fatal("migration 121 is not registered")
}

func TestRepairSpearWeaponProfileIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE cards (
			id UUID PRIMARY KEY,
			card_number TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			mechanics JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			deleted_at TIMESTAMPTZ
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO cards (id, card_number, name, mechanics)
		VALUES ($1::uuid, $2, 'Копьё', NULL)
	`, spearWeaponEntityID, spearWeaponCardNumber); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairSpearWeaponProfile(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	profile, err := json.Marshal(canonicalSpearWeaponProfile())
	if err != nil {
		t.Fatal(err)
	}
	var canonical bool
	if err := db.QueryRow(`
		SELECT mechanics->'weapon_profile' = $2::jsonb
		FROM cards WHERE card_number = $1
	`, spearWeaponCardNumber, profile).Scan(&canonical); err != nil {
		t.Fatal(err)
	}
	if !canonical {
		t.Fatal("spear profile did not reach the exact canonical postcondition")
	}
}
