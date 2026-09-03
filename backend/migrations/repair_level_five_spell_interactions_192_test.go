package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestLevelFiveNarrativeSpellRepairsRemoveImpossibleCastInteractions(t *testing.T) {
	repairs := levelFiveNarrativeSpellRepairs()
	if len(repairs) != 6 {
		t.Fatalf("got %d narrative repairs, want 6", len(repairs))
	}
	want := map[string]bool{
		"SPELL-0184": false, "SPELL-0239": false, "lightning_arrow": false,
		"SPELL-0200": false, "conjure_animals": false, "glyph_of_warding": false,
	}
	for _, repair := range repairs {
		if _, exists := want[repair.cardNumber]; !exists {
			t.Errorf("unexpected narrative repair %s", repair.cardNumber)
			continue
		}
		if want[repair.cardNumber] {
			t.Fatalf("duplicate narrative repair %s", repair.cardNumber)
		}
		want[repair.cardNumber] = true
		encoded, err := json.Marshal(levelFiveNarrativeEffects(repair.description))
		if err != nil {
			t.Fatal(err)
		}
		text := string(encoded)
		for _, forbidden := range []string{`"resolution":"save"`, `"resolution":"attack_roll"`, `"kind":"damage"`, `"who":"target"`} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s retains impossible cast-time interaction %s: %s", repair.cardNumber, forbidden, text)
			}
		}
		if !strings.Contains(text, `"kind":"narrative"`) || strings.TrimSpace(repair.description) == "" {
			t.Errorf("%s lacks an explicit narrative outcome: %s", repair.cardNumber, text)
		}
	}
	for card, seen := range want {
		if !seen {
			t.Errorf("missing narrative repair %s", card)
		}
	}
}

func TestLevelFiveLongCastRepairsAreExactAndNonAtomic(t *testing.T) {
	repairs := levelFiveLongCastRepairs()
	if len(repairs) != 9 {
		t.Fatalf("got %d long-cast repairs, want 9", len(repairs))
	}
	want := map[string]levelFiveLongCastRepair{
		"SPELL-0175":        {unit: "minute", amount: 1},
		"SPELL-0180":        {unit: "minute", amount: 1},
		"SPELL-0227":        {unit: "minute", amount: 10},
		"animate_dead":      {unit: "minute", amount: 1},
		"clairvoyance":      {unit: "minute", amount: 10},
		"glyph_of_warding":  {unit: "hour", amount: 1},
		"leomunds_tiny_hut": {unit: "minute", amount: 1},
		"magic_circle":      {unit: "minute", amount: 1},
		"phantom_steed":     {unit: "minute", amount: 1},
	}
	seen := map[string]bool{}
	for _, repair := range repairs {
		expected, exists := want[repair.cardNumber]
		if !exists {
			t.Errorf("unexpected long-cast repair %s", repair.cardNumber)
			continue
		}
		if seen[repair.cardNumber] {
			t.Fatalf("duplicate long-cast repair %s", repair.cardNumber)
		}
		seen[repair.cardNumber] = true
		if repair.unit != expected.unit || repair.amount != expected.amount {
			t.Errorf("%s cast time=%d %s, want %d %s", repair.cardNumber, repair.amount, repair.unit, expected.amount, expected.unit)
		}
		if repair.unit != "minute" && repair.unit != "hour" {
			t.Errorf("%s is accidentally atomic in encounter: %#v", repair.cardNumber, repair)
		}
	}
}

func TestLevelFiveSpellInteractionRepairProductionClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_SPELL_INTERACTION_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_SPELL_INTERACTION_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairLevelFiveSpellInteractions(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	cards := make([]string, 0, 14)
	for _, repair := range levelFiveNarrativeSpellRepairs() {
		cards = append(cards, repair.cardNumber)
	}
	for _, repair := range levelFiveLongCastRepairs() {
		if repair.cardNumber != "glyph_of_warding" {
			cards = append(cards, repair.cardNumber)
		}
	}
	var repaired, untested int
	if err = db.QueryRow(`SELECT count(*),count(*) FILTER (WHERE
		support->>'status'='untested' AND support->>'certification_version'=$2)
		FROM spells WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`,
		cards, levelFiveSpellInteractionRepairVersion).Scan(&repaired, &untested); err != nil {
		t.Fatal(err)
	}
	if repaired != 14 || untested != 14 {
		t.Fatalf("repaired=%d untested=%d, want 14/14", repaired, untested)
	}
}
