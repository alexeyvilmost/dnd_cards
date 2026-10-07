package migrations

import (
	"database/sql"
	_ "embed"
)

// The checksum binds this executor and its complete SQL, including metadata guards.
//
//go:embed catalog_presentation_schema_307.sql
var catalogPresentation307DDL []byte

func addCatalogPresentation307(db *sql.DB) error { return addCatalogPresentation307On(db) }
func addCatalogPresentation307On(db additiveExecer) error {
	_, err := db.Exec(string(catalogPresentation307DDL))
	return err
}
