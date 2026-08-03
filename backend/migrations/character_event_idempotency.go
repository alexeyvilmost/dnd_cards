package migrations

import (
	"database/sql"
	"fmt"
)

// addCharacterEventIdempotency позволяет клиенту безопасно повторить тот же
// batch после сетевой ошибки. Старые строки остаются валидными: NULL не входит
// в частичный уникальный индекс.
func addCharacterEventIdempotency(db *sql.DB) error {
	queries := []string{
		"ALTER TABLE character_events ADD COLUMN IF NOT EXISTS client_event_id UUID",
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_character_events_character_client_id
			ON character_events(character_id, client_event_id)
			WHERE client_event_id IS NOT NULL`,
	}
	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("character event idempotency migration: %w", err)
		}
	}
	return nil
}
