package migrations

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestWizardCantripGrowthRepairVersion(t *testing.T) {
	if wizardCantripGrowthRepairVersion != "176_repair_wizard_cantrip_growth" {
		t.Fatal(wizardCantripGrowthRepairVersion)
	}
}

func TestWizardCantripGrowthPostgresClone(t *testing.T) {
	dsn := os.Getenv("WIZARD_CANTRIP_GROWTH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set WIZARD_CANTRIP_GROWTH_TEST_DATABASE_URL for clone integration")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairWizardCantripGrowth(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var rows int
	err = db.QueryRow(`SELECT count(*) FROM effects
		WHERE card_number='EFFECT-0258' AND deleted_at IS NULL
		AND mechanics#>>'{effects,0,id}'='wizard_spellbook_level_1'
		AND mechanics#>>'{effects,0,grant,label}'='cantrip'
		AND mechanics#>>'{effects,0,prompt}'='Выберите 1 заговор'
		AND support->>'status'='untested'
		AND support->>'certification_version'=$1`, wizardCantripGrowthRepairVersion).Scan(&rows)
	if err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("repaired Wizard cantrip growth rows=%d, want 1", rows)
	}
}
