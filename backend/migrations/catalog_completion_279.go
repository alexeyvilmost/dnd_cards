package migrations

import (
	"bytes"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
)

const catalogCompletion279Version = "279_item_mechanics_completion"

//go:embed data/item-completion-279/items.json
var catalogCompletion279Files embed.FS

func catalogCompletion279Manifest() (catalogAudit278Manifest, error) {
	raw, err := catalogCompletion279Files.ReadFile("data/item-completion-279/items.json")
	if err != nil {
		return catalogAudit278Manifest{}, err
	}
	var manifest catalogAudit278Manifest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return catalogAudit278Manifest{}, fmt.Errorf("item completion 279 manifest: %w", err)
	}
	return manifest, nil
}

func applyCatalogCompletion279(db *sql.DB) error {
	manifest, err := catalogCompletion279Manifest()
	if err != nil {
		return err
	}
	return applyCatalogAuditVersion(db, []catalogAudit278Manifest{manifest}, 279, catalogCompletion279Version)
}
