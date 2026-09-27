package migrations

import (
	"database/sql"
	_ "embed"
)

//go:embed readable_catalog_271.json
var readableCatalog271JSON []byte

// Covers preexisting local metadata variants that intentionally did not pass
// the published snapshot's preimage guards in migration 270.
func applyReadableCatalog271(db *sql.DB) error {
	return applyReadableCatalogPatch(db, readableCatalog271JSON)
}
