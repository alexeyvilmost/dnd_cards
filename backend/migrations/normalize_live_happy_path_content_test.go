package migrations

import (
	"encoding/json"
	"testing"
)

func TestNormalizeLiveHappyPathContentExecutesIdempotently(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, statement := range []string{
		`CREATE TABLE races (
			id uuid PRIMARY KEY, name text NOT NULL, name_en text, description text NOT NULL,
			image_url text NOT NULL DEFAULT '', image_cloudinary_id text NOT NULL DEFAULT '',
			image_cloudinary_url text NOT NULL DEFAULT '', rarity text NOT NULL DEFAULT 'common',
			card_number text NOT NULL UNIQUE, is_subrace boolean, parent_race_id uuid,
			subrace_level int, related_effects jsonb, related_actions jsonb, support jsonb,
			type text, author text NOT NULL DEFAULT 'Admin', source text, tags jsonb,
			is_extended boolean, created_at timestamptz NOT NULL DEFAULT NOW(),
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`CREATE TABLE cards (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			mechanics jsonb, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`CREATE TABLE classes (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			name text NOT NULL, name_en text, is_subclass boolean, deleted_at timestamptz
		)`,
		`CREATE TABLE spells (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			classes jsonb, mechanics jsonb, support jsonb,
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`INSERT INTO races (id, name, name_en, description, card_number)
		 VALUES ('832cebd9-121a-4457-b9fd-92adaee40720', 'Голиаф', 'Goliath', 'parent', 'RACE-0011')`,
		`INSERT INTO cards (card_number, mechanics) VALUES
		 ('CARD-0485', '{}'::jsonb),
		 ('CARD-0839', '{"uses":{"count":2},"activation":{"consumes_self":true,"cost":[{"resource":"bonus_action","amount":1}]}}'::jsonb)`,
		`INSERT INTO classes (card_number, name, name_en) VALUES
		 ('CLASS-wizard', 'Волшебник', 'Wizard'), ('CLASS-druid', 'Друид', 'Druid'),
		 ('CLASS-sorcerer', 'Чародей', 'Sorcerer')`,
		`INSERT INTO spells (card_number, classes, mechanics, support) VALUES
		 ('SPELL-0212', '["Wizard","Druid","Sorcerer"]'::jsonb,
		  '{"effects":[]}'::jsonb, '{"status":"verified_partial","mechanics_locked":false,"content_hash":"stale"}'::jsonb)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("fixture DDL/seed failed: %v", err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := normalizeLiveHappyPathContent(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var lineages int
	if err := db.QueryRow(`SELECT count(*) FROM races WHERE parent_race_id = '832cebd9-121a-4457-b9fd-92adaee40720'`).Scan(&lineages); err != nil || lineages != 6 {
		t.Fatalf("expected six explicit Goliath lineages, count=%d err=%v", lineages, err)
	}

	var weaponProfile, potion, spellMechanics, spellSupport []byte
	if err := db.QueryRow(`SELECT mechanics->'weapon_profile' FROM cards WHERE card_number='CARD-0485'`).Scan(&weaponProfile); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics FROM cards WHERE card_number='CARD-0839'`).Scan(&potion); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics, support FROM spells WHERE card_number='SPELL-0212'`).Scan(&spellMechanics, &spellSupport); err != nil {
		t.Fatal(err)
	}
	var profile, potionValue, spellValue, supportValue map[string]any
	for raw, target := range map[*map[string]any][]byte{
		&profile: weaponProfile, &potionValue: potion, &spellValue: spellMechanics, &supportValue: spellSupport,
	} {
		if err := json.Unmarshal(target, raw); err != nil {
			t.Fatal(err)
		}
	}
	if profile["weapon_type"] != "greatsword" {
		t.Fatalf("weapon profile not materialized: %#v", profile)
	}
	if _, legacyUses := potionValue["uses"]; legacyUses {
		t.Fatalf("legacy potion uses remained: %#v", potionValue)
	}
	activation := potionValue["activation"].(map[string]any)
	costs := activation["cost"].([]any)
	if len(costs) != 2 || costs[1].(map[string]any)["resource"] != "self_item" {
		t.Fatalf("potion self_item cost not materialized: %#v", potionValue)
	}
	classIDs := spellValue["spell_class_list_ids"].([]any)
	if len(classIDs) != 3 || classIDs[0] != "CLASS-druid" || classIDs[2] != "CLASS-wizard" {
		t.Fatalf("spell class ids not normalized: %#v", classIDs)
	}
	if _, staleHash := supportValue["content_hash"]; staleHash {
		t.Fatalf("stale certification hash remained: %#v", supportValue)
	}
}

func TestLiveHappyPathContentMigrationIsRegisteredAfter106(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version == "107_normalize_live_happy_path_content" {
			if index == 0 || migrations[index-1].Version != "106_repair_preserved_locked_action_targeting" {
				t.Fatalf("migration 107 must immediately follow 106")
			}
			return
		}
	}
	t.Fatal("migration 107 is not registered")
}
