package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
)

//go:embed readable_catalog_270.json
var readableCatalog270JSON []byte

// The patch is editorial metadata only. Each field compares its own preimage
// so a newer manual edit to one field does not block safe updates to the rest.
func applyReadableCatalog270(db *sql.DB) error {
	return applyReadableCatalogPatch(db, readableCatalog270JSON)
}

func applyReadableCatalogPatch(db *sql.DB, patchJSON []byte) error {
	var payload struct {
		SchemaVersion int                        `json:"schema_version"`
		Snapshot      string                     `json:"snapshot"`
		Catalogs      map[string]json.RawMessage `json:"catalogs"`
	}
	if err := json.Unmarshal(patchJSON, &payload); err != nil {
		return fmt.Errorf("decode readable catalog patch: %w", err)
	}
	if payload.SchemaVersion != 1 {
		return fmt.Errorf("unsupported readable catalog schema version %d", payload.SchemaVersion)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	columns := map[string][]string{
		"spells":  {"description", "detailed_description", "upcast_description", "name_en", "source"},
		"feats":   {"description", "detailed_description", "name_en", "source"},
		"actions": {"description", "detailed_description", "name_en", "source"},
		"effects": {"description", "detailed_description", "name_en", "source"},
	}
	for _, table := range []string{"spells", "feats", "actions", "effects"} {
		rows := payload.Catalogs[table]
		if len(rows) == 0 {
			return fmt.Errorf("readable catalog patch missing %s", table)
		}
		if string(rows) == "[]" {
			continue
		}
		for _, column := range columns[table] {
			// Table and column names come only from the fixed list above.
			query := fmt.Sprintf(`UPDATE %s AS target SET %s = (patch.item #>> '{updated,%s}')
				FROM jsonb_array_elements($1::jsonb) AS patch(item)
				WHERE target.id::text = patch.item->>'id'
				AND target.card_number = patch.item->>'card_number'
				AND target.%s IS NOT DISTINCT FROM (patch.item #>> '{old,%s}')
				AND target.%s IS DISTINCT FROM (patch.item #>> '{updated,%s}')`,
				table, column, column, column, column, column, column)
			result, execErr := tx.Exec(query, string(rows))
			if execErr != nil {
				return fmt.Errorf("apply readable catalog %s.%s: %w", table, column, execErr)
			}
			count, countErr := result.RowsAffected()
			if countErr != nil {
				return countErr
			}
			log.Printf("readable catalog %s %s.%s: %d rows updated", payload.Snapshot, table, column, count)
		}
	}
	return tx.Commit()
}
