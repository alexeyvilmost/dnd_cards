package migrations

import (
	"database/sql"
	"fmt"
)

// inheritLineageSource materializes the source already implied by a child
// race's parent. It deliberately preserves every explicit child source and
// ignores soft-deleted rows, so later supplements can still override a parent.
func inheritLineageSource(db *sql.DB) error {
	if _, err := db.Exec(`
		UPDATE races AS child
		SET source = parent.source,
			updated_at = NOW()
		FROM races AS parent
		WHERE child.parent_race_id = parent.id
		  AND child.deleted_at IS NULL
		  AND parent.deleted_at IS NULL
		  AND NULLIF(BTRIM(child.source), '') IS NULL
		  AND NULLIF(BTRIM(parent.source), '') IS NOT NULL
	`); err != nil {
		return fmt.Errorf("inherit lineage source from parent race: %w", err)
	}
	return nil
}
