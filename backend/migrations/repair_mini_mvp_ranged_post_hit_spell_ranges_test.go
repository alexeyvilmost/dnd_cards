package migrations

import "testing"

func TestMiniMVPRangedPostHitSpellRangesMigrationFollowsTargetRepair(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, miniMVPRangedPostHitSpellRangesMigrationVersion)
	if index == 0 || migrations[index-1].Version != miniMVPPostHitSpellTargetsMigrationVersion {
		t.Fatal("migration 139 must immediately follow 138")
	}
	if index+1 >= len(migrations) || migrations[index+1].Version != runtimeBoonsAreaMigrationVersion {
		t.Fatal("migration 140 must immediately follow 139")
	}
}

func TestRepairMiniMVPRangedPostHitSpellRangesIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE spells (
			id uuid PRIMARY KEY, card_number text NOT NULL, mechanics jsonb NOT NULL,
			support jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)
	`); err != nil {
		t.Fatal(err)
	}
	base := `{"activation":{"mode":"triggered","trigger":{"event":"hit"}},"targeting":{"filter":"enemy","shape":"single"},"effects":[]}`
	for _, identity := range miniMVPRangedPostHitSpellRangeIdentities {
		if _, err := db.Exec(`INSERT INTO spells (id,card_number,mechanics) VALUES ($1::uuid,$2,$3::jsonb)`, identity.id, identity.card, base); err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		if err := repairMiniMVPRangedPostHitSpellRanges(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}
	for _, identity := range miniMVPRangedPostHitSpellRangeIdentities {
		var got, status string
		if err := db.QueryRow(`SELECT mechanics #>> '{targeting,range}', support->>'status' FROM spells WHERE card_number=$1`, identity.card).Scan(&got, &status); err != nil {
			t.Fatal(err)
		}
		if got != "600 feet" || status != "untested" {
			t.Fatalf("%s range/support = %q/%q, want 600 feet/untested", identity.card, got, status)
		}
	}
}
