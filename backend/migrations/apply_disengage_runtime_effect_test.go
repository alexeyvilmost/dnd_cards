package migrations

import (
	"encoding/json"
	"testing"
)

func TestApplyDisengageRuntimeEffectMigrationIsRegisteredAfter098(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "099_apply_disengage_runtime_effect" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("099 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("099_apply_disengage_runtime_effect is not registered")
	}
	if previous := migrations[index-1].Version; previous != "098_restore_live_mvp_starting_equipment" {
		t.Fatalf("migration before 099 = %q, want 098", previous)
	}
}

func TestApplyDisengageRuntimeEffectIsScopedAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE actions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT NOT NULL UNIQUE,
			mechanics JSONB,
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			deleted_at TIMESTAMPTZ
		);
		INSERT INTO actions (card_number, mechanics, support) VALUES
			('action_basic_disengage', '{"effects":[{"resolution":"auto","result":[{"kind":"narrative"}]}]}', '{"status":"verified_narrative"}'),
			('action_basic_dash', '{"effects":[]}', '{"status":"verified_partial"}');
	`); err != nil {
		t.Fatal(err)
	}

	if err := applyDisengageRuntimeEffect(db); err != nil {
		t.Fatal(err)
	}
	if err := applyDisengageRuntimeEffect(db); err != nil {
		t.Fatalf("099 is not idempotent: %v", err)
	}

	var raw []byte
	var support []byte
	if err := db.QueryRow(`
		SELECT mechanics #> '{effects,0,result,0}', support
		FROM actions WHERE card_number = 'action_basic_disengage'
	`).Scan(&raw, &support); err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	appliesTo, _ := payload["applies_to"].(map[string]any)
	duration, _ := payload["duration"].(map[string]any)
	if payload["kind"] != "modifier" || payload["op"] != "deny" ||
		appliesTo["interaction"] != "opportunity_attack" ||
		duration["type"] != "until_start_of_next_turn" {
		t.Fatalf("unexpected Disengage payload: %s", raw)
	}
	if support != nil {
		t.Fatalf("stale support was not invalidated: %s", support)
	}

	var dashKind string
	if err := db.QueryRow(`
		SELECT COALESCE(mechanics #>> '{effects,0,result,0,kind}', '')
		FROM actions WHERE card_number = 'action_basic_dash'
	`).Scan(&dashKind); err != nil {
		t.Fatal(err)
	}
	if dashKind != "" {
		t.Fatalf("unrelated action changed: %q", dashKind)
	}
}
