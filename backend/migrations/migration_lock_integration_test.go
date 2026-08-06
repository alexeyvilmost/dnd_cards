package migrations

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestMigrationAdvisoryLockSerializesConcurrentMigratorsOnIsolatedPostgres(t *testing.T) {
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}

	firstDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer firstDB.Close()
	secondDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer secondDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	firstConnection, err := NewMigrator(firstDB).acquireAdvisoryLock(ctx)
	if err != nil {
		t.Fatalf("acquire first migration lock: %v", err)
	}
	firstHeld := true
	defer func() {
		if firstHeld {
			_ = releaseAdvisoryLock(context.Background(), firstConnection)
		}
	}()

	type lockResult struct {
		connection *sql.Conn
		err        error
	}
	secondResult := make(chan lockResult, 1)
	go func() {
		connection, lockErr := NewMigrator(secondDB).acquireAdvisoryLock(ctx)
		secondResult <- lockResult{connection: connection, err: lockErr}
	}()

	select {
	case result := <-secondResult:
		if result.connection != nil {
			_ = releaseAdvisoryLock(context.Background(), result.connection)
		}
		t.Fatalf("second migrator bypassed advisory lock: %v", result.err)
	case <-time.After(150 * time.Millisecond):
		// Expected: the second session remains blocked until the first releases.
	}

	if err := releaseAdvisoryLock(ctx, firstConnection); err != nil {
		t.Fatalf("release first migration lock: %v", err)
	}
	firstHeld = false

	select {
	case result := <-secondResult:
		if result.err != nil {
			t.Fatalf("second migrator did not acquire after release: %v", result.err)
		}
		if err := releaseAdvisoryLock(ctx, result.connection); err != nil {
			t.Fatalf("release second migration lock: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("second migrator remained blocked after release: %v", ctx.Err())
	}
}
