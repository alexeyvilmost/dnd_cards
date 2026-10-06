package migrations

import (
	"bytes"
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"time"
)

const retirement301Version = "301_retire_legacy_characters"

// This is the single reviewed SQL source. It is metadata only in this binary:
// neither startup nor the additive executor registers or executes it.
//
//go:embed data/retire-legacy-characters-301.sql
var retirement301Source []byte

func RetirementMigrationIdentity() MigrationIdentity {
	return MigrationIdentity{ID: retirement301Version, Checksum: hashBytes(retirement301Source)}
}

type RetirementPreimage struct {
	Rows   int64  `json:"rows"`
	SHA256 string `json:"sha256"`
}
type RetirementRequest struct {
	SchemaVersion            int                           `json:"schemaVersion"`
	Kind                     string                        `json:"kind"`
	BackupHash               string                        `json:"backupHash"`
	ArchiveRestoreReportHash string                        `json:"archiveRestoreReportHash"`
	AcceptedRollbackPairHash string                        `json:"acceptedRollbackPairHash"`
	Preimages                map[string]RetirementPreimage `json:"preimages"`
}
type ReleaseRetirementInspectionRequest struct {
	SchemaVersion             int                 `json:"schemaVersion"`
	Kind                      string              `json:"kind"`
	ReleaseID                 string              `json:"releaseId"`
	ExpectedCurrent           []MigrationIdentity `json:"expectedCurrent"`
	SQLSourceHash             string              `json:"sqlSourceHash"`
	ReceiptHash               string              `json:"receiptHash"`
	Retirement                RetirementRequest   `json:"retirement"`
	CandidateSourceCommit     string              `json:"candidateSourceCommit"`
	CandidateInputFingerprint string              `json:"candidateInputFingerprint"`
}
type ReleaseRetirementInspectionResult struct {
	SchemaVersion    int      `json:"schemaVersion"`
	Status           string   `json:"status"`
	ReleaseID        string   `json:"releaseId"`
	ObservedVersions []string `json:"observedVersions"`
	SQLSourceHash    string   `json:"sqlSourceHash"`
	ReceiptHash      string   `json:"receiptHash"`
	SchemaProofHash  string   `json:"schemaProofHash"`
	Applied          []string `json:"applied"`
}
type retirementReceipt struct {
	Kind                    string            `json:"kind"`
	Request                 RetirementRequest `json:"request"`
	RetainedInventoriesHash string            `json:"retainedInventoriesHash"`
	RetainedItemsHash       string            `json:"retainedItemsHash"`
}

func validRetirementRequest(request RetirementRequest) bool {
	if request.SchemaVersion != 1 || request.Kind != "retire-character-generations-301" ||
		!validIdentityHash(request.BackupHash) || !validIdentityHash(request.ArchiveRestoreReportHash) || !validIdentityHash(request.AcceptedRollbackPairHash) || len(request.Preimages) != 4 {
		return false
	}
	for _, key := range []string{"characters", "characters_v2", "retired_inventories", "retired_items"} {
		row, ok := request.Preimages[key]
		if !ok || row.Rows < 0 || !validIdentityHash(row.SHA256) {
			return false
		}
	}
	return true
}
func decodeRetirementReceipt(raw []byte) (retirementReceipt, error) {
	var receipt retirementReceipt
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&receipt) != nil || decoder.Decode(new(any)) != io.EOF || receipt.Kind != "retired-character-generations-receipt" ||
		!validRetirementRequest(receipt.Request) || !validIdentityHash("sha256:"+receipt.RetainedInventoriesHash) || !validIdentityHash("sha256:"+receipt.RetainedItemsHash) {
		return receipt, errors.New("invalid retained retirement receipt")
	}
	return receipt, nil
}

// Read-only observation of an already completed retirement. The caller must
// separately validate the actual backup/archive/reader-pair artifacts; hashes
// here bind that accepted request and do not assert their external existence.
func (m *Migrator) InspectReleaseRetirement(ctx context.Context, request ReleaseRetirementInspectionRequest) (result ReleaseRetirementInspectionResult, runErr error) {
	if request.SchemaVersion != 1 || request.Kind != "inspect-character-retirement-301" || request.ReleaseID == "" ||
		request.SQLSourceHash != RetirementMigrationIdentity().Checksum || !validIdentityHash(request.ReceiptHash) || !validRetirementRequest(request.Retirement) {
		return result, errors.New("invalid retirement inspection request")
	}
	identities, err := identityMap(request.ExpectedCurrent)
	if err != nil || identities[retirement301Version] != request.SQLSourceHash {
		return result, errors.New("exact retirement migration identity required")
	}
	// Validate the complete ordinary registry with 301 removed. This retains
	// historical ID-only provenance and rejects every other unknown migration.
	var ordinary []MigrationIdentity
	for _, row := range request.ExpectedCurrent {
		if row.ID != retirement301Version {
			ordinary = append(ordinary, row)
		}
	}
	if _, _, err = validateReleaseMigrationRequest(ReleaseMigrationRequest{SchemaVersion: 1, ReleaseID: request.ReleaseID, ExpectedCurrent: ordinary, Target: ordinary}); err != nil {
		return result, errors.New("unsupported pre-retirement migration baseline")
	}
	connection, err := m.acquireAdvisoryLock(ctx)
	if err != nil {
		return result, errors.New("retirement inspection lock unavailable")
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if releaseAdvisoryLock(releaseCtx, connection) != nil && runErr == nil {
			runErr = errors.New("retirement inspection lock release failed")
		}
	}()
	tx, err := connection.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return result, errors.New("retirement inspection transaction unavailable")
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; SET LOCAL TimeZone='UTC'"); err != nil {
		return result, errors.New("retirement inspection configuration failed")
	}
	var guarded bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('schema_migrations') AND relkind='r' AND NOT relrowsecurity AND NOT relforcerowsecurity AND NOT relispartition)
	 AND NOT EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=to_regclass('schema_migrations') AND rulename<>'_RETURN')
	 AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('schema_migrations') AND NOT tgisinternal)`).Scan(&guarded); err != nil || !guarded {
		return result, errors.New("unguarded retirement ledger")
	}
	observed, err := observedVersions(ctx, tx)
	if err != nil || !reflect.DeepEqual(observed, sortedIdentityIDs(identities)) {
		return result, errors.New("retirement ledger differs from accepted migration set")
	}
	var raw []byte
	if err = tx.QueryRowContext(ctx, "SELECT description FROM schema_migrations WHERE version=$1", retirement301Version).Scan(&raw); err != nil || hashBytes(raw) != request.ReceiptHash {
		return result, errors.New("retirement receipt differs from accepted observation")
	}
	receipt, err := decodeRetirementReceipt(raw)
	if err != nil || !reflect.DeepEqual(receipt.Request, request.Retirement) {
		return result, errors.New("retirement receipt belongs to another request")
	}
	// These are current structural facts. The retained row hashes in the receipt
	// describe the atomic transition; normal V3 play may change rows afterwards.
	var structure bool
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass('characters') IS NULL AND to_regclass('characters_v2') IS NULL
	 AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('inventories') AND attname='character_id' AND NOT attisdropped)
	 AND (SELECT count(*)=3 FROM pg_class WHERE oid IN (to_regclass('characters_v3'),to_regclass('inventories'),to_regclass('inventory_items')) AND relkind='r' AND NOT relrowsecurity AND NOT relforcerowsecurity AND NOT relispartition)
	 AND NOT EXISTS(SELECT 1 FROM inventories WHERE type='character')`).Scan(&structure); err != nil || !structure {
		return result, errors.New("retirement schema has legacy or missing objects")
	}
	var schema []byte
	if err = tx.QueryRowContext(ctx, `SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated) ORDER BY c.relname,a.attnum),'[]'::jsonb)::text FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE c.oid IN (to_regclass('characters_v3'),to_regclass('inventories'),to_regclass('inventory_items'))`).Scan(&schema); err != nil {
		return result, errors.New("retirement schema observation failed")
	}
	proof := struct {
		SQLSourceHash string          `json:"sqlSourceHash"`
		ReceiptHash   string          `json:"receiptHash"`
		Versions      []string        `json:"versions"`
		Structure     json.RawMessage `json:"structure"`
	}{request.SQLSourceHash, request.ReceiptHash, observed, schema}
	encoded, err := json.Marshal(proof)
	if err != nil {
		return result, errors.New("retirement proof encoding failed")
	}
	if err = tx.Commit(); err != nil {
		return result, errors.New("retirement inspection outcome unknown")
	}
	return ReleaseRetirementInspectionResult{1, "verified", request.ReleaseID, observed, request.SQLSourceHash, request.ReceiptHash, hashBytes(encoded), []string{}}, nil
}

// Used by metadata consumers to distinguish support from executable startup
// migrations. This identity never appears in registryVersions/GetAllMigrations.
func RetirementSupportedMigrationIDs() []string { return []string{retirement301Version} }
