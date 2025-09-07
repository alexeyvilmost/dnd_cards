package migrations

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

// Migration представляет одну миграцию
type Migration struct {
	Version     string
	Description string
	Up          func(*sql.DB) error
	Down        func(*sql.DB) error
}

// Migrator управляет миграциями
type Migrator struct {
	db *sql.DB
}

// NewMigrator создает новый экземпляр мигратора
func NewMigrator(db *sql.DB) *Migrator {
	return &Migrator{db: db}
}

// Run выполняет все миграции
func (m *Migrator) Run() error {
	// Создаем таблицу для отслеживания миграций
	if err := m.createMigrationsTable(); err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Получаем список выполненных миграций
	executedMigrations, err := m.getExecutedMigrations()
	if err != nil {
		return fmt.Errorf("failed to get executed migrations: %w", err)
	}

	// Выполняем все миграции
	for _, migration := range GetAllMigrations() {
		if _, exists := executedMigrations[migration.Version]; !exists {
			log.Printf("Running migration: %s - %s", migration.Version, migration.Description)

			if err := migration.Up(m.db); err != nil {
				return fmt.Errorf("failed to run migration %s: %w", migration.Version, err)
			}

			// Записываем выполненную миграцию
			if err := m.recordMigration(migration.Version, migration.Description); err != nil {
				return fmt.Errorf("failed to record migration %s: %w", migration.Version, err)
			}

			log.Printf("Migration %s completed successfully", migration.Version)
		}
	}

	return nil
}

// createMigrationsTable создает таблицу для отслеживания миграций
func (m *Migrator) createMigrationsTable() error {
	query := `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			description TEXT,
			executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)
	`
	_, err := m.db.Exec(query)
	return err
}

// getExecutedMigrations возвращает список выполненных миграций
func (m *Migrator) getExecutedMigrations() (map[string]bool, error) {
	query := "SELECT version FROM schema_migrations"
	rows, err := m.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	executed := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		executed[version] = true
	}

	return executed, nil
}

// recordMigration записывает выполненную миграцию
func (m *Migrator) recordMigration(version, description string) error {
	query := `
		INSERT INTO schema_migrations (version, description, executed_at) 
		VALUES ($1, $2, $3)
	`
	_, err := m.db.Exec(query, version, description, time.Now())
	return err
}
