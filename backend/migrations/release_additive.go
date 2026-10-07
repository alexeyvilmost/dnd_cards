package migrations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"time"
)

type additiveExecer interface {
	Exec(string, ...interface{}) (sql.Result, error)
}

// Only these reviewed, reentrant expansions can be run before cutover. The
// historical Migrator.Run API and historical migration implementations remain.
//
//go:embed compact_receipts_298.go frozen_catalogs_299.go image_jobs_300.go character_lifecycle_301.go catalog_presentation_schema_307.sql catalog_presentation_schema_307.go
var additiveSources embed.FS

type MigrationIdentity struct {
	ID              string `json:"id"`
	Checksum        string `json:"checksum,omitempty"`
	Kind            string `json:"kind,omitempty"`
	ObservationHash string `json:"observationHash,omitempty"`
}
type ReleaseMigrationRequest struct {
	SchemaVersion             int                 `json:"schemaVersion"`
	Kind                      string              `json:"kind,omitempty"`
	ExpectedCurrentIDs        []string            `json:"expectedCurrentIds,omitempty"`
	BaselineObservationHash   string              `json:"baselineObservationHash,omitempty"`
	ReleaseID                 string              `json:"releaseId"`
	ExpectedCurrent           []MigrationIdentity `json:"expectedCurrent"`
	Target                    []MigrationIdentity `json:"target"`
	CandidateSourceCommit     string              `json:"candidateSourceCommit"`
	CandidateInputFingerprint string              `json:"candidateInputFingerprint"`
}
type ReleaseMigrationResult struct {
	SchemaVersion           int      `json:"schemaVersion"`
	Status                  string   `json:"status"`
	ReleaseID               string   `json:"releaseId"`
	ObservedVersions        []string `json:"observedVersions"`
	SchemaProofHash         string   `json:"schemaProofHash"`
	Applied                 []string `json:"applied"`
	RollbackReadersSafe     bool     `json:"rollbackReadersSafe"`
	BaselineObservationHash string   `json:"baselineObservationHash,omitempty"`
}
type additiveMigration struct {
	id, source string
	up         func(additiveExecer) error
}

func additiveRegistry() []additiveMigration {
	return []additiveMigration{
		{compactReceipts298Version, "compact_receipts_298.go", addCompactReceipts298On},
		{frozenCatalogs299Version, "frozen_catalogs_299.go", addFrozenCatalogs299On},
		{"300_image_jobs", "image_jobs_300.go", addImageJobs300On},
		{"301_character_lifecycle", "character_lifecycle_301.go", addCharacterLifecycle301On},
		{"307_catalog_presentation", "catalog_presentation_schema_307.sql", addCatalogPresentation307On},
	}
}
func hashBytes(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return "sha256:" + hex.EncodeToString(sum[:])
}
func AdditiveMigrationIdentities() []MigrationIdentity {
	result := make([]MigrationIdentity, 0, len(additiveRegistry()))
	for _, migration := range additiveRegistry() {
		source, err := additiveSources.ReadFile(migration.source)
		if err != nil {
			panic(err)
		}
		if migration.id == "307_catalog_presentation" {
			executor, err := additiveSources.ReadFile("catalog_presentation_schema_307.go")
			if err != nil {
				panic(err)
			}
			source = append(append(executor, []byte("\n--embedded-ddl--\n")...), source...)
		}
		result = append(result, MigrationIdentity{ID: migration.id, Checksum: hashBytes(source)})
	}
	return result
}

// Read-only metadata for exact-executable lock rehearsal; not a fault switch.
func MigrationAdvisoryLockIdentity() string { return fmt.Sprintf("%d", migrationAdvisoryLockID) }
func registryVersions() []string {
	var ids []string
	for _, m := range GetAllMigrations() {
		ids = append(ids, m.Version)
	}
	sort.Strings(ids)
	return ids
}

// These IDs survive in the checked-in 297 ledger and observed deployments.
// They are retained observations, never executable aliases or source checksums.
var retiredObservedMigrationIDs = map[string]bool{
	"011_add_detailed_description_formatting":     true,
	"096_register_micro_mvp_rules_release":        true,
	"097_repair_micro_mvp_rules_release_identity": true,
	"098_repair_magic_initiate_2024":              true,
}

func RetiredObservedMigrationIDs() []string {
	ids := make([]string, 0, len(retiredObservedMigrationIDs))
	for id := range retiredObservedMigrationIDs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func sortedIdentityIDs(rows map[string]string) []string {
	ids := make([]string, 0, len(rows))
	for id := range rows {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
func identityMap(rows []MigrationIdentity) (map[string]string, error) {
	result := map[string]string{}
	observation := ""
	for _, row := range rows {
		if row.ID == "" {
			return nil, errors.New("invalid migration identity")
		}
		identity := row.Checksum
		if row.Kind == "observed-id-only" && row.Checksum == "" && validIdentityHash(row.ObservationHash) {
			if observation != "" && observation != row.ObservationHash {
				return nil, errors.New("mixed historical observations")
			}
			observation = row.ObservationHash
			// A tagged observation token, deliberately not a source checksum.
			identity = "observed-id-only:" + row.ObservationHash
		} else if row.Kind != "" || row.ObservationHash != "" || !validIdentityHash(row.Checksum) {
			return nil, errors.New("invalid migration checksum or observation")
		}
		if _, exists := result[row.ID]; exists {
			return nil, errors.New("duplicate migration identity")
		}
		result[row.ID] = identity
	}
	return result, nil
}
func validIdentityHash(value string) bool {
	if len(value) != 71 || value[:7] != "sha256:" {
		return false
	}
	_, err := hex.DecodeString(value[7:])
	return err == nil
}
func validateReleaseMigrationRequest(request ReleaseMigrationRequest) (map[string]string, map[string]string, error) {
	if (request.SchemaVersion != 1 && request.SchemaVersion != 2) || request.ReleaseID == "" {
		return nil, nil, errors.New("invalid release migration request")
	}
	before, err := identityMap(request.ExpectedCurrent)
	if err != nil {
		return nil, nil, err
	}
	target, err := identityMap(request.Target)
	if err != nil {
		return nil, nil, err
	}
	if request.SchemaVersion == 2 {
		// Observed historical deployments have ledger IDs but no historical
		// checksums. Do not manufacture those checksums from the candidate.
		if request.Kind != "observed-legacy-baseline" || len(request.ExpectedCurrent) != 0 || len(request.ExpectedCurrentIDs) == 0 {
			return nil, nil, errors.New("explicit observed legacy baseline required")
		}
		if !validIdentityHash(request.BaselineObservationHash) {
			return nil, nil, errors.New("legacy observation hash required")
		}
		for _, id := range request.ExpectedCurrentIDs {
			if id == "" {
				return nil, nil, errors.New("invalid observed legacy ID")
			}
			if _, exists := before[id]; exists {
				return nil, nil, errors.New("duplicate observed legacy ID")
			}
			if _, exists := target[id]; !exists {
				return nil, nil, errors.New("observed legacy migration absent from candidate")
			}
			before[id] = target[id] // A tagged ID-only observation, never an applied checksum.
		}
	} else if request.Kind != "" || len(request.ExpectedCurrentIDs) != 0 || request.BaselineObservationHash != "" {
		return nil, nil, errors.New("ambiguous migration baseline format")
	}
	expectedTargetIDs := registryVersions()
	registered := map[string]bool{}
	for _, id := range expectedTargetIDs {
		registered[id] = true
	}
	for id, identity := range before {
		if registered[id] {
			continue
		}
		if !retiredObservedMigrationIDs[id] || len(identity) != len("observed-id-only:")+71 || identity[:len("observed-id-only:")] != "observed-id-only:" {
			return nil, nil, errors.New("unknown or unobserved retired migration")
		}
		expectedTargetIDs = append(expectedTargetIDs, id)
	}
	sort.Strings(expectedTargetIDs)
	if !reflect.DeepEqual(sortedIdentityIDs(target), expectedTargetIDs) {
		return nil, nil, errors.New("target differs from complete embedded migration registry")
	}
	allowed := map[string]string{}
	for _, row := range AdditiveMigrationIdentities() {
		allowed[row.ID] = row.Checksum
	}
	if request.SchemaVersion == 2 {
		for id := range before {
			if _, knownSource := allowed[id]; !knownSource && target[id] != "observed-id-only:"+request.BaselineObservationHash {
				return nil, nil, errors.New("historical target must retain exact observed ID-only provenance")
			}
		}
	}
	for id, checksum := range before {
		if request.SchemaVersion == 1 && target[id] != checksum {
			return nil, nil, errors.New("baseline migration removed or checksum changed")
		}
	}
	for id, checksum := range target {
		if _, exists := before[id]; !exists && allowed[id] != checksum {
			return nil, nil, errors.New("migration is not an approved additive source")
		}
	}
	for id, checksum := range allowed {
		if supplied, exists := target[id]; exists && supplied != checksum {
			return nil, nil, errors.New("embedded additive migration checksum differs")
		}
	}
	return before, target, nil
}
func observedVersions(ctx context.Context, tx *sql.Tx) ([]string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// RunReleaseAdditive uses the advisory-lock connection for every read, DDL and
// ledger write. DDL + ledger commit atomically; a lost acknowledgement is
// reconciled by re-observation on the same request, never by assuming success.
func (m *Migrator) RunReleaseAdditive(ctx context.Context, request ReleaseMigrationRequest) (ReleaseMigrationResult, error) {
	return m.runReleaseAdditive(ctx, request, nil)
}

func (m *Migrator) InspectReleaseAdditive(ctx context.Context, request ReleaseMigrationRequest) (ReleaseMigrationResult, error) {
	return m.releaseAdditive(ctx, request, nil, true)
}
func (m *Migrator) runReleaseAdditive(ctx context.Context, request ReleaseMigrationRequest, beforeLedger func() error) (result ReleaseMigrationResult, runErr error) {
	return m.releaseAdditive(ctx, request, beforeLedger, false)
}
func (m *Migrator) releaseAdditive(ctx context.Context, request ReleaseMigrationRequest, beforeLedger func() error, inspectOnly bool) (result ReleaseMigrationResult, runErr error) {
	before, target, err := validateReleaseMigrationRequest(request)
	if err != nil {
		return result, err
	}
	connection, err := m.acquireAdvisoryLock(ctx)
	if err != nil {
		return result, errors.New("release migration lock unavailable")
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := releaseAdvisoryLock(releaseCtx, connection); err != nil && runErr == nil {
			runErr = errors.New("migration lock release outcome unknown")
		}
	}()
	tx, err := connection.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'"); err != nil {
		return result, err
	}
	observed, err := observedVersions(ctx, tx)
	if err != nil {
		return result, errors.New("existing inspected migration ledger required")
	}
	present := map[string]bool{}
	for _, id := range observed {
		if _, known := target[id]; !known {
			return result, errors.New("unknown observed migration")
		}
		present[id] = true
	}
	for id := range before {
		if !present[id] {
			return result, errors.New("observed baseline migration missing")
		}
	}
	if inspectOnly && len(present) != len(target) {
		return result, errors.New("target migrations are not installed; inspection does not apply them")
	}
	result = ReleaseMigrationResult{SchemaVersion: 1, Status: "verified", ReleaseID: request.ReleaseID, Applied: []string{}, BaselineObservationHash: request.BaselineObservationHash}
	for _, migration := range additiveRegistry() {
		if present[migration.id] {
			continue
		}
		if _, exists := before[migration.id]; exists {
			return result, errors.New("baseline mismatch")
		}
		if err = migration.up(tx); err != nil {
			return result, fmt.Errorf("additive migration %s failed", migration.id)
		}
		if beforeLedger != nil {
			if err = beforeLedger(); err != nil {
				return result, err
			}
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO schema_migrations(version,description,executed_at) VALUES($1,$2,NOW())", migration.id, "Reviewed additive release expansion"); err != nil {
			return result, errors.New("migration ledger write failed")
		}
		result.Applied = append(result.Applied, migration.id)
	}
	proof, err := verifyAdditiveSchema(ctx, tx)
	if err != nil {
		return result, err
	}
	result.SchemaProofHash = hashBytes(proof)
	result.ObservedVersions, err = observedVersions(ctx, tx)
	if err != nil {
		return result, err
	}
	if !reflect.DeepEqual(result.ObservedVersions, sortedIdentityIDs(target)) {
		return result, errors.New("post-migration registry mismatch")
	}
	result.RollbackReadersSafe, err = oldReadersSafe(ctx, tx, (lifecycleRetainsWriterFormats(before, target) || presentationRetainsWriterFormats(before, target)))
	if err != nil {
		return result, err
	}
	if err = tx.Commit(); err != nil {
		return result, errors.New("migration commit outcome unknown; re-observe same request")
	}
	return result, nil
}

// The preceding exact schema already declared compact receipts and image jobs.
// Only 301 adds nullable lifecycle columns; source/image reader compatibility
// remains a separate required OCI rehearsal, never inferred from this receipt.
func lifecycleRetainsWriterFormats(before, target map[string]string) bool {
	if len(target) != len(before)+1 {
		return false
	}
	if _, exists := before["301_character_lifecycle"]; exists {
		return false
	}
	for id, identity := range before {
		if !reflect.DeepEqual(identity, target[id]) {
			return false
		}
	}
	identities := map[string]string{}
	for _, identity := range AdditiveMigrationIdentities() {
		identities[identity.ID] = identity.Checksum
	}
	if !reflect.DeepEqual(target["301_character_lifecycle"], identities["301_character_lifecycle"]) {
		return false
	}
	for _, id := range []string{compactReceipts298Version, frozenCatalogs299Version, "300_image_jobs"} {
		if !reflect.DeepEqual(before[id], identities[id]) {
			return false
		}
	}
	return true
}

func oldReadersSafe(ctx context.Context, tx *sql.Tx, existingWriterFormats bool) (bool, error) {
	var safe bool
	if existingWriterFormats {
		err := tx.QueryRowContext(ctx, `SELECT NOT EXISTS(SELECT 1 FROM roguelike_command_receipts WHERE response_version NOT IN (1,2))
		 AND NOT EXISTS(SELECT 1 FROM character_runtime_commands WHERE response_version NOT IN (1,2))
		 AND NOT EXISTS(SELECT 1 FROM roguelike_runs WHERE combat_catalog_ref IS NOT NULL)
		 AND NOT EXISTS(SELECT 1 FROM image_jobs WHERE state NOT IN ('queued','running','unknown','succeeded','failed'))`).Scan(&safe)
		return safe, err
	}
	err := tx.QueryRowContext(ctx, `SELECT NOT EXISTS(SELECT 1 FROM roguelike_command_receipts WHERE response_version<>1)
	 AND NOT EXISTS(SELECT 1 FROM character_runtime_commands WHERE response_version<>1)
	 AND NOT EXISTS(SELECT 1 FROM roguelike_runs WHERE combat_catalog_ref IS NOT NULL)
	 AND NOT EXISTS(SELECT 1 FROM image_jobs WHERE state IN ('queued','running','unknown'))`).Scan(&safe)
	return safe, err
}

func presentationRetainsWriterFormats(before, target map[string]string) bool {
	if len(target) != len(before)+1 || before["307_catalog_presentation"] != "" {
		return false
	}
	for id, identity := range before {
		if target[id] != identity {
			return false
		}
	}
	for _, identity := range AdditiveMigrationIdentities() {
		if identity.ID == "307_catalog_presentation" {
			if target[identity.ID] != identity.Checksum {
				return false
			}
		} else if before[identity.ID] != identity.Checksum {
			return false
		}
	}
	return true
}
