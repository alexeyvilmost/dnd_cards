package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestWizardMemorizeSpellDeclarationIsPassiveAndFailClosed(t *testing.T) {
	var mechanics map[string]any
	if err := json.Unmarshal([]byte(wizardMemorizeSpellMechanics), &mechanics); err != nil {
		t.Fatal(err)
	}
	activation, ok := mechanics["activation"].(map[string]any)
	if !ok || activation["mode"] != "passive" {
		t.Fatalf("Memorize Spell must not remain a proactive action: %#v", activation)
	}
	decision, ok := mechanics["spell_preparation_rest"].(map[string]any)
	if !ok {
		t.Fatal("missing spell_preparation_rest declaration")
	}
	for key, expected := range map[string]any{
		"kind": "prepared_spell_swap", "decision_type": "wizard_memorize_spell",
		"rest": "short_rest", "source": "spellbook",
		"maximum_per_rest": float64(1), "minimum_spell_level": float64(1),
		"maximum_spell_level": "max_available_spell_slot", "optional": true,
	} {
		if decision[key] != expected {
			t.Errorf("%s = %#v, want %#v", key, decision[key], expected)
		}
	}
	if strings.Contains(wizardMemorizeSpellMechanics, "grant_action") {
		t.Error("the passive feature must not grant the obsolete post-rest action")
	}
}

func TestWizardMemorizeSpellMigrationOnClone(t *testing.T) {
	dsn := os.Getenv("WIZARD_MEMORIZE_SPELL_CLONE_DSN")
	if dsn == "" {
		t.Skip("WIZARD_MEMORIZE_SPELL_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		if err := materializeWizardMemorizeSpell(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}
	var raw []byte
	var status string
	if err := db.QueryRow(`SELECT mechanics, support->>'status' FROM effects
		WHERE card_number='EFF-wizard-memorize-spell' AND deleted_at IS NULL`).Scan(&raw, &status); err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" || status != "untested" {
		t.Fatalf("unexpected materialized effect: mechanics=%s status=%q", raw, status)
	}
}
