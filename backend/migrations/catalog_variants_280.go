package migrations

import (
	"bytes"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
)

const catalogVariants280Version = "280_catalog_variants_and_multitarget"

//go:embed data/catalog-variants-280/entities.json
var catalogVariants280Files embed.FS

func catalogVariants280Manifest() (catalogAudit278Manifest, error) {
	raw, err := catalogVariants280Files.ReadFile("data/catalog-variants-280/entities.json")
	if err != nil {
		return catalogAudit278Manifest{}, err
	}
	var manifest catalogAudit278Manifest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return catalogAudit278Manifest{}, fmt.Errorf("catalog variants 280 manifest: %w", err)
	}
	return manifest, nil
}

func applyCatalogVariants280(db *sql.DB) error {
	manifest, err := catalogVariants280Manifest()
	if err != nil {
		return err
	}
	return applyCatalogAuditVersion(db, []catalogAudit278Manifest{manifest}, 280, catalogVariants280Version)
}
