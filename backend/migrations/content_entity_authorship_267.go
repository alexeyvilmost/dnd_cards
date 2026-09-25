package migrations

import (
	"database/sql"
	"errors"
)

// Existing library rows remain editorial content. New owner-created items and
// spells use the account UUID stored in the same author column.
func addContentEntityAuthorship267(db *sql.DB) error {
	_, err := db.Exec(`
ALTER TABLE resources ADD COLUMN IF NOT EXISTS author varchar(255) NOT NULL DEFAULT 'Admin';
ALTER TABLE variables ADD COLUMN IF NOT EXISTS author varchar(255) NOT NULL DEFAULT 'Admin';
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS author varchar(255) NOT NULL DEFAULT 'Admin';
ALTER TABLE monsters ADD COLUMN IF NOT EXISTS author varchar(255) NOT NULL DEFAULT 'Admin';
CREATE INDEX IF NOT EXISTS cards_author_owner_267 ON cards(author) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS spells_author_owner_267 ON spells(author) WHERE deleted_at IS NULL;
`)
	return err
}

func refuseContentEntityAuthorship267Down(*sql.DB) error {
	return errors.New("migration 267 preserves authorship for content edit permissions")
}
