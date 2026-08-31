package migrations

import (
	"encoding/json"
	"testing"
)

func TestCanonicalMissingWeaponMasteryProfilesDeclareCleaveAndPush(t *testing.T) {
	repairs := canonicalMissingWeaponMasteryProfiles()
	if len(repairs) != 2 {
		t.Fatalf("got %d repairs, want 2", len(repairs))
	}
	wantMasteries := map[string]string{
		"CARD-0312": "3ad18858-a1a9-44fc-a412-4748d8daaeaa",
		"CARD-0566": "82ec5a23-18f9-4c68-9119-470c1ef120d9",
	}
	for _, repair := range repairs {
		if repair.Profile["mastery_effect_id"] != wantMasteries[repair.CardNumber] {
			t.Fatalf("%s mastery mismatch: %#v", repair.CardNumber, repair.Profile)
		}
		if _, err := json.Marshal(repair.Profile); err != nil {
			t.Fatalf("%s profile is not JSON serializable: %v", repair.CardNumber, err)
		}
	}
	if _, ok := repairs[0].Profile["heavy"]; !ok {
		t.Fatal("greataxe must declare the heavy-weapon ability requirement")
	}
}

func TestMissingWeaponMasteryProfilesMigrationIsRegisteredBeforeLevelOneSpeciesRepairs(t *testing.T) {
	migrations := GetAllMigrations()
	registered := migrations[len(migrations)-2]
	if registered.Version != missingWeaponMasteryProfilesMigrationVersion {
		t.Fatalf("penultimate migration is %s, want %s", registered.Version, missingWeaponMasteryProfilesMigrationVersion)
	}
	if registered.Up == nil || registered.Down == nil {
		t.Fatal("127 must register Up and a safe Down")
	}
	if migrations[len(migrations)-3].Version != crafterInPlayChoiceMigrationVersion {
		t.Fatal("migration 127 must immediately follow 126")
	}
}

func TestRepairMissingWeaponMasteryProfilesIsExactAndIdempotent(t *testing.T) {
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
	for _, repair := range canonicalMissingWeaponMasteryProfiles() {
		if _, err := db.Exec(`
			INSERT INTO cards (id, card_number, name, mechanics)
			VALUES ($1::uuid, $2, $2, NULL)
		`, repair.EntityID, repair.CardNumber); err != nil {
			t.Fatal(err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := repairMissingWeaponMasteryProfiles(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	for _, repair := range canonicalMissingWeaponMasteryProfiles() {
		profile, err := json.Marshal(repair.Profile)
		if err != nil {
			t.Fatal(err)
		}
		var canonical bool
		if err := db.QueryRow(`
			SELECT mechanics->'weapon_profile' = $2::jsonb
			FROM cards WHERE card_number = $1
		`, repair.CardNumber, profile).Scan(&canonical); err != nil {
			t.Fatal(err)
		}
		if !canonical {
			t.Fatalf("%s did not reach the exact canonical postcondition", repair.CardNumber)
		}
	}
}
