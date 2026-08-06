package migrations

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// openIsolatedPostgresSchema gives every DDL integration test a disposable
// namespace inside the configured test database. This makes repeated and race
// runs independent while keeping the PostgreSQL version/extensions identical
// to the acceptance environment.
func openIsolatedPostgresSchema(t *testing.T, environmentVariable string) *sql.DB {
	t.Helper()
	dsn := os.Getenv(environmentVariable)
	if dsn == "" {
		t.Skipf("%s is not set", environmentVariable)
	}
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = admin.Ping(); err != nil {
		_ = admin.Close()
		t.Fatalf("ping isolated postgres: %v", err)
	}
	schema := "migration_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(fmt.Sprintf("CREATE SCHEMA %s", schema)); err != nil {
		_ = admin.Close()
		t.Fatalf("create isolated schema: %v", err)
	}

	isolatedDSN := strings.TrimSpace(dsn) + " search_path=" + schema
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, parseErr := url.Parse(dsn)
		if parseErr != nil {
			_, _ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema))
			_ = admin.Close()
			t.Fatalf("parse isolated postgres DSN: %v", parseErr)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		isolatedDSN = parsed.String()
	}
	db, err := sql.Open("pgx", isolatedDSN)
	if err != nil {
		_, _ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema))
		_ = admin.Close()
		t.Fatal(err)
	}
	if err = db.Ping(); err != nil {
		_ = db.Close()
		_, _ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema))
		_ = admin.Close()
		t.Fatalf("ping isolated schema: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		_, _ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema))
		_ = admin.Close()
	})
	return db
}
