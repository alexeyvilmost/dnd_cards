package migrations

import (
	"database/sql"
	"fmt"
)

// alignCardPriceContract261 keeps the PostgreSQL constraint in sync with the
// public API contract. Card prices are numeric because copper-denominated
// items may be fractional, and the editor accepts values up to 1,000,000.
func alignCardPriceContract261(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin card price contract migration: %w", err)
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_price_check`); err != nil {
		return fmt.Errorf("drop legacy cards price constraint: %w", err)
	}
	if _, err = tx.Exec(`
		ALTER TABLE cards
		ADD CONSTRAINT cards_price_check
		CHECK (price IS NULL OR (price > 0 AND price <= 1000000))
		NOT VALID
	`); err != nil {
		return fmt.Errorf("add cards price constraint: %w", err)
	}
	if _, err = tx.Exec(`ALTER TABLE cards VALIDATE CONSTRAINT cards_price_check`); err != nil {
		return fmt.Errorf("validate cards price constraint: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit card price contract migration: %w", err)
	}
	return nil
}
