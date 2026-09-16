package migrations

import "database/sql"

// Additive: no existing combat, catalog, receipt or checkpoint is rewritten.
func createRoguelikeParty254(db *sql.DB) error {
	_, err := db.Exec(`ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS party jsonb NOT NULL DEFAULT '{}'::jsonb;
 CREATE INDEX IF NOT EXISTS idx_roguelike_party ON roguelike_runs USING gin(party);`)
	return err
}
