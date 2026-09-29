package migrations

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestCatalogVariants280Manifest(t *testing.T) {
	manifest, err := catalogVariants280Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Entities) != 197 {
		t.Fatalf("unexpected reviewed 280 scope: %d", len(manifest.Entities))
	}
	if err := validateCatalogAudit278([]catalogAudit278Manifest{manifest}); err != nil {
		t.Fatal(err)
	}
	var inserts, patches int
	statuses := map[string]int{}
	for _, entity := range manifest.Entities {
		if entity.Preimage == nil {
			inserts++
		} else {
			patches++
		}
		if entity.Review == nil || (entity.Review.Status != "not_verified" && entity.Review.Status != "partial_narrative_not_verified") {
			t.Fatalf("unreviewed or prematurely verified 280 row: %s", entity.CardNumber)
		}
		statuses[entity.Review.Status]++
	}
	if inserts != 139 || patches != 58 {
		t.Fatalf("280 scope inserts=%d patches=%d", inserts, patches)
	}
	if statuses["not_verified"] != 165 || statuses["partial_narrative_not_verified"] != 32 {
		t.Fatalf("unexpected 280 review statuses: %v", statuses)
	}
}

func TestCatalogVariants280OnRestoredProductionSnapshot(t *testing.T) {
	dsn := os.Getenv("CATALOG_VARIANTS_280_LOCAL_DSN")
	if dsn == "" {
		t.Skip("set CATALOG_VARIANTS_280_LOCAL_DSN for the disposable local production snapshot")
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
	if !strings.HasPrefix(databaseName, "catalog_completion_") || (serverAddress != "127.0.0.1" && serverAddress != "::1") {
		t.Fatalf("local disposable snapshot only: database=%q server=%q", databaseName, serverAddress)
	}
	for run := 1; run <= 2; run++ {
		if err := NewMigrator(db).Run(); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
	}
	manifest, err := catalogVariants280Manifest()
	if err != nil {
		t.Fatal(err)
	}
	var archived int
	if err := db.QueryRow(`SELECT count(*) FROM catalog_mechanics_280_archive`).Scan(&archived); err != nil {
		t.Fatal(err)
	}
	if archived != len(manifest.Entities) {
		t.Fatalf("280 archive=%d, manifest=%d", archived, len(manifest.Entities))
	}
}
