package migrations

import (
	"encoding/json"
	"testing"
)

func TestDeduplicateGoliathAncestryMovesSelectionsAndBindsCanonicalAction(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, statement := range []string{
		`CREATE TABLE races (
			id uuid PRIMARY KEY, card_number text NOT NULL UNIQUE,
			related_actions jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE actions (
			id uuid PRIMARY KEY, card_number text NOT NULL UNIQUE, deleted_at timestamptz
		)`,
		`CREATE TABLE characters_v3 (
			id uuid PRIMARY KEY, lineage_id varchar(100),
			updated_at timestamptz NOT NULL DEFAULT NOW()
		)`,
		`INSERT INTO races (id, card_number, related_actions) VALUES
			('b262a4c9-e303-472b-b347-e3fcb2fe93f1', 'RACE-0011-cloud', '[]'::jsonb),
			('c7d9a195-c230-462a-aed0-9b7c5bf5fd49', 'RACE-GOLIATH-CLOUD', '["legacy"]'::jsonb)`,
		`INSERT INTO actions (id, card_number) VALUES
			('8295a341-92ef-485b-b1de-7a5d7712fe4e', 'ACT-goliath-cloud')`,
		`INSERT INTO characters_v3 (id, lineage_id) VALUES
			('10000000-0000-4000-8000-000000000001', 'c7d9a195-c230-462a-aed0-9b7c5bf5fd49'),
			('10000000-0000-4000-8000-000000000002', 'RACE-GOLIATH-CLOUD')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("fixture DDL/seed failed: %v", err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := deduplicateGoliathAncestry(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var selectedCount int
	if err := db.QueryRow(`
		SELECT count(*) FROM characters_v3
		WHERE lineage_id = 'b262a4c9-e303-472b-b347-e3fcb2fe93f1'
	`).Scan(&selectedCount); err != nil || selectedCount != 2 {
		t.Fatalf("character selections were not moved: count=%d err=%v", selectedCount, err)
	}
	var aliasVisible bool
	if err := db.QueryRow(`
		SELECT deleted_at IS NULL FROM races WHERE card_number = 'RACE-GOLIATH-CLOUD'
	`).Scan(&aliasVisible); err != nil || aliasVisible {
		t.Fatalf("duplicate lineage remained visible: visible=%v err=%v", aliasVisible, err)
	}
	var raw []byte
	if err := db.QueryRow(`
		SELECT related_actions FROM races WHERE card_number = 'RACE-0011-cloud'
	`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var actionIDs []string
	if err := json.Unmarshal(raw, &actionIDs); err != nil {
		t.Fatal(err)
	}
	if len(actionIDs) != 1 || actionIDs[0] != "8295a341-92ef-485b-b1de-7a5d7712fe4e" {
		t.Fatalf("canonical lineage action was not bound: %#v", actionIDs)
	}
}

func TestDeduplicateGoliathAncestryMigrationIsRegisteredAfter109(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version == "110_deduplicate_goliath_ancestry" {
			if index == 0 || migrations[index-1].Version != "109_normalize_goliath_ancestry" {
				t.Fatal("migration 110 must immediately follow 109")
			}
			return
		}
	}
	t.Fatal("migration 110 is not registered")
}
