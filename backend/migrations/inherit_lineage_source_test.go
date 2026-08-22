package migrations

import (
	"database/sql"
	"testing"
)

func TestInheritLineageSourceMigrationFollowsRangedActionAlignment(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "112_inherit_lineage_source" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("112 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("112_inherit_lineage_source is not registered")
	}
	if previous := migrations[index-1].Version; previous != "111_align_ranged_weapon_action_declaration" {
		t.Fatalf("migration before 112 = %q, want 111", previous)
	}
}

func TestInheritLineageSourceIsGenericPreservingAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE races (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT NOT NULL UNIQUE,
			source TEXT,
			parent_race_id UUID REFERENCES races(id),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			deleted_at TIMESTAMPTZ
		);
		INSERT INTO races (card_number, source) VALUES
			('parent-phb', 'PHB 2024'),
			('parent-supplement', 'Supplement 2026'),
			('parent-unknown', NULL),
			('parent-deleted', 'Archived Source');
		UPDATE races SET deleted_at = NOW() WHERE card_number = 'parent-deleted';
		INSERT INTO races (card_number, source, parent_race_id)
		SELECT 'child-null', NULL, id FROM races WHERE card_number = 'parent-phb';
		INSERT INTO races (card_number, source, parent_race_id)
		SELECT 'child-empty', '  ', id FROM races WHERE card_number = 'parent-supplement';
		INSERT INTO races (card_number, source, parent_race_id)
		SELECT 'child-explicit', 'Own Book', id FROM races WHERE card_number = 'parent-phb';
		INSERT INTO races (card_number, source, parent_race_id)
		SELECT 'child-unknown', NULL, id FROM races WHERE card_number = 'parent-unknown';
		INSERT INTO races (card_number, source, parent_race_id, deleted_at)
		SELECT 'child-deleted', NULL, id, NOW() FROM races WHERE card_number = 'parent-phb';
		INSERT INTO races (card_number, source, parent_race_id)
		SELECT 'child-of-deleted', NULL, id FROM races WHERE card_number = 'parent-deleted';
	`); err != nil {
		t.Fatal(err)
	}

	if err := inheritLineageSource(db); err != nil {
		t.Fatal(err)
	}
	if err := inheritLineageSource(db); err != nil {
		t.Fatalf("112 is not idempotent: %v", err)
	}

	assertSource := func(cardNumber string, expected sql.NullString) {
		t.Helper()
		var actual sql.NullString
		if err := db.QueryRow(`SELECT source FROM races WHERE card_number = $1`, cardNumber).Scan(&actual); err != nil {
			t.Fatal(err)
		}
		if actual != expected {
			t.Fatalf("%s source = %#v, want %#v", cardNumber, actual, expected)
		}
	}
	assertSource("child-null", sql.NullString{String: "PHB 2024", Valid: true})
	assertSource("child-empty", sql.NullString{String: "Supplement 2026", Valid: true})
	assertSource("child-explicit", sql.NullString{String: "Own Book", Valid: true})
	assertSource("child-unknown", sql.NullString{})
	assertSource("child-deleted", sql.NullString{})
	assertSource("child-of-deleted", sql.NullString{})
}
