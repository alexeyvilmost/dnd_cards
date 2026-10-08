package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestApplicationDatabaseCompressionConfiguration(t *testing.T) {
	config := &Config{DBHost: "127.0.0.1", DBPort: "5432", DBUser: "owned", DBPassword: "synthetic", DBName: "test_owned", DBSSLMode: "disable"}
	for _, compression := range []string{"", "lz4", "pglz"} {
		t.Setenv("DB_TOAST_COMPRESSION", compression)
		dsn, err := config.ApplicationDSN()
		if err != nil {
			t.Fatal("valid compression configuration rejected")
		}
		parsed, err := pgx.ParseConfig(dsn)
		if err != nil {
			t.Fatal("application DSN could not be parsed")
		}
		expected := compression
		if expected == "" {
			expected = "lz4"
		}
		if parsed.RuntimeParams["default_toast_compression"] != expected || parsed.Database != config.DBName || parsed.User != config.DBUser || parsed.Password != config.DBPassword {
			t.Fatal("compression changed application connection identity")
		}
	}
	for _, invalid := range []string{"unknown", "lz4 sslmode=disable", "lz4'"} {
		t.Setenv("DB_TOAST_COMPRESSION", invalid)
		if dsn, err := config.ApplicationDSN(); err == nil || dsn != "" {
			t.Fatal("invalid compression setting accepted")
		}
	}
}

func TestApplicationDatabaseCompressionPoolAndHistoricalValues(t *testing.T) {
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}
	parsed, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("owned test DSN could not be parsed")
	}
	admin := stdlib.OpenDB(*parsed)
	defer admin.Close()
	var database, address, marker, previousDefault string
	if err = admin.QueryRow("SELECT current_database(),host(inet_server_addr()),run_id FROM test_run_ownership").Scan(&database, &address, &marker); err != nil || database != os.Getenv("TEST_RUN_ID") || marker != database || !strings.HasPrefix(database, "test_") || (address != "127.0.0.1" && address != "::1") {
		t.Fatal("compression test requires its own loopback database")
	}
	if err = admin.QueryRow("SHOW default_toast_compression").Scan(&previousDefault); err != nil {
		t.Fatal("cannot inspect owned database default")
	}
	t.Setenv("DB_TOAST_COMPRESSION", "lz4")
	config := &Config{DBHost: parsed.Host, DBPort: fmt.Sprint(parsed.Port), DBUser: parsed.User, DBPassword: parsed.Password, DBName: parsed.Database, DBSSLMode: "disable"}
	applicationDSN, err := config.ApplicationDSN()
	if err != nil {
		t.Fatal(err)
	}
	applicationConfig, err := pgx.ParseConfig(applicationDSN)
	if err != nil {
		t.Fatal("application DSN could not be parsed")
	}
	pool := stdlib.OpenDB(*applicationConfig)
	defer pool.Close()
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(0)
	ctx := context.Background()
	first, err := pool.Conn(ctx)
	if err != nil {
		t.Fatal("application connection failed")
	}
	defer first.Close()
	second, err := pool.Conn(ctx)
	if err != nil {
		t.Fatal("second application connection failed")
	}
	defer second.Close()
	check := func(conn *sql.Conn) {
		t.Helper()
		var compression string
		if err := conn.QueryRowContext(ctx, "SHOW default_toast_compression").Scan(&compression); err != nil || compression != "lz4" {
			t.Fatal("a pooled connection lost its compression policy")
		}
	}
	check(first)
	check(second)
	for _, statement := range []string{
		"CREATE TEMP TABLE compression_history (id int PRIMARY KEY, data jsonb)",
		"SET default_toast_compression=pglz",
		"INSERT INTO compression_history VALUES (1,jsonb_build_object('snapshot',repeat('unchanged battle state ',40000)))",
		"SET default_toast_compression=lz4",
	} {
		if _, err = first.ExecContext(ctx, statement); err != nil {
			t.Fatal("owned historical value preparation failed")
		}
	}
	var beforeRow, beforeJSON, beforeCompression string
	if err = first.QueryRowContext(ctx, "SELECT ctid::text,data::text,pg_column_compression(data) FROM compression_history WHERE id=1").Scan(&beforeRow, &beforeJSON, &beforeCompression); err != nil || beforeCompression != "pglz" {
		t.Fatal("historical PGLZ value was not prepared")
	}
	if _, err = first.ExecContext(ctx, "INSERT INTO compression_history SELECT 2,data || '{\"new\":true}'::jsonb FROM compression_history WHERE id=1"); err != nil {
		t.Fatal("owned LZ4 write failed")
	}
	var afterRow, afterJSON, afterCompression, newCompression string
	if err = first.QueryRowContext(ctx, "SELECT ctid::text,data::text,pg_column_compression(data) FROM compression_history WHERE id=1").Scan(&afterRow, &afterJSON, &afterCompression); err != nil || afterRow != beforeRow || afterJSON != beforeJSON || afterCompression != beforeCompression {
		t.Fatal("new writer changed a historical row")
	}
	if err = first.QueryRowContext(ctx, "SELECT pg_column_compression(data) FROM compression_history WHERE id=2").Scan(&newCompression); err != nil || newCompression != "lz4" {
		t.Fatal("new application write did not use LZ4")
	}
	first.Close()
	second.Close()
	replacement, err := pool.Conn(ctx)
	if err != nil {
		t.Fatal("replacement application connection failed")
	}
	defer replacement.Close()
	check(replacement)
	var unchangedDefault string
	if err = admin.QueryRow("SHOW default_toast_compression").Scan(&unchangedDefault); err != nil || unchangedDefault != previousDefault {
		t.Fatal("application setting changed unrelated database sessions")
	}
}
