// Dedicated owned FULL public-schema stand only; never the generic Go DB batch.
package migrations

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
)

type baselineMatrixInput struct {
	SchemaVersion           int      `json:"schemaVersion"`
	RunID                   string   `json:"runId"`
	Baseline                int      `json:"baseline"`
	Versions                []string `json:"versions"`
	SchemaHash              string   `json:"schemaHash"`
	ArtifactHash            string   `json:"artifactHash"`
	HistoricalChainVerified bool     `json:"historicalChainVerified"`
}

func baselineMatrixDigest(value []byte) string {
	hash := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(hash[:])
}

func baselineMatrixOwnedDatabase(t *testing.T, input *baselineMatrixInput) *sql.DB {
	t.Helper()
	if os.Getenv("MIGRATION_BASELINE_MATRIX") != "1" {
		t.Fatal("dedicated owned baseline matrix runner required")
	}
	runID := os.Getenv("TEST_RUN_ID")
	if !regexp.MustCompile(`^test_[a-f0-9]{24}$`).MatchString(runID) {
		t.Fatal("owned matrix run identity missing")
	}
	directory := os.Getenv("TEST_RUN_DIRECTORY")
	if !filepath.IsAbs(directory) || filepath.Base(directory) != runID {
		t.Fatal("owned matrix directory missing")
	}
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil || filepath.Clean(resolved) != filepath.Clean(directory) {
		t.Fatal("matrix directory is not a real owned directory")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "baseline-matrix-input.json"))
	if err != nil || json.Unmarshal(raw, input) != nil || input.SchemaVersion != 1 || input.RunID != runID || input.HistoricalChainVerified || input.Baseline < 297 || input.Baseline > 299 || len(input.Versions) == 0 {
		t.Fatal("invalid explicit matrix input")
	}
	for _, hash := range []string{input.SchemaHash, input.ArtifactHash} {
		if !regexp.MustCompile(`^sha256:[a-f0-9]{64}$`).MatchString(hash) {
			t.Fatal("matrix input lacks source hashes")
		}
	}
	dsn := os.Getenv("MIGRATION_BASELINE_DATABASE_URL")
	parsed, err := url.Parse(dsn)
	if err != nil || parsed == nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.User == nil || parsed.User.Username() != "test_runner" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "::1") || parsed.Port() == "" || parsed.Path != "/"+runID || parsed.RawQuery != "sslmode=disable" {
		t.Fatal("matrix DSN must be the explicit runner-owned local database")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal("cannot open owned matrix database")
	}
	db.SetMaxOpenConns(4) // The ordinary startup migrator holds a separate lock connection.
	t.Cleanup(func() { _ = db.Close() })
	var database, address, marker string
	if err = db.QueryRow(`SELECT current_database(),host(inet_server_addr()),run_id FROM public.test_run_ownership`).Scan(&database, &address, &marker); err != nil || database != runID || marker != runID || (address != "127.0.0.1" && address != "::1") {
		t.Fatal("matrix PostgreSQL ownership mismatch")
	}
	return db
}

func baselineMatrixVersions(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT version FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var value string
		if err = rows.Scan(&value); err != nil {
			t.Fatal(err)
		}
		result = append(result, value)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func baselineMatrixColumns(t *testing.T, db *sql.DB) map[string][]string {
	t.Helper()
	rows, err := db.Query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name NOT IN ('schema_migrations','test_run_ownership') ORDER BY table_name,ordinal_position`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := map[string][]string{}
	valid := regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)
	for rows.Next() {
		var table, column string
		if err = rows.Scan(&table, &column); err != nil {
			t.Fatal(err)
		}
		if !valid.MatchString(table) || !valid.MatchString(column) {
			t.Fatal("unsupported baseline identifier")
		}
		result[table] = append(result[table], `"`+column+`"`)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(result) < 50 {
		t.Fatal("matrix requires the full schema baseline")
	}
	return result
}

func baselineMatrixRows(t *testing.T, db *sql.DB, columns map[string][]string) map[string]string {
	t.Helper()
	result := map[string]string{}
	for table, fields := range columns {
		query := fmt.Sprintf(`SELECT coalesce(jsonb_agg(to_jsonb(original) ORDER BY to_jsonb(original)::text),'[]'::jsonb)::text FROM (SELECT %s FROM public."%s") original`, strings.Join(fields, ","), table)
		var raw string
		if err := db.QueryRow(query).Scan(&raw); err != nil {
			t.Fatalf("old-column projection %s: %v", table, err)
		}
		result[table] = baselineMatrixDigest([]byte(raw))
	}
	return result
}

func baselineMatrixLedger(t *testing.T, db *sql.DB, versions []string) string {
	t.Helper()
	rows, err := db.Query(`SELECT version,description,executed_at::text FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for _, id := range versions {
		allowed[id] = true
	}
	var content [][]string
	for rows.Next() {
		var id, description, at string
		if err = rows.Scan(&id, &description, &at); err != nil {
			t.Fatal(err)
		}
		if allowed[id] {
			content = append(content, []string{id, description, at})
		}
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(content) != len(versions) {
		t.Fatal("ledger lost baseline versions")
	}
	raw, _ := json.Marshal(content)
	return baselineMatrixDigest(raw)
}

// Additive columns/tables are allowed; no previously existing definition may
// disappear or change, even when the seeded rows would not expose that change.
func baselineMatrixSchemaObjects(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.Query(`
		SELECT 'column:'||table_name||'.'||column_name, jsonb_build_array(data_type,udt_name,is_nullable,column_default)::text
		FROM information_schema.columns WHERE table_schema='public' AND table_name<>'test_run_ownership'
		UNION ALL SELECT 'constraint:'||r.relname||'.'||c.conname,pg_get_constraintdef(c.oid)
		FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE r.relnamespace='public'::regnamespace AND r.relname<>'test_run_ownership'
		UNION ALL SELECT 'index:'||indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename<>'test_run_ownership'
		UNION ALL SELECT 'trigger:'||c.relname||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled)::text
		FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
		UNION ALL SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
		FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
		UNION ALL SELECT 'table:'||relname,jsonb_build_array(relkind,relpersistence,relrowsecurity,relforcerowsecurity)::text
		FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relname<>'test_run_ownership'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var key, value string
		if err = rows.Scan(&key, &value); err != nil {
			t.Fatal(err)
		}
		if _, exists := result[key]; exists {
			t.Fatal("duplicate schema object identity", key)
		}
		result[key] = value
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func baselineMatrixRetainedSchema(t *testing.T, db *sql.DB, before map[string]string) {
	t.Helper()
	after := baselineMatrixSchemaObjects(t, db)
	for key, value := range before {
		if actual, exists := after[key]; !exists || actual != value {
			t.Fatal("historical schema definition changed:", key)
		}
	}
}

func TestSupportedBaselineUpgradeMatrix(t *testing.T) {
	var input baselineMatrixInput
	db := baselineMatrixOwnedDatabase(t, &input)
	t.Run(fmt.Sprintf("baseline_%d_to_current", input.Baseline), func(t *testing.T) {
		sort.Strings(input.Versions)
		if !reflect.DeepEqual(baselineMatrixVersions(t, db), input.Versions) {
			t.Fatal("imported297 ledger differs from declared fixture")
		}
		var canaries, foreignKeys, triggers int
		if err := db.QueryRow(`SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM characters_v3)+(SELECT count(*) FROM roguelike_runs)+(SELECT count(*) FROM roguelike_command_receipts)+(SELECT count(*) FROM character_runtime_commands)+(SELECT count(*) FROM roguelike_combat_events)+(SELECT count(*) FROM character_events)+(SELECT count(*) FROM actions)+(SELECT count(*) FROM content_review_support_archive)`).Scan(&canaries); err != nil || canaries != 9 {
			t.Fatalf("nonempty FK-connected canaries missing: %d %v", canaries, err)
		}
		if err := db.QueryRow(`SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`).Scan(&foreignKeys); err != nil || foreignKeys < 20 {
			t.Fatal("real full-schema FK set missing", err)
		}
		if err := db.QueryRow(`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)`).Scan(&triggers); err != nil || triggers < 10 {
			t.Fatal("real full-schema trigger set missing", err)
		}
		columns := baselineMatrixColumns(t, db)
		original := baselineMatrixRows(t, db, columns)
		originalSchema := baselineMatrixSchemaObjects(t, db)
		initialLedger := baselineMatrixLedger(t, db, input.Versions)
		migrator := NewMigrator(db)
		registry := GetAllMigrations()
		byID := map[string]Migration{}
		target := []string{}
		for _, migration := range registry {
			if _, found := byID[migration.Version]; found {
				t.Fatal("duplicate registered migration")
			}
			byID[migration.Version] = migration
			target = append(target, migration.Version)
		}
		sort.Strings(target)
		tail := []string{"298_compact_command_receipts", "299_frozen_combat_catalogs", "300_image_jobs", "301_character_lifecycle"}
		expectedTarget := append(append([]string{}, input.Versions...), tail...)
		sort.Strings(expectedTarget)
		// The checked-in schema ledger retains four retired identifiers. They
		// are not executable migrations and must not be silently dropped.
		legacyIDs := []string{"011_add_detailed_description_formatting", "096_register_micro_mvp_rules_release", "097_repair_micro_mvp_rules_release_identity", "098_repair_magic_initiate_2024"}
		missing, extra := []string{}, []string{}
		for _, id := range expectedTarget {
			if _, exists := byID[id]; !exists {
				extra = append(extra, id)
			}
		}
		for _, id := range target {
			if index := sort.SearchStrings(expectedTarget, id); index == len(expectedTarget) || expectedTarget[index] != id {
				missing = append(missing, id)
			}
		}
		if len(missing) != 0 || !reflect.DeepEqual(extra, legacyIDs) {
			t.Fatalf("supported matrix must be explicitly updated for changed migration registry: absent from registry=%v, absent from baseline=%v", extra, missing)
		}
		target = expectedTarget
		prefix := tail[:input.Baseline-297]
		for _, id := range prefix {
			migration, exists := byID[id]
			if !exists || migration.Up == nil {
				t.Fatal("registered prefix missing")
			}
			if err := migration.Up(db); err != nil {
				t.Fatal("prepare intermediate baseline:", err)
			}
			if err := migrator.recordMigration(migration.Version, migration.Description); err != nil {
				t.Fatal(err)
			}
		}
		if !reflect.DeepEqual(original, baselineMatrixRows(t, db, columns)) || initialLedger != baselineMatrixLedger(t, db, input.Versions) {
			t.Fatal("intermediate baseline changed historical rows")
		}
		baselineMatrixRetainedSchema(t, db, originalSchema)
		beforeVersions := baselineMatrixVersions(t, db)
		beforeLedger := baselineMatrixLedger(t, db, beforeVersions)
		// This is the application startup path, not a test copy of additive DDL.
		if err := migrator.Run(); err != nil {
			t.Fatal("startup upgrade:", err)
		}
		if !reflect.DeepEqual(baselineMatrixVersions(t, db), target) {
			t.Fatal("startup ledger differs from exact current registry")
		}
		if beforeLedger != baselineMatrixLedger(t, db, beforeVersions) || !reflect.DeepEqual(original, baselineMatrixRows(t, db, columns)) {
			t.Fatal("upgrade changed historical ledger/old-column row bytes")
		}
		baselineMatrixRetainedSchema(t, db, originalSchema)
		var legacy, unconverted bool
		if err := db.QueryRow(`SELECT (SELECT bool_and(response_version=1 AND response_payload IS NULL AND response_sha256='' AND response_length=0) FROM roguelike_command_receipts) AND (SELECT bool_and(response_version=1 AND response_payload IS NULL AND response_sha256='' AND response_length=0) FROM character_runtime_commands)`).Scan(&legacy); err != nil || !legacy {
			t.Fatal("migration rewrote legacy receipt storage", err)
		}
		if err := db.QueryRow(`SELECT (SELECT bool_and(combat_catalog_ref IS NULL) FROM roguelike_runs) AND NOT EXISTS(SELECT 1 FROM frozen_combat_catalogs) AND NOT EXISTS(SELECT 1 FROM image_jobs)`).Scan(&unconverted); err != nil || !unconverted {
			t.Fatal("migration enabled new format/job writes", err)
		}
		allLedger := baselineMatrixLedger(t, db, target)
		if err := migrator.Run(); err != nil {
			t.Fatal("repeat startup:", err)
		}
		if allLedger != baselineMatrixLedger(t, db, target) || !reflect.DeepEqual(baselineMatrixVersions(t, db), target) || !reflect.DeepEqual(original, baselineMatrixRows(t, db, columns)) {
			t.Fatal("repeat startup rewrote rows or ledger")
		}
		baselineMatrixRetainedSchema(t, db, originalSchema)
		report := map[string]any{"schemaVersion": 1, "status": "passed", "case": input.Baseline, "historicalChainVerified": false, "importedBaseline": "297_retain_generic_spell_free_uses", "sourceSchemaHash": input.SchemaHash, "artifactHash": input.ArtifactHash, "preparedPrefix": prefix, "applied": tail[input.Baseline-297:], "repeatApplied": []string{}, "retiredLedgerIDs": legacyIDs, "baselineLedgerHash": beforeLedger, "finalLedgerHash": allLedger, "oldColumnHashes": original, "legacyTables": len(columns), "canaries": canaries, "foreignKeys": foreignKeys, "triggers": triggers}
		schemaBytes, err := json.Marshal(originalSchema)
		if err != nil {
			t.Fatal(err)
		}
		report["originalSchemaObjects"] = len(originalSchema)
		report["originalSchemaObjectsHash"] = baselineMatrixDigest(schemaBytes)
		raw, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(os.Getenv("TEST_RUN_DIRECTORY"), "baseline-upgrade-case.json")
		out, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = out.Write(append(raw, '\n')); err != nil {
			out.Close()
			t.Fatal(err)
		}
		if err = out.Close(); err != nil {
			t.Fatal(err)
		}
	})
}
