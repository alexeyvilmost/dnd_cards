package migrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"
)

// External archive/backup/reader proofs belong to the release controller. This
// explicit low-level operation binds its accepted request; hashes alone do not
// authorize a production retirement or attest those external files.
type ReleaseRetirementExecutionRequest struct {
	SchemaVersion                   int                 `json:"schemaVersion"`
	Kind                            string              `json:"kind"`
	ReleaseID                       string              `json:"releaseId"`
	ExpectedCurrent                 []MigrationIdentity `json:"expectedCurrent"`
	SQLSourceHash                   string              `json:"sqlSourceHash"`
	ExpectedAdditiveSchemaProofHash string              `json:"expectedAdditiveSchemaProofHash"`
	Retirement                      RetirementRequest   `json:"retirement"`
	CandidateSourceCommit           string              `json:"candidateSourceCommit"`
	CandidateInputFingerprint       string              `json:"candidateInputFingerprint"`
}

type ReleaseRetirementExecutionResult struct {
	SchemaVersion int                                `json:"schemaVersion"`
	Status        string                             `json:"status"`
	ReleaseID     string                             `json:"releaseId"`
	Applied       []string                           `json:"applied"`
	Request       ReleaseRetirementInspectionRequest `json:"request"`
	Inspection    ReleaseRetirementInspectionResult  `json:"inspection"`
}

func validateRetirementExecution(request ReleaseRetirementExecutionRequest) (map[string]string, error) {
	if request.SchemaVersion != 1 || request.Kind != "execute-character-retirement-301" || request.ReleaseID == "" ||
		request.SQLSourceHash != RetirementMigrationIdentity().Checksum || !validIdentityHash(request.ExpectedAdditiveSchemaProofHash) || !validRetirementRequest(request.Retirement) {
		return nil, errors.New("invalid explicit retirement execution request")
	}
	before, _, err := validateReleaseMigrationRequest(ReleaseMigrationRequest{SchemaVersion: 1, ReleaseID: request.ReleaseID, ExpectedCurrent: request.ExpectedCurrent, Target: request.ExpectedCurrent})
	if err != nil {
		return nil, errors.New("unsupported explicit retirement baseline")
	}
	return before, nil
}

// Startup and --migrate-release never call this method. The exact SQL source
// owns the atomic DDL/retired-row deletion/ledger transaction and row guards.
// An uncertain commit must be reconciled with this same request; app rollback
// must not restore a database snapshot.
func (m *Migrator) RunReleaseRetirement(ctx context.Context, request ReleaseRetirementExecutionRequest) (result ReleaseRetirementExecutionResult, runErr error) {
	before, err := validateRetirementExecution(request)
	if err != nil {
		return result, err
	}
	connection, err := m.acquireAdvisoryLock(ctx)
	if err != nil {
		return result, errors.New("explicit retirement lock unavailable")
	}
	released := false
	defer func() {
		if !released {
			releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			// A failed multi-statement program can leave BEGIN aborted. Never
			// return a pooled connection holding a lock in that transaction.
			_, _ = connection.ExecContext(releaseCtx, "ROLLBACK")
			if releaseAdvisoryLock(releaseCtx, connection) != nil && runErr == nil {
				runErr = errors.New("explicit retirement lock release failed")
			}
		}
	}()
	raw, err := retirementExecutionPreflight(ctx, connection, request, before)
	if err != nil {
		return result, err
	}
	applied := []string{}
	if len(raw) == 0 {
		encoded, err := json.Marshal(request.Retirement)
		if err != nil || strings.Count(string(retirement301Source), ":'retirement_request'") != 1 {
			return result, errors.New("retirement source binding unavailable")
		}
		// JSON is a SQL string value, never an SQL fragment or shell argument.
		literal := "'" + strings.ReplaceAll(string(encoded), "'", "''") + "'"
		program := strings.Replace(string(retirement301Source), ":'retirement_request'", literal, 1)
		if _, err = connection.ExecContext(ctx, program); err != nil {
			return result, errors.New("retirement rejected or commit outcome unknown")
		}
		if err = connection.QueryRowContext(ctx, "SELECT description FROM public.schema_migrations WHERE version=$1", retirement301Version).Scan(&raw); err != nil {
			return result, errors.New("retirement receipt unavailable after execution")
		}
		applied = append(applied, retirement301Version)
	}
	receipt, err := decodeRetirementReceipt(raw)
	if err != nil || !reflect.DeepEqual(receipt.Request, request.Retirement) {
		return result, errors.New("retirement receipt belongs to another request")
	}
	inspectionRequest := ReleaseRetirementInspectionRequest{SchemaVersion: 1, Kind: "inspect-character-retirement-301", ReleaseID: request.ReleaseID,
		ExpectedCurrent: append(append([]MigrationIdentity{}, request.ExpectedCurrent...), RetirementMigrationIdentity()), SQLSourceHash: request.SQLSourceHash,
		ExpectedAdditiveSchemaProofHash: request.ExpectedAdditiveSchemaProofHash, ReceiptHash: hashBytes(raw), Retirement: request.Retirement,
		CandidateSourceCommit: request.CandidateSourceCommit, CandidateInputFingerprint: request.CandidateInputFingerprint}
	// Inspection takes the same advisory lock on its own read-only connection.
	// Release this one first; any intervening drift is rejected by inspection.
	releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = releaseAdvisoryLock(releaseCtx, connection)
	cancel()
	released = true
	if err != nil {
		return result, errors.New("explicit retirement lock release failed")
	}
	inspection, err := m.InspectReleaseRetirement(ctx, inspectionRequest)
	if err != nil {
		return result, errors.New("retirement applied or observed; read-only reconciliation required")
	}
	return ReleaseRetirementExecutionResult{1, "verified", request.ReleaseID, applied, inspectionRequest, inspection}, nil
}

func retirementExecutionPreflight(ctx context.Context, connection *sql.Conn, request ReleaseRetirementExecutionRequest, before map[string]string) ([]byte, error) {
	var public bool
	if err := connection.QueryRowContext(ctx, "SELECT current_schema()='public'").Scan(&public); err != nil || !public {
		return nil, errors.New("explicit public retirement target required")
	}
	tx, err := connection.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, errors.New("retirement preflight transaction unavailable")
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SET LOCAL search_path=public; SET LOCAL TimeZone='UTC'; SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'"); err != nil {
		return nil, errors.New("retirement preflight configuration failed")
	}
	var guarded bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.schema_migrations') AND relkind='r' AND NOT relrowsecurity AND NOT relforcerowsecurity AND NOT relispartition)
	 AND NOT EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=to_regclass('public.schema_migrations') AND rulename<>'_RETURN')
	 AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.schema_migrations') AND NOT tgisinternal)`).Scan(&guarded); err != nil || !guarded {
		return nil, errors.New("unguarded retirement ledger")
	}
	versions, err := observedVersions(ctx, tx)
	if err != nil {
		return nil, errors.New("retirement baseline observation failed")
	}
	var raw []byte
	err = tx.QueryRowContext(ctx, "SELECT description FROM public.schema_migrations WHERE version=$1", retirement301Version).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		return nil, errors.New("retirement receipt observation failed")
	}
	expected := sortedIdentityIDs(before)
	if err == nil {
		receipt, decodeErr := decodeRetirementReceipt(raw)
		if decodeErr != nil || !reflect.DeepEqual(receipt.Request, request.Retirement) {
			return nil, errors.New("retirement already has another or unknown receipt")
		}
		expected = sortedIdentityIDs(addRetirementIdentity(before, request.SQLSourceHash))
	}
	if !reflect.DeepEqual(versions, expected) {
		return nil, errors.New("retirement baseline differs from exact accepted identities")
	}
	additive, err := captureAdditiveSchema(ctx, tx)
	if err != nil {
		return nil, errors.New("retirement retained additive observation failed")
	}
	encoded, err := json.Marshal(additive)
	if err != nil || hashBytes(encoded) != request.ExpectedAdditiveSchemaProofHash {
		return nil, errors.New("retirement retained additive schema differs from accepted proof")
	}
	if err = tx.Commit(); err != nil {
		return nil, errors.New("retirement preflight outcome unknown")
	}
	return raw, nil
}

func addRetirementIdentity(before map[string]string, checksum string) map[string]string {
	target := make(map[string]string, len(before)+1)
	for key, value := range before {
		target[key] = value
	}
	target[retirement301Version] = checksum
	return target
}
