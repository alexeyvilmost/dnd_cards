package migrations

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

func releaseFixture(t *testing.T) (*sql.DB, ReleaseMigrationRequest) {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE schema_migrations(version varchar(255) PRIMARY KEY,description text,executed_at timestamptz DEFAULT NOW());
	CREATE TABLE roguelike_command_receipts(id integer PRIMARY KEY,response jsonb NOT NULL);
	CREATE TABLE character_runtime_commands(id integer PRIMARY KEY,response jsonb NOT NULL);
	CREATE TABLE roguelike_runs(id integer PRIMARY KEY,user_id uuid NOT NULL);
	INSERT INTO roguelike_command_receipts VALUES(1,'{"past":"unchanged"}');INSERT INTO character_runtime_commands VALUES(1,'{"past":"unchanged"}');`)
	if err != nil {
		t.Fatal(err)
	}
	request := ReleaseMigrationRequest{SchemaVersion: 1, ReleaseID: "owned-additive-test", Target: []MigrationIdentity{}, ExpectedCurrent: []MigrationIdentity{}}
	allowed := map[string]string{}
	for _, row := range AdditiveMigrationIdentities() {
		allowed[row.ID] = row.Checksum
	}
	for _, id := range registryVersions() {
		checksum := allowed[id]
		if checksum == "" {
			checksum = "sha256:" + strings.Repeat("a", 64)
			request.ExpectedCurrent = append(request.ExpectedCurrent, MigrationIdentity{ID: id, Checksum: checksum})
			if _, err = db.Exec("INSERT INTO schema_migrations(version) VALUES($1)", id); err != nil {
				t.Fatal(err)
			}
		}
		request.Target = append(request.Target, MigrationIdentity{ID: id, Checksum: checksum})
	}
	return db, request
}
func TestReleaseAdditiveAtomicRepeatAndHistory(t *testing.T) {
	db, request := releaseFixture(t)
	m := NewMigrator(db)
	result, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Applied) != 3 || !result.RollbackReadersSafe || len(result.SchemaProofHash) != 71 {
		t.Fatalf("incomplete result: %+v", result)
	}
	repeated, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(repeated.Applied) != 0 || repeated.SchemaProofHash != result.SchemaProofHash {
		t.Fatal("repeat did not observe identical committed schema")
	}
	var response string
	if err = db.QueryRow("SELECT response::text FROM roguelike_command_receipts WHERE id=1").Scan(&response); err != nil {
		t.Fatal(err)
	}
	if response != `{"past": "unchanged"}` {
		t.Fatal("past response changed")
	}
	var probes int
	if err = db.QueryRow("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'release_schema_probe_%'").Scan(&probes); err != nil {
		t.Fatal(err)
	}
	if probes != 0 {
		t.Fatal("schema proof leaked objects")
	}
}
func TestReleaseAdditiveCrashBeforeLedgerRollsBackDDLAndResumes(t *testing.T) {
	db, request := releaseFixture(t)
	m := NewMigrator(db)
	_, err := m.runReleaseAdditive(context.Background(), request, func() error { return errors.New("injected crash before ledger") })
	if err == nil {
		t.Fatal("failure injection ignored")
	}
	var columns int
	db.QueryRow("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='roguelike_command_receipts' AND column_name='response_version'").Scan(&columns)
	if columns != 0 {
		t.Fatal("DDL escaped failed transaction")
	}
	result, err := m.RunReleaseAdditive(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Applied) != 3 {
		t.Fatal("restart did not finish exactly once")
	}
}
func TestReleaseAdditiveRejectsUnknownChecksumAndWrongSchema(t *testing.T) {
	t.Run("unknown_observed", func(t *testing.T) {
		db, request := releaseFixture(t)
		db.Exec("INSERT INTO schema_migrations(version) VALUES('999_unapproved')")
		if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), request); err == nil {
			t.Fatal("unknown migration accepted")
		}
	})
	t.Run("checksum", func(t *testing.T) {
		db, request := releaseFixture(t)
		request.Target[len(request.Target)-1].Checksum = "sha256:" + strings.Repeat("f", 64)
		if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), request); err == nil {
			t.Fatal("wrong source checksum accepted")
		}
	})
	t.Run("existing_wrong_type", func(t *testing.T) {
		db, request := releaseFixture(t)
		db.Exec("ALTER TABLE roguelike_command_receipts ADD COLUMN response_sha256 text NOT NULL DEFAULT ''")
		if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), request); err == nil {
			t.Fatal("IF NOT EXISTS silently accepted wrong schema")
		}
	})
	t.Run("missing_baseline", func(t *testing.T) {
		db, request := releaseFixture(t)
		db.Exec("DELETE FROM schema_migrations WHERE version=$1", request.ExpectedCurrent[0].ID)
		if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), request); err == nil {
			t.Fatal("missing baseline accepted")
		}
	})
}
func TestReleaseAdditiveResumesReentrantPartialOldStartup(t *testing.T) {
	db, request := releaseFixture(t)
	// Simulate old Run crashing after Up committed and before its separate ledger INSERT.
	if err := addCompactReceipts298(db); err != nil {
		t.Fatal(err)
	}
	if _, err := NewMigrator(db).RunReleaseAdditive(context.Background(), request); err != nil {
		t.Fatal(err)
	}
}
func TestReleaseAdditiveUsesSameLockSessionAndRejectsConcurrentStartup(t *testing.T) {
	db, request := releaseFixture(t)
	m := NewMigrator(db)
	db.SetMaxOpenConns(1)
	// MaxOpenConns=1 would deadlock if DDL/ledger used m.db while lock owned the connection.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := m.RunReleaseAdditive(ctx, request); err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(3)
	connection, err := m.acquireAdvisoryLock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	waitCtx, stop := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer stop()
	if _, err = m.RunReleaseAdditive(waitCtx, request); err == nil {
		t.Fatal("lock bypassed")
	}
	if err = releaseAdvisoryLock(context.Background(), connection); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseAdditiveInspectIsReadOnlyAndRejectsTamperedProof(t *testing.T) {
	for name, statement := range map[string]string{
		"trigger_when_false":      `DROP TRIGGER frozen_catalog_immutable ON frozen_combat_catalogs; CREATE TRIGGER frozen_catalog_immutable BEFORE UPDATE OR DELETE ON frozen_combat_catalogs FOR EACH ROW WHEN (false) EXECUTE FUNCTION reject_frozen_catalog_mutation()`,
		"trigger_function_config": `ALTER FUNCTION reject_frozen_catalog_mutation() SET search_path=pg_catalog`,
		"unlogged_table":          `ALTER TABLE image_jobs SET UNLOGGED`,
		"row_security":            `ALTER TABLE image_jobs ENABLE ROW LEVEL SECURITY`,
		"unexpected_trigger":      `CREATE TRIGGER unexpected BEFORE UPDATE ON image_jobs FOR EACH ROW EXECUTE FUNCTION reject_frozen_catalog_mutation()`,
		"constraint":              `ALTER TABLE image_jobs DROP CONSTRAINT image_jobs_state_check; ALTER TABLE image_jobs ADD CONSTRAINT image_jobs_state_check CHECK(state<>'')`,
	} {
		t.Run(name, func(t *testing.T) {
			db, request := releaseFixture(t)
			m := NewMigrator(db)
			if _, err := m.InspectReleaseAdditive(context.Background(), request); err == nil {
				t.Fatal("inspection applied missing migrations")
			}
			applied, err := m.RunReleaseAdditive(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			observed, err := m.InspectReleaseAdditive(context.Background(), request)
			if err != nil || len(observed.Applied) != 0 || observed.SchemaProofHash != applied.SchemaProofHash {
				t.Fatalf("inspection differs: %+v %v", observed, err)
			}
			if _, err := db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			if _, err := m.InspectReleaseAdditive(context.Background(), request); err == nil {
				t.Fatal("tampered installed schema accepted")
			}
			if _, err := m.RunReleaseAdditive(context.Background(), request); err == nil {
				t.Fatal("repeat silently repaired or accepted tampered installed schema")
			}
		})
	}
}

func TestReleaseAdditiveOldReadersBecomeUnsafeWithoutRewritingHistory(t *testing.T) {
	db, request := releaseFixture(t)
	m := NewMigrator(db)
	if _, err := m.RunReleaseAdditive(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO roguelike_command_receipts(id,response,response_version,response_payload,response_sha256,response_length) VALUES(2,'{}',2,'x',repeat('a',64),1)`); err != nil {
		t.Fatal(err)
	}
	result, err := m.InspectReleaseAdditive(context.Background(), request)
	if err != nil || result.RollbackReadersSafe {
		t.Fatalf("new-format row did not block old readers: %+v %v", result, err)
	}
	var response string
	if err := db.QueryRow(`SELECT response::text FROM roguelike_command_receipts WHERE id=1`).Scan(&response); err != nil || response != `{"past": "unchanged"}` {
		t.Fatal("historical response changed")
	}
}

func TestReleaseAdditiveConnectionLossWhileLedgerBlockedRollsBackSameSessionDDL(t *testing.T) {
	db, request := releaseFixture(t)
	holder, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if _, err = holder.Exec("LOCK TABLE schema_migrations IN SHARE MODE"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	finished := make(chan error, 1)
	go func() { _, err := NewMigrator(db).RunReleaseAdditive(ctx, request); finished <- err }()
	// SHARE allows the initial SELECT, but blocks the first ledger INSERT
	// after ALTER TABLE. Identify only this fixture's relation lock waiter.
	var pid int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		err = db.QueryRow(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE l.relation='schema_migrations'::regclass AND NOT l.granted AND a.query LIKE 'INSERT INTO schema_migrations%'`).Scan(&pid)
		if err == nil {
			break
		}
		if err != sql.ErrNoRows {
			t.Fatal(err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("candidate did not reach pre-ledger lock boundary")
	}
	var advisory, ddl bool
	if err = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted),EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='relation' AND mode='AccessExclusiveLock' AND granted)`, pid).Scan(&advisory, &ddl); err != nil {
		t.Fatal(err)
	}
	if !advisory || !ddl {
		t.Fatal("DDL/ledger waiter does not own migration advisory lock on same session")
	}
	var terminated bool
	if err = db.QueryRow("SELECT pg_terminate_backend($1)", pid).Scan(&terminated); err != nil || !terminated {
		t.Fatal("owned candidate session was not terminated")
	}
	if err = <-finished; err == nil {
		t.Fatal("lost candidate connection reported successful commit")
	}
	if err = holder.Rollback(); err != nil {
		t.Fatal(err)
	}
	var added int
	if err = db.QueryRow("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='roguelike_command_receipts' AND column_name='response_version'").Scan(&added); err != nil || added != 0 {
		t.Fatal("uncommitted DDL survived process loss")
	}
	if err = db.QueryRow("SELECT count(*) FROM schema_migrations WHERE version LIKE '298_%' OR version LIKE '299_%' OR version LIKE '300_%'").Scan(&added); err != nil || added != 0 {
		t.Fatal("ledger survived aborted DDL")
	}
	result, err := NewMigrator(db).RunReleaseAdditive(context.Background(), request)
	if err != nil || len(result.Applied) != 3 {
		t.Fatalf("clean restart failed: %+v %v", result, err)
	}
}
