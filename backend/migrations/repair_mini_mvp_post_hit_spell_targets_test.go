package migrations

import "testing"

func TestMiniMVPPostHitSpellTargetsMigrationFollowsTriggerTimingRepair(t *testing.T) {
	if miniMVPPostHitSpellTargetsMigrationVersion <= miniMVPSpellTriggerTimingMigrationVersion {
		t.Fatalf("post-hit target repair %q must follow trigger repair %q", miniMVPPostHitSpellTargetsMigrationVersion, miniMVPSpellTriggerTimingMigrationVersion)
	}
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, miniMVPPostHitSpellTargetsMigrationVersion)
	if index == 0 || migrations[index-1].Version != miniMVPSpellTriggerTimingMigrationVersion {
		t.Fatal("migration 138 must immediately follow 137")
	}
	if index != len(migrations)-1 {
		t.Fatal("migration 138 must remain the latest migration")
	}
}

func TestRepairMiniMVPPostHitSpellTargetsIsExactAndIdempotent(t *testing.T) {
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
	base := `{"activation":{"mode":"triggered","trigger":{"event":"hit"}},"targeting":{"shape":"self"},"effects":[]}`
	for _, identity := range miniMVPPostHitSpellTargetIdentities {
		if _, err := db.Exec(`INSERT INTO spells (id,card_number,mechanics) VALUES ($1::uuid,$2,$3::jsonb)`, identity.id, identity.card, base); err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		if err := repairMiniMVPPostHitSpellTargets(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}
	for _, identity := range miniMVPPostHitSpellTargetIdentities {
		var shape, filter, status string
		if err := db.QueryRow(`SELECT mechanics #>> '{targeting,shape}', mechanics #>> '{targeting,filter}', support->>'status' FROM spells WHERE card_number=$1`, identity.card).Scan(&shape, &filter, &status); err != nil {
			t.Fatal(err)
		}
		if shape != "single" || filter != "enemy" || status != "untested" {
			t.Fatalf("%s target/support = %s/%s/%s, want single/enemy/untested", identity.card, shape, filter, status)
		}
	}
}
