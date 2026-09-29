package migrations

import (
	"database/sql"
	_ "embed"
	"fmt"
)

//go:embed entity_reference_coverage_284.sql
var entityReferenceCoverage284SQL string

func expandEntityReferenceCoverage284(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(entityReferenceCoverage284SQL); err != nil {
		return fmt.Errorf("expand mechanical reference coverage: %w", err)
	}
	for _, source := range []struct{ table, kind string }{
		{"cards", "card"}, {"actions", "action"}, {"effects", "effect"},
		{"spells", "spell"}, {"feats", "feat"}, {"backgrounds", "background"},
		{"races", "race"}, {"classes", "class"}, {"resources", "resource"},
		{"variables", "variable"}, {"concepts", "concept"}, {"monsters", "monster"},
		{"passive_presentations", "passive"},
	} {
		var exists bool
		if err = tx.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, source.table).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			continue
		}
		// Keep a concurrent content write from racing this backfill's snapshot.
		// The table list and its order are fixed, not supplied by a request.
		if _, err = tx.Exec(fmt.Sprintf(`LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE;
			SELECT entity_reference_sync('%s', to_jsonb(e)) FROM %s e`, source.table, source.kind, source.table)); err != nil {
			return fmt.Errorf("reindex %s mechanic references: %w", source.table, err)
		}
	}
	return tx.Commit()
}
