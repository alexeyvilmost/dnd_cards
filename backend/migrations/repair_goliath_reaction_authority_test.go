package migrations

import (
	"encoding/json"
	"testing"
)

func TestRepairGoliathReactionAuthorityIsIdentityIndependentAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, statement := range []string{
		`CREATE TABLE races (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			related_effects jsonb, related_actions jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE actions (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			name text NOT NULL, description text NOT NULL, image_url text, rarity text NOT NULL,
			action_type text NOT NULL, type text, author text, source text,
			mechanics jsonb, resource text, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE effects (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			mechanics jsonb, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE spells (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mechanics jsonb, support jsonb,
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`INSERT INTO actions (
			card_number, name, description, rarity, action_type, mechanics, support, deleted_at
		) VALUES (
			'ACT-goliath-stone', 'Старая запись', '', 'common', 'class_feature',
			'{"activation":{"mode":"active"},"effects":[]}'::jsonb,
			'{"mechanics_locked":true}'::jsonb, NOW()
		)`,
		`INSERT INTO effects (card_number, mechanics) VALUES
			('RE-sub-stone', '{
			  "activation":{"mode":"passive"},
			  "effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"1d12+con"}]}]
			}'::jsonb),
			('RE-stone-description', '{"activation":{"mode":"passive"},"effects":[]}'::jsonb)`,
		`INSERT INTO races (card_number, related_effects, related_actions)
		 SELECT 'RACE-0011-stone',
		        jsonb_build_array(duplicate.id::text, descriptive.card_number),
		        '["stale-environment-id"]'::jsonb
		 FROM effects duplicate, effects descriptive
		 WHERE duplicate.card_number = 'RE-sub-stone'
		   AND descriptive.card_number = 'RE-stone-description'`,
		certifiedContentMechanicsOnlyLockDDL,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("fixture DDL/seed failed: %v", err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := repairGoliathReactionAuthority(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var actionID string
	var mechanics, relatedActions, relatedEffects []byte
	if err := db.QueryRow(`
		SELECT id::text, mechanics FROM actions WHERE card_number = 'ACT-goliath-stone'
	`).Scan(&actionID, &mechanics); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		SELECT related_actions, related_effects FROM races WHERE card_number = 'RACE-0011-stone'
	`).Scan(&relatedActions, &relatedEffects); err != nil {
		t.Fatal(err)
	}
	var actionRefs, effectRefs []string
	if err := json.Unmarshal(relatedActions, &actionRefs); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(relatedEffects, &effectRefs); err != nil {
		t.Fatal(err)
	}
	if len(actionRefs) != 1 || actionRefs[0] != actionID {
		t.Fatalf("lineage did not bind the resolved action identity: %#v / %s", actionRefs, actionID)
	}
	if len(effectRefs) != 1 || effectRefs[0] != "RE-stone-description" {
		t.Fatalf("semantic reaction effect was not removed without harming description: %#v", effectRefs)
	}
	var value map[string]any
	if err := json.Unmarshal(mechanics, &value); err != nil {
		t.Fatal(err)
	}
	activation := value["activation"].(map[string]any)
	targeting := value["targeting"].(map[string]any)
	if activation["mode"] != "reaction" ||
		activation["trigger"].(map[string]any)["event"] != "damage_taken" ||
		activation["trigger"].(map[string]any)["timing"] != "before" ||
		targeting["domain"] != "actor" ||
		targeting["shape"] != "self" ||
		targeting["actor_targets"] != false {
		t.Fatalf("action mechanics did not become a pre-damage reaction: %#v", value)
	}
}

func TestGoliathReactionAuthorityMigrationFollowsLineageSource(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != "113_repair_goliath_reaction_authority" {
			continue
		}
		if index == 0 || migrations[index-1].Version != "112_inherit_lineage_source" {
			t.Fatal("migration 113 must immediately follow 112")
		}
		return
	}
	t.Fatal("migration 113 is not registered")
}
