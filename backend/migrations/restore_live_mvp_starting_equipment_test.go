package migrations

import "testing"

func TestRestoreLiveMvpStartingEquipmentMigrationIsRegisteredAfter097(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "098_restore_live_mvp_starting_equipment" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("098 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("098_restore_live_mvp_starting_equipment is not registered")
	}
	if previous := migrations[index-1].Version; previous != "097_repair_live_mvp_content_contracts" {
		t.Fatalf("migration before 098 = %q, want 097", previous)
	}
}

func TestRestoreLiveMvpStartingEquipmentIsScopedAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE cards (
			id UUID PRIMARY KEY,
			card_number TEXT NOT NULL UNIQUE,
			deleted_at TIMESTAMPTZ
		);
		CREATE TABLE classes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT NOT NULL UNIQUE,
			equipment_options JSONB,
			deleted_at TIMESTAMPTZ
		);
		INSERT INTO cards (id, card_number, deleted_at) VALUES
			('0e678d76-70ba-4036-b55b-60532f18e2e8', 'CARD-0275', now()),
			('40f34fed-b99a-47e5-8dc0-a07a809ac1c2', 'CARD-0276', now());
		INSERT INTO classes (card_number, equipment_options) VALUES
			('CLASS-rogue', '{"option_a":{"items":[{"card_id":"0e678d76-70ba-4036-b55b-60532f18e2e8","quantity":1}]}}');
	`); err != nil {
		t.Fatal(err)
	}

	if err := restoreLiveMvpStartingEquipment(db); err != nil {
		t.Fatal(err)
	}
	if err := restoreLiveMvpStartingEquipment(db); err != nil {
		t.Fatalf("098 is not idempotent: %v", err)
	}

	var restored, unrelated bool
	if err := db.QueryRow(`
		SELECT deleted_at IS NULL FROM cards WHERE card_number = 'CARD-0275'
	`).Scan(&restored); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT deleted_at IS NULL FROM cards WHERE card_number = 'CARD-0276'
	`).Scan(&unrelated); err != nil {
		t.Fatal(err)
	}
	if !restored || unrelated {
		t.Fatalf("restored referenced=%v unrelated=%v, want true/false", restored, unrelated)
	}
}
