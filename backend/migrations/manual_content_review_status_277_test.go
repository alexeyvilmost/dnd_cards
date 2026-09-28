package migrations

import (
	"fmt"
	"testing"
)

func TestPartialNarrativeReviewMigrationRegistration(t *testing.T) {
	for _, migration := range GetAllMigrations() {
		if migration.Version == partialNarrativeReviewMigrationVersion && migration.Up != nil && migration.Down != nil {
			return
		}
	}
	t.Fatal("partial narrative review migration is not registered")
}

func TestPartialNarrativeReviewMigrationPreservesReviewsAndHistory(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	statuses := []string{"verified", "verified_partial", "not_verified", "not_tested", "narrative", "partial_narrative_verified", "partial_narrative_not_verified", "partial_narrative_verified_partial"}
	for _, table := range manualContentReviewTables {
		column := "id"
		if table == "passive_presentations" {
			column = "key"
		}
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s (%s text PRIMARY KEY, name text, mechanics jsonb, support jsonb);
			INSERT INTO %s(%s, name) VALUES ('existing', 'Original')`, table, column, table, column)); err != nil {
			t.Fatal(err)
		}
	}
	if err := enableManualContentReview274(db); err != nil {
		t.Fatal(err)
	}
	// Include the new value too: running/retrying this additive migration must
	// preserve reviews already selected on any library, including audit fields.
	before := map[string]string{}
	for index, table := range manualContentReviewTables {
		support := fmt.Sprintf(`{"status":%q,"reviewed_by":"reviewer-%d","reviewed_at":"2026-09-29T00:00:00Z","note":"preserve"}`, statuses[index%len(statuses)], index)
		if _, err := db.Exec("UPDATE "+table+" SET support=$1::jsonb", support); err != nil {
			t.Fatal(err)
		}
		before[table] = support
	}
	if _, err := db.Exec(`CREATE TABLE saved_combat_history (snapshot jsonb);
		INSERT INTO saved_combat_history VALUES ('{"support":{"status":"verified_mechanical","mechanics_locked":true},"events":[1,2]}')`); err != nil {
		t.Fatal(err)
	}
	var history, archive string
	if err := db.QueryRow(`SELECT snapshot::text FROM saved_combat_history`).Scan(&history); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(a) ORDER BY entity_table)::text FROM content_review_support_archive a`).Scan(&archive); err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		if err := extendManualContentReview277(db); err != nil {
			t.Fatal(err)
		}
		for table, support := range before {
			var unchanged bool
			if err := db.QueryRow("SELECT support=$1::jsonb FROM "+table, support).Scan(&unchanged); err != nil || !unchanged {
				t.Fatalf("%s review changed on migration run %d: %v", table, run, err)
			}
		}
	}
	var historyAfter, archiveAfter string
	if err := db.QueryRow(`SELECT snapshot::text FROM saved_combat_history`).Scan(&historyAfter); err != nil || historyAfter != history {
		t.Fatalf("combat history changed: %v", err)
	}
	if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(a) ORDER BY entity_table)::text FROM content_review_support_archive a`).Scan(&archiveAfter); err != nil || archiveAfter != archive {
		t.Fatalf("support archive changed: %v", err)
	}
	for _, table := range []string{"actions", "resources"} {
		for _, status := range statuses {
			if _, err := db.Exec("UPDATE "+table+" SET support=jsonb_build_object('status', $1::text)", status); err != nil {
				t.Fatalf("%s rejected %s: %v", table, status, err)
			}
		}
		if _, err := db.Exec("UPDATE " + table + " SET name='Renamed'"); err != nil {
			t.Fatal(err)
		}
		var status string
		if err := db.QueryRow("SELECT support->>'status' FROM " + table).Scan(&status); err != nil || status != "partial_narrative_verified_partial" {
			t.Fatalf("%s metadata edit lost pink review: %q %v", table, status, err)
		}
		if _, err := db.Exec("UPDATE " + table + ` SET support='{"status":"unknown"}'`); err == nil {
			t.Fatalf("%s accepted unknown manual review", table)
		}
		if _, err := db.Exec("UPDATE " + table + ` SET mechanics='{"changed":true}'`); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT support->>'status' FROM " + table).Scan(&status); err != nil || status != "not_verified" {
			t.Fatalf("%s mechanics edit did not revoke review: %q %v", table, status, err)
		}
		if _, err := db.Exec("INSERT INTO " + table + `(id,name,support) VALUES ('new','New','{"status":"verified"}')`); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT support->>'status' FROM " + table + " WHERE id='new'").Scan(&status); err != nil || status != "not_tested" {
			t.Fatalf("%s creation automatically promoted review: %q %v", table, status, err)
		}
	}
}
