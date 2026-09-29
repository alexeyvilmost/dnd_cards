package migrations

import (
	"database/sql"
	_ "embed"
	"fmt"
)

//go:embed entity_reference_levels_279.sql
var entityReferenceLevels279SQL string

func correctEntityReferenceLevels279(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(entityReferenceLevels279SQL); err != nil {
		return fmt.Errorf("correct reference level extraction: %w", err)
	}
	for _, source := range []struct{ table, kind string }{{"classes", "class"}, {"races", "race"}} {
		var exists bool
		if err = tx.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, source.table).Scan(&exists); err != nil {
			return err
		}
		if exists {
			if _, err = tx.Exec(fmt.Sprintf(`SELECT entity_reference_sync('%s', to_jsonb(e)) FROM %s e`, source.kind, source.table)); err != nil {
				return fmt.Errorf("reindex %s reference levels: %w", source.table, err)
			}
		}
	}
	return tx.Commit()
}
