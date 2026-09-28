package migrations

import "database/sql"

// Sources are templates. The separate UNIQUE(character_id) constraint continues
// to guarantee that a runtime character belongs to exactly one run.
func allowReusableRunSources276(db *sql.DB) error {
	_, err := db.Exec(`DROP INDEX IF EXISTS idx_roguelike_runs_one_active_character`)
	return err
}
