package migrations

import (
	"database/sql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net/url"
	"os"
	"testing"
)

func TestMartialClassesLocalMigration256(t *testing.T) {
	dsn := os.Getenv("MARTIAL_QA_DATABASE_URL")
	if dsn == "" {
		t.Skip("explicit local QA database required")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Hostname() != "127.0.0.1" || parsed.Path != "/shop_review_249_20260915" {
		t.Fatal("only isolated local QA database permitted")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for i := 0; i < 2; i++ {
		if err := materializeMartialClasses256(db); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	err = db.QueryRow(`SELECT count(*) FROM actions WHERE deleted_at IS NULL AND
 ((card_number IN ('ACT-monk-step-of-the-wind','ACT-monk-step-of-the-wind-focus') AND mechanics#>>'{activation,counts_as}'='dash')
 OR (card_number='ACT-monk-deflect-redirect' AND mechanics#>>'{effects,0,resolution}'='save')
 OR (card_number='ACT-monk-deflect-attacks' AND mechanics#>>'{activation,trigger,timing}'='before')
 OR (card_number='ACT-monk-bonus-unarmed' AND mechanics#>>'{activation,mode}'='active'))`).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Fatalf("class action postconditions: %d/5", count)
	}
}
