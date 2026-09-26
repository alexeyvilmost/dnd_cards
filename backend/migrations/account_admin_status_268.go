package migrations

import (
	"database/sql"
	"errors"
)

func addAccountAdminStatus268(db *sql.DB) error {
	_, err := db.Exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;`)
	return err
}

func refuseAccountAdminStatus268Down(*sql.DB) error {
	return errors.New("migration 268 preserves account administrator grants")
}
