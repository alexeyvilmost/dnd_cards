package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestD20InterruptDeclarations(t *testing.T) {
	if d20InterruptsMigrationVersion != "184_materialize_d20_interrupts" {
		t.Fatalf("unexpected version %q", d20InterruptsMigrationVersion)
	}
	for name, raw := range map[string]string{
		"Cutting Words": cuttingWordsInterruptMechanics,
		"Warding Flare": wardingFlareInterruptMechanics,
	} {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(raw), &mechanics); err != nil {
			t.Fatalf("%s mechanics: %v", name, err)
		}
		if !strings.Contains(raw, `"kind":"d20_interrupt"`) ||
			!strings.Contains(raw, `"resource":"reaction"`) {
			t.Errorf("%s lacks a data-driven interrupt and reaction cost", name)
		}
	}
	for _, want := range []string{
		`"resource":"bardic_inspiration"`,
		`"eligible_rolls":["attack_roll","ability_check"]`,
		`"by_level":{"1":6,"5":8,"10":10,"15":12}`,
	} {
		if !strings.Contains(cuttingWordsInterruptMechanics, want) {
			t.Errorf("Cutting Words misses %s", want)
		}
	}
	for _, want := range []string{
		`"resource":"warding_flare"`,
		`"op":"grant","id":"warding_flare","amount":"max(1,wis)"`,
		`"operation":"impose_disadvantage"`,
	} {
		if !strings.Contains(wardingFlareInterruptMechanics, want) {
			t.Errorf("Warding Flare misses %s", want)
		}
	}
}

func TestD20InterruptProductionClone(t *testing.T) {
	dsn := os.Getenv("D20_INTERRUPT_CLONE_DSN")
	if dsn == "" {
		t.Skip("D20_INTERRUPT_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeD20Interrupts(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var repaired, untested int
	if err = db.QueryRow(`SELECT
		count(*) FILTER (WHERE mechanics::text LIKE '%"kind": "d20_interrupt"%'),
		count(*) FILTER (WHERE support->>'status'='untested')
		FROM effects WHERE card_number=ANY(ARRAY['EFFECT-0012','EFFECT-0121'])
		AND deleted_at IS NULL`).Scan(&repaired, &untested); err != nil {
		t.Fatal(err)
	}
	if repaired != 2 || untested != 2 {
		t.Fatalf("repaired=%d untested=%d, want 2/2", repaired, untested)
	}
}
