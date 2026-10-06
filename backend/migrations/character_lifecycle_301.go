package migrations

import "database/sql"

// Keep foreign-key identities, command receipts and frozen combat history.
// Deletion removes owned sheets/runs from live queries instead of destroying
// the records referenced by historical sessions or reusable source sheets.
func addCharacterLifecycle301(db *sql.DB) error {
	return addCharacterLifecycle301On(db)
}

func addCharacterLifecycle301On(db additiveExecer) error {
	_, err := db.Exec(`
   ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
   ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
   CREATE INDEX IF NOT EXISTS idx_characters_v3_deleted_at ON characters_v3(deleted_at);
   CREATE INDEX IF NOT EXISTS idx_roguelike_runs_deleted_at ON roguelike_runs(deleted_at);
 `)
	return err
}
