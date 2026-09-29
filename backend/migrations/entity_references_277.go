package migrations

import (
	"database/sql"
	_ "embed"
	"fmt"
)

// The index is metadata beside the library. Saved characters, certificates and
// combat snapshots are deliberately never rewritten by this migration.
//
//go:embed entity_references_277.sql
var entityReferences277SQL string

func enableEntityReferences277(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(entityReferences277SQL); err != nil {
		return fmt.Errorf("create entity reference index: %w", err)
	}
	for _, table := range manualContentReviewTables {
		kind := map[string]string{"cards": "card", "actions": "action", "effects": "effect", "spells": "spell", "feats": "feat", "backgrounds": "background", "races": "race", "classes": "class", "resources": "resource", "variables": "variable", "concepts": "concept", "monsters": "monster", "passive_presentations": "passive"}[table]
		var exists bool
		if err = tx.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			continue
		}
		if _, err = tx.Exec(fmt.Sprintf(`DROP TRIGGER IF EXISTS index_entity_references ON %s;
		CREATE TRIGGER index_entity_references AFTER INSERT OR UPDATE OR DELETE ON %s
		FOR EACH ROW EXECUTE FUNCTION entity_reference_changed('%s');
		SELECT entity_reference_sync('%s', to_jsonb(e)) FROM %s e`, table, table, kind, kind, table)); err != nil {
			return fmt.Errorf("index %s references: %w", table, err)
		}
	}
	return tx.Commit()
}
