package migrations

import "testing"

func TestMiniMVPSpellTriggerTimingMigrationFollowsClarityRepair(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, miniMVPSpellTriggerTimingMigrationVersion)
	if index == 0 || migrations[index-1].Version != miniMVPSpellClarityMigrationVersion {
		t.Fatal("migration 137 must immediately follow 136")
	}
	if index != len(migrations)-1 {
		t.Fatal("migration 137 must remain the latest migration")
	}
}

func TestRepairMiniMVPSpellTriggerTimingIsExactAndIdempotent(t *testing.T) {
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
	base := `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"}]},"effects":[]}`
	for _, identity := range miniMVPSpellTriggerTimingIdentities {
		if _, err := db.Exec(`INSERT INTO spells (id,card_number,mechanics) VALUES ($1::uuid,$2,$3::jsonb)`, identity.id, identity.card, base); err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		if err := repairMiniMVPSpellTriggerTiming(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}
	for _, row := range []struct{ card, mode, event string }{
		{"hellish_rebuke", "reaction", "damage_taken"},
		{"SPELL-0183", "triggered", "hit"},
		{"SPELL-0185", "triggered", "hit"},
		{"SPELL-0186", "triggered", "hit"},
		{"SPELL-0247", "triggered", "hit"},
		{"SPELL-0253", "reaction", "fall_started"},
		{"SPELL-0254", "triggered", "hit"},
	} {
		var mode, event string
		if err := db.QueryRow(`SELECT mechanics #>> '{activation,mode}', mechanics #>> '{activation,trigger,event}' FROM spells WHERE card_number=$1`, row.card).Scan(&mode, &event); err != nil {
			t.Fatal(err)
		}
		if mode != row.mode || event != row.event {
			t.Fatalf("%s timing = %s/%s, want %s/%s", row.card, mode, event, row.mode, row.event)
		}
	}
}
