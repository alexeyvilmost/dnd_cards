package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestLevelFiveRuntimeHardeningMigrationIsRegistered(t *testing.T) {
	registeredMigrationIndex(t, levelFiveRuntimeHardeningMigrationVersion)
}

func TestHardenLevelFiveRuntimeProductionClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_RUNTIME_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_RUNTIME_CLONE_DSN is not configured")
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
		if err := hardenLevelFiveRuntime(db); err != nil {
			t.Fatalf("production-clone migration run %d: %v", run+1, err)
		}
	}
}

func TestLevelFiveRuntimeHardeningDeclarationsAreFailClosedAndLibraryDriven(t *testing.T) {
	declarations := []struct {
		name, mechanics string
	}{
		{"stunning strike", stunningStrikeHardenedMechanics},
		{"cunning poison", cunningStrikeHardenedMechanics(`{"resolution":"auto","result":[]}`, false)},
		{"cunning withdraw", cunningStrikeHardenedMechanics(`{"resolution":"auto","result":[]}`, true)},
		{"uncanny dodge", uncannyDodgeHardenedMechanics},
	}
	for _, declaration := range declarations {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(declaration.mechanics), &mechanics); err != nil {
			t.Fatalf("%s mechanics: %v", declaration.name, err)
		}
		if strings.Contains(declaration.mechanics, `"kind":"condition"`) {
			t.Errorf("%s applies an inline generic condition", declaration.name)
		}
	}
	for _, reference := range []string{"COND-stunned", "EFFECT-monk-stunning-strike-slow", "EFFECT-monk-stunning-strike-opening"} {
		if !strings.Contains(stunningStrikeHardenedMechanics, reference) {
			t.Errorf("Stunning Strike lost library reference %s", reference)
		}
	}
	if !strings.Contains(stunningStrikeHardenedMechanics, `"source_weapon_qualifier":"monk_weapon"`) ||
		!strings.Contains(stunningStrikeHardenedMechanics, `"per":"turn"`) {
		t.Fatal("Stunning Strike must remain hit-gated and once per turn")
	}
	if !strings.Contains(uncannyDodgeHardenedMechanics, `"timing":"before"`) ||
		!strings.Contains(uncannyDodgeHardenedMechanics, `"source_visible"`) ||
		!strings.Contains(uncannyDodgeHardenedMechanics, `"delivery"`) {
		t.Fatal("Uncanny Dodge must be a pre-damage reaction to a visible attack")
	}
}

func TestHardenLevelFiveRuntimeIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE actions (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB NOT NULL, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB NOT NULL, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	actionCards := []string{
		"action_basic_unarmed", "ACT-monk-stunning-strike",
		"ACT-rogue-cunning-strike-poison", "ACT-rogue-cunning-strike-trip",
		"ACT-rogue-cunning-strike-withdraw", "ACT-rogue-uncanny-dodge",
	}
	for index, card := range actionCards {
		if _, err := db.Exec(`
			INSERT INTO actions (id, card_number, mechanics, support)
			VALUES ($1::uuid, $2, '{"activation":{"mode":"active","cost":[]},"effects":[]}'::jsonb,
			        '{"status":"verified_mechanical","mechanics_locked":true}'::jsonb)
		`, fmt.Sprintf("16900000-0000-4000-8000-%012d", index+1), card); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO effects (id, card_number, mechanics, support) VALUES (
		  '16900000-0000-4000-8000-000000000101', 'EFF-wizard-spellcasting',
		  '{"activation":{"mode":"passive"},"effects":[{"kind":"narrative"},{"kind":"narrative"},{"kind":"narrative"},{"kind":"prepared_spell_choice","count":4,"prompt":"Подготовьте 4 заклинания из книги заклинаний","count_by_level":{"1":4,"2":5}}]}'::jsonb,
		  '{"status":"verified_mechanical","mechanics_locked":true}'::jsonb
		)
	`); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := hardenLevelFiveRuntime(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var unarmedPrimitive, uncannyTiming, wizardLevelFiveCount, prompt, actionStatus, effectStatus string
	if err := db.QueryRow(`
		SELECT mechanics#>>'{primitive,type}', support->>'status'
		FROM actions WHERE card_number='action_basic_unarmed'
	`).Scan(&unarmedPrimitive, &actionStatus); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT mechanics#>>'{activation,trigger,timing}'
		FROM actions WHERE card_number='ACT-rogue-uncanny-dodge'
	`).Scan(&uncannyTiming); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT mechanics#>>'{effects,3,count_by_level,5}', mechanics#>>'{effects,3,prompt}', support->>'status'
		FROM effects WHERE card_number='EFF-wizard-spellcasting'
	`).Scan(&wizardLevelFiveCount, &prompt, &effectStatus); err != nil {
		t.Fatal(err)
	}
	if unarmedPrimitive != "unarmed_strike" || actionStatus != "untested" ||
		uncannyTiming != "before" || wizardLevelFiveCount != "9" ||
		prompt != "Подготовьте заклинания из книги заклинаний" || effectStatus != "untested" {
		t.Fatalf("unexpected postimage primitive=%q action_status=%q uncanny=%q wizard5=%q prompt=%q effect_status=%q",
			unarmedPrimitive, actionStatus, uncannyTiming, wizardLevelFiveCount, prompt, effectStatus)
	}
}
