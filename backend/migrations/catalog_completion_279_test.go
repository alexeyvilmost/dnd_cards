package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestCatalogCompletionRejectsChangedActiveItemScope(t *testing.T) {
	db, manifests := audit278Fixture(t)
	defer db.Close()
	manifests[0].ExpectedActiveCards = 2
	if err := applyCatalogAuditVersion(db, manifests, 279, "279_item_mechanics_completion"); err == nil || !strings.Contains(err.Error(), "active item count changed") {
		t.Fatalf("expected an active item count guard failure, got %v", err)
	}
	audit278AssertOriginal(t, db)
}

func TestCatalogCompletionHasIndependentReceipt(t *testing.T) {
	db, initial := audit278Fixture(t)
	defer db.Close()
	if err := applyCatalogAudit278(db, initial); err != nil {
		t.Fatal(err)
	}
	next := initial
	next[0].AuditID = "completion-batch"
	for i := range next[0].Entities {
		entity := &next[0].Entities[i]
		entity.Preimage = entity.Patch
		entity.Patch = map[string]json.RawMessage{"mechanics": audit278JSON(`{"completed":true}`)}
	}
	if err := applyCatalogAuditVersion(db, next, 279, "279_item_mechanics_completion"); err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"278", "279"} {
		var count int
		if err := db.QueryRow("SELECT count(*) FROM catalog_mechanics_" + version + "_archive").Scan(&count); err != nil || count != 2 {
			t.Fatalf("archive %s count=%d error=%v", version, count, err)
		}
	}
	if _, err := db.Exec(`UPDATE cards SET mechanics='{"human":true}'`); err != nil {
		t.Fatal(err)
	}
	if err := applyCatalogAuditVersion(db, next, 279, "279_item_mechanics_completion"); err != nil {
		t.Fatal(err)
	}
	var retained bool
	if err := db.QueryRow(`SELECT mechanics='{"human":true}'::jsonb FROM cards LIMIT 1`).Scan(&retained); err != nil || !retained {
		t.Fatalf("retry changed later edits: %v", err)
	}
}

func TestCatalogCompletion279OnRestoredProductionSnapshot(t *testing.T) {
	dsn := os.Getenv("ITEM_COMPLETION_279_LOCAL_DSN")
	if dsn == "" {
		t.Skip("set ITEM_COMPLETION_279_LOCAL_DSN for the disposable local production snapshot")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var databaseName, serverAddress string
	if err := db.QueryRow(`SELECT current_database(), host(inet_server_addr())`).Scan(&databaseName, &serverAddress); err != nil {
		t.Fatal(err)
	}
	if databaseName != "catalog_completion_20260929" || (serverAddress != "127.0.0.1" && serverAddress != "::1") {
		t.Fatalf("local snapshot only: database=%q server=%q", databaseName, serverAddress)
	}
	manifest, err := catalogCompletion279Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateCatalogAudit278([]catalogAudit278Manifest{manifest}); err != nil {
		t.Fatal(err)
	}
	for run := 1; run <= 2; run++ {
		if err := NewMigrator(db).Run(); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
	}
	var archived, active, reviewed, forbidden int
	if err := db.QueryRow(`SELECT count(*) FROM catalog_mechanics_279_archive`).Scan(&archived); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*),
		count(*) FILTER (WHERE support->>'audit_id'=$1),
		count(*) FILTER (WHERE support->>'audit_id'=$1 AND support->>'status' IN ('verified','partial_narrative_verified'))
		FROM cards WHERE deleted_at IS NULL`, manifest.AuditID).Scan(&active, &reviewed, &forbidden); err != nil {
		t.Fatal(err)
	}
	if archived != len(manifest.Entities) || active != 887 || reviewed != 887 || forbidden != 0 {
		t.Fatalf("migration coverage archive=%d/%d active=%d reviewed=%d forbidden=%d", archived, len(manifest.Entities), active, reviewed, forbidden)
	}
	var operation string
	if err := db.QueryRow(`SELECT mechanics #>> '{effects,0,result,0,operation}' FROM actions WHERE card_number='ACT-item-influence-0378'`).Scan(&operation); err != nil {
		t.Fatal(err)
	}
	if operation != "reroll_roll" {
		t.Fatalf("time item influence operation=%q", operation)
	}
}
