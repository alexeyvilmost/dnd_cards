package migrations

import (
	"database/sql"
	"errors"
)

func addPaperDocumentTrash266(db *sql.DB) error {
	_, err := db.Exec(`ALTER TABLE paper_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS paper_documents_deleted_at ON paper_documents(deleted_at);`)
	return err
}

func refusePaperDocumentTrash266Down(*sql.DB) error {
	return errors.New("migration 266 preserves deleted paper sheets; removing deletion state would silently restore them")
}
