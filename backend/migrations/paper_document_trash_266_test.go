package migrations

import "testing"

func TestPaperDocumentTrash266PreservesExistingSheets(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "PAPER_DOCUMENT_266_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE paper_documents(id text PRIMARY KEY, document jsonb);
INSERT INTO paper_documents VALUES ('hero','{"version":1,"fields":{"name":"Герой"}}');`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := addPaperDocumentTrash266(db); err != nil {
			t.Fatal(err)
		}
	}
	var name string
	var active bool
	if err := db.QueryRow(`SELECT document->'fields'->>'name', deleted_at IS NULL FROM paper_documents WHERE id='hero'`).Scan(&name, &active); err != nil || name != "Герой" || !active {
		t.Fatalf("changed existing sheet: %s %v %v", name, active, err)
	}
	if err := refusePaperDocumentTrash266Down(db); err == nil {
		t.Fatal("rollback must not silently restore deleted data")
	}
}
