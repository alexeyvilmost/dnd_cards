package migrations

import (
	"fmt"
	"testing"
)

func TestManualContentReviewMigrationRegistration(t *testing.T) {
	for _, migration := range GetAllMigrations() {
		if migration.Version == manualContentReviewMigrationVersion && migration.Up != nil && migration.Down != nil {
			return
		}
	}
	t.Fatal("manual review migration is not registered")
}

func TestManualContentReviewMigrationArchivesUnlocksAndResetsEveryLibrary(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	const legacy = `{"status":"verified_mechanical","mechanics_locked":true,"evidence_id":"legacy-evidence"}`
	for _, table := range manualContentReviewTables {
		column, datatype, id := "id", "uuid", "'00000000-0000-0000-0000-000000000001'"
		if table == "passive_presentations" {
			column, datatype, id = "key", "text", "'test.passive'"
		}
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s (%s %s PRIMARY KEY, name text, mechanics jsonb, support jsonb, updated_at timestamptz, deleted_at timestamptz);
			INSERT INTO %s(%s,name,mechanics,support) VALUES(%s,'Original','{}','%s')`, table, column, datatype, table, column, id, legacy)); err != nil {
			t.Fatal(err)
		}
	}
	if err := addContentSupportCertification(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE test_combat_history (snapshot jsonb); INSERT INTO test_combat_history VALUES ('` + legacy + `')`); err != nil {
		t.Fatal(err)
	}
	if err := enableManualContentReview274(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range manualContentReviewTables {
		var status string
		if err := db.QueryRow("SELECT support->>'status' FROM " + table).Scan(&status); err != nil || status != "not_verified" {
			t.Fatalf("%s reset: %q, %v", table, status, err)
		}
		var exact bool
		if err := db.QueryRow(`SELECT support = $1::jsonb FROM content_review_support_archive WHERE entity_table=$2`, legacy, table).Scan(&exact); err != nil || !exact {
			t.Fatalf("%s archive changed: %v, %v", table, exact, err)
		}
		// The same contract must apply to spell mechanics and a second,
		// unrelated entity type, as well as every other library table.
		if _, err := db.Exec("UPDATE " + table + ` SET support='{"status":"verified"}'; UPDATE ` + table + ` SET name='Renamed'`); err != nil {
			t.Fatalf("metadata edit %s: %v", table, err)
		}
		if err := db.QueryRow("SELECT support->>'status' FROM " + table).Scan(&status); err != nil || status != "verified" {
			t.Fatalf("%s metadata invalidated review: %q %v", table, status, err)
		}
		if _, err := db.Exec("UPDATE " + table + ` SET mechanics='{"changed":true}'`); err != nil {
			t.Fatalf("mechanics remained locked for %s: %v", table, err)
		}
		if err := db.QueryRow("SELECT support->>'status' FROM " + table).Scan(&status); err != nil || status != "not_verified" {
			t.Fatalf("%s changed mechanics retained review: %q %v", table, status, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO spells(id,name) VALUES('00000000-0000-0000-0000-000000000002','New'); UPDATE actions SET support='{"status":"verified_partial"}'`); err != nil {
		t.Fatal(err)
	}
	if err := enableManualContentReview274(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	var status string
	if err := db.QueryRow(`SELECT support->>'status' FROM spells WHERE name='New'`).Scan(&status); err != nil || status != "not_tested" {
		t.Fatalf("new entity review changed on repeat: %s %v", status, err)
	}
	if err := db.QueryRow(`SELECT support->>'status' FROM actions`).Scan(&status); err != nil || status != "verified_partial" {
		t.Fatalf("repeat migration reset manual review: %s %v", status, err)
	}
	var archived int
	if err := db.QueryRow(`SELECT count(*) FROM content_review_support_archive`).Scan(&archived); err != nil || archived != len(manualContentReviewTables) {
		t.Fatalf("archive count: %d %v", archived, err)
	}
	var historyUnchanged bool
	if err := db.QueryRow(`SELECT snapshot = $1::jsonb FROM test_combat_history`, legacy).Scan(&historyUnchanged); err != nil || !historyUnchanged {
		t.Fatalf("history changed: %v %v", historyUnchanged, err)
	}
}
