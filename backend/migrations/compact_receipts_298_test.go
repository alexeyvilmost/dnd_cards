package migrations

import (
	"strings"
	"testing"
)

func TestCompactReceiptMigrationPreservesHistoryAndConstraints(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	for _, table := range []string{"roguelike_command_receipts", "character_runtime_commands"} {
		if _, err := db.Exec("CREATE TABLE " + table + " (id integer PRIMARY KEY,response jsonb NOT NULL); INSERT INTO " + table + " VALUES(1,'{\"historical\":\"immutable\"}');"); err != nil {
			t.Fatal(err)
		}
	}
	if err := addCompactReceipts298(db); err != nil {
		t.Fatal(err)
	}
	if err := addCompactReceipts298(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"roguelike_command_receipts", "character_runtime_commands"} {
		var response string
		var version int
		if err := db.QueryRow("SELECT response::text,response_version FROM "+table+" WHERE id=1").Scan(&response, &version); err != nil {
			t.Fatal(err)
		}
		if response != `{"historical": "immutable"}` || version != 1 {
			t.Fatal("historical response rewritten")
		}
		if _, err := db.Exec("INSERT INTO " + table + "(id,response,response_version) VALUES(2,'{}',2)"); err == nil {
			t.Fatal("invalid compact payload accepted")
		}
		if _, err := db.Exec("INSERT INTO "+table+"(id,response,response_version,response_payload,response_sha256,response_length) VALUES(2,'{}',2,decode('abcd','hex'),$1,10)", strings.Repeat("a", 64)); err != nil {
			t.Fatal(err)
		}
	}
	for _, migration := range GetAllMigrations() {
		if migration.Version == compactReceipts298Version {
			if err := migration.Down(db); err == nil {
				t.Fatal("destructive rollback accepted")
			}
			return
		}
	}
	t.Fatal("compact receipt migration missing")
}
