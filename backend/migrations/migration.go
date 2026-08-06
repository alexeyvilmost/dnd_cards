package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"
)

// migrationAdvisoryLockID serializes schema migrations across rolling backend
// replicas. The lock is session-scoped and automatically disappears if the
// owning PostgreSQL connection is lost.
const migrationAdvisoryLockID int64 = 0x444e444341524453 // "DNDCARDS"

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
func (m *Migrator) Run() (runErr error) {
	ctx := context.Background()
	lockConnection, err := m.acquireAdvisoryLock(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire migration advisory lock: %w", err)
	}
	defer func() {
		if err := releaseAdvisoryLock(ctx, lockConnection); err != nil && runErr == nil {
			runErr = fmt.Errorf("failed to release migration advisory lock: %w", err)
		}
	}()

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

func (m *Migrator) acquireAdvisoryLock(ctx context.Context) (*sql.Conn, error) {
	connection, err := m.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := connection.ExecContext(
		ctx,
		"SELECT pg_advisory_lock($1)",
		migrationAdvisoryLockID,
	); err != nil {
		_ = connection.Close()
		return nil, err
	}
	return connection, nil
}

func releaseAdvisoryLock(ctx context.Context, connection *sql.Conn) error {
	defer connection.Close()
	var released bool
	if err := connection.QueryRowContext(
		ctx,
		"SELECT pg_advisory_unlock($1)",
		migrationAdvisoryLockID,
	).Scan(&released); err != nil {
		return err
	}
	if !released {
		return fmt.Errorf("migration advisory lock was not owned by this connection")
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
