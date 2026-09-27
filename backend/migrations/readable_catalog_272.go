package migrations

import (
	"database/sql"
	_ "embed"
)

//go:embed readable_catalog_272.json
var readableCatalog272JSON []byte

// Final guarded local compatibility pass for empty English labels and long
// descriptions in databases that had already executed the first two patches.
func applyReadableCatalog272(db *sql.DB) error {
	return applyReadableCatalogPatch(db, readableCatalog272JSON)
}
