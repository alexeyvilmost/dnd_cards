package migrations

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// The production SQL names public. Run its unchanged bytes in a separate
// owned database, never in public of the enclosing CI/test database.
func retirementPublicDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}
	target, err := url.Parse(dsn)
	if err != nil || target.Hostname() != "127.0.0.1" || target.User == nil || target.User.Username() != "test_runner" || !regexp.MustCompile(`^/test_[a-f0-9]{24}$`).MatchString(target.Path) {
		t.Fatal("owned loopback test database required")
	}
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal("owned database connection unavailable")
	}
	var marker string
	if err = admin.QueryRow("SELECT current_database()||':'||run_id FROM public.test_run_ownership").Scan(&marker); err != nil || marker != target.Path[1:]+":"+target.Path[1:] {
		admin.Close()
		t.Fatal("owned database marker differs")
	}
	var suffix [12]byte
	if _, err = rand.Read(suffix[:]); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	name := "test_" + hex.EncodeToString(suffix[:])
	if _, err = admin.Exec("CREATE DATABASE " + name); err != nil {
		admin.Close()
		t.Fatal("owned child database creation failed")
	}
	target.Path = "/" + name
	q := target.Query()
	q.Set("search_path", "public")
	target.RawQuery = q.Encode()
	db, err := sql.Open("pgx", target.String())
	if err != nil {
		_, _ = admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
		admin.Close()
		t.Fatal("child connection failed")
	}
	t.Cleanup(func() {
		db.Close()
		if _, err := admin.Exec("DROP DATABASE " + name + " WITH (FORCE)"); err != nil {
			t.Error("owned child cleanup failed")
		}
		admin.Close()
	})
	return db
}

func explicitRetirementFixture(t *testing.T) (*sql.DB, ReleaseRetirementExecutionRequest) {
	t.Helper()
	db, ordinary := releaseFixtureOn(t, retirementPublicDatabase(t))
	expansion, err := NewMigrator(db).RunReleaseAdditive(context.Background(), ordinary)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE characters(id integer PRIMARY KEY,user_id integer,payload jsonb);INSERT INTO characters VALUES(10,1,'{"old":1}');
	CREATE TABLE characters_v2(id integer PRIMARY KEY,user_id integer,payload jsonb);INSERT INTO characters_v2 VALUES(20,2,'{"old":2,"different":[2,3]}');
	ALTER TABLE characters_v3 ADD COLUMN payload jsonb;
	INSERT INTO characters_v3(id,payload,deleted_at) VALUES('33333333-3333-4333-8333-333333333333','{"current":true}',NULL),('44444444-4444-4444-8444-444444444444','{"deleted":true}','2026-10-01T00:00:00Z');
	INSERT INTO roguelike_runs(id,user_id,deleted_at) VALUES(1,'55555555-5555-4555-8555-555555555555',NULL),(2,'55555555-5555-4555-8555-555555555555','2026-10-02T00:00:00Z');
	CREATE TABLE inventories(id integer PRIMARY KEY,type varchar,user_id integer,group_id integer,character_id integer,payload jsonb);
	INSERT INTO inventories VALUES(1,'character',1,NULL,10,'{"retired":1}'),(2,'character',NULL,NULL,20,'{"retired":2}'),(3,'personal',1,NULL,NULL,'{"keep":true}');
	CREATE TABLE inventory_items(id integer PRIMARY KEY,inventory_id integer REFERENCES inventories(id) ON DELETE CASCADE,payload jsonb);
	INSERT INTO inventory_items VALUES(1,1,'{"retired":1}'),(2,2,'{"retired":2}'),(3,3,'{"keep":true}');`)
	if err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err = db.QueryRow(`SELECT jsonb_object_agg(name,preimage) FROM (
	SELECT 'characters' AS name,jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY t.id),''),'UTF8')),'hex')) AS preimage FROM characters t
	UNION ALL SELECT 'characters_v2',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY t.id),''),'UTF8')),'hex')) FROM characters_v2 t
	UNION ALL SELECT 'retired_inventories',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY t.id),''),'UTF8')),'hex')) FROM inventories t WHERE type='character'
	UNION ALL SELECT 'retired_items',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY t.id),''),'UTF8')),'hex')) FROM inventory_items t JOIN inventories i ON i.id=t.inventory_id WHERE i.type='character') rows`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	r := testRetirementRequest()
	if err = json.Unmarshal(raw, &r.Preimages); err != nil {
		t.Fatal(err)
	}
	return db, ReleaseRetirementExecutionRequest{SchemaVersion: 1, Kind: "execute-character-retirement-302", ReleaseID: "owned-explicit-retirement", ExpectedCurrent: ordinary.Target, SQLSourceHash: RetirementMigrationIdentity().Checksum, ExpectedAdditiveSchemaProofHash: expansion.SchemaProofHash, Retirement: r}
}

func TestExplicitRetirementAtomicExecutionRetryAndReconciliation(t *testing.T) {
	for _, name := range []string{"valid-repeat-and-later-gameplay", "stale-retired-row", "late-dependent-view", "different-additive-proof", "unknown-ledger"} {
		t.Run(name, func(t *testing.T) {
			db, request := explicitRetirementFixture(t)
			mutation := map[string]string{"stale-retired-row": `UPDATE characters_v2 SET payload='{"changed":true}'`, "late-dependent-view": `CREATE VIEW stale_legacy_view AS SELECT id FROM characters`, "unknown-ledger": `INSERT INTO schema_migrations(version) VALUES('999_unknown')`}[name]
			if mutation != "" {
				if _, err := db.Exec(mutation); err != nil {
					t.Fatal(err)
				}
			}
			if name == "different-additive-proof" {
				request.ExpectedAdditiveSchemaProofHash = "sha256:" + strings.Repeat("d", 64)
			}
			const snapshot = `SELECT jsonb_build_object('ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM schema_migrations t),'inventories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventories t),'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_items t),'v3',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM characters_v3 t),'runCommands',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM roguelike_command_receipts t),'characterCommands',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM character_runtime_commands t))::text`
			var before, after string
			if err := db.QueryRow(snapshot).Scan(&before); err != nil {
				t.Fatal(err)
			}
			m := NewMigrator(db)
			const lifecycleSnapshot = `SELECT jsonb_build_object('v3',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM characters_v3 t),'runs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM roguelike_runs t))::text`
			var lifecycleBefore, lifecycleAfter string
			if snapshotErr := db.QueryRow(lifecycleSnapshot).Scan(&lifecycleBefore); snapshotErr != nil {
				t.Fatal(snapshotErr)
			}
			first, err := m.RunReleaseRetirement(context.Background(), request)
			if snapshotErr := db.QueryRow(lifecycleSnapshot).Scan(&lifecycleAfter); snapshotErr != nil || lifecycleAfter != lifecycleBefore {
				t.Fatal("retirement changed current or deleted V3 characters and runs", snapshotErr)
			}
			if name != "valid-repeat-and-later-gameplay" {
				if err == nil {
					t.Fatal("drift accepted")
				}
				if err = db.QueryRow(snapshot).Scan(&after); err != nil || after != before {
					t.Fatal("failed retirement left partial changes")
				}
				var locks int
				if err = db.QueryRow("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND a.datname=current_database()").Scan(&locks); err != nil || locks != 0 {
					t.Fatal("failed execution retained a session or transaction lock")
				}
				connection, err := db.Conn(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				var locked bool
				if err = connection.QueryRowContext(context.Background(), "SELECT pg_try_advisory_lock($1)", migrationAdvisoryLockID).Scan(&locked); err != nil || !locked {
					t.Fatal("failed execution retained lock")
				}
				if err = releaseAdvisoryLock(context.Background(), connection); err != nil {
					t.Fatal(err)
				}
				return
			}
			if err != nil || !reflect.DeepEqual(first.Applied, []string{retirement302Version}) || len(first.Inspection.Applied) != 0 {
				t.Fatal("explicit execution not observed", err)
			}
			second, err := m.RunReleaseRetirement(context.Background(), request)
			if err != nil || len(second.Applied) != 0 || !reflect.DeepEqual(first.Request, second.Request) || !reflect.DeepEqual(first.Inspection, second.Inspection) {
				t.Fatal("same-request reconciliation differs", err)
			}
			if _, err = db.Exec(`UPDATE characters_v3 SET payload='{"playedAfterRetirement":true}';UPDATE inventory_items SET payload='{"current":2}' WHERE id=3`); err != nil {
				t.Fatal(err)
			}
			if err = db.QueryRow(snapshot).Scan(&before); err != nil {
				t.Fatal(err)
			}
			third, err := m.RunReleaseRetirement(context.Background(), request)
			if err != nil || len(third.Applied) != 0 || !reflect.DeepEqual(first.Inspection, third.Inspection) {
				t.Fatal("gameplay broke read-only repeat", err)
			}
			// Layout-only fixtures for the old-reader predicate, not codec replay
			// evidence. Both command stores can require the current reader after
			// retirement without changing its accepted structural proof.
			for _, table := range []string{"roguelike_command_receipts", "character_runtime_commands"} {
				if _, err = db.Exec("INSERT INTO " + table + "(id,response,response_version,response_payload,response_sha256,response_length) VALUES(2,'{}',2,'x',repeat('a',64),1)"); err != nil {
					t.Fatal(err)
				}
				if err = db.QueryRow(snapshot).Scan(&before); err != nil {
					t.Fatal(err)
				}
				expected := first.Inspection
				expected.RollbackReadersSafe = false
				current, err := m.RunReleaseRetirement(context.Background(), request)
				if err != nil || len(current.Applied) != 0 || !reflect.DeepEqual(current.Inspection, expected) || !reflect.DeepEqual(current.Request, first.Request) {
					t.Fatal("current-reader requirement changed the accepted retirement proof", err)
				}
				if err = db.QueryRow(snapshot).Scan(&after); err != nil || after != before {
					t.Fatal("read-only reconciliation changed current-format fixtures")
				}
			}
			changed := request
			changed.Retirement.BackupHash = "sha256:" + strings.Repeat("d", 64)
			if _, err = m.RunReleaseRetirement(context.Background(), changed); err == nil {
				t.Fatal("different request replaced retirement")
			}
			if err = db.QueryRow(snapshot).Scan(&after); err != nil || after != before {
				t.Fatal("repeat changed gameplay or receipt")
			}
		})
	}
}
