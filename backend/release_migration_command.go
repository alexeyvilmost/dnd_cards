package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"time"

	"dnd-cards-backend/migrations"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Runs before .env, HTTP, image jobs or application constructors. The DSN stays
// in the one-off container environment; the request contains no credentials.
func runReleaseMigrationCommand(args []string, input io.Reader, output io.Writer) (bool, error) {
	if len(args) == 0 || (args[0] != "--migrate-release" && args[0] != "--inspect-release-migrations" && args[0] != "--inspect-character-retirement" && args[0] != "--execute-character-retirement" && args[0] != "--reconcile-character-retirement") {
		return false, nil
	}
	if len(args) != 1 {
		return true, errors.New("migration request must be supplied on stdin")
	}
	// A truncated reader can report EOF after an otherwise valid JSON object
	// and hide oversized trailing input. Reject the actual byte limit first.
	payload, err := io.ReadAll(io.LimitReader(input, 512*1024+1))
	if err != nil || len(payload) > 512*1024 {
		return true, errors.New("one bounded migration request required")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var request migrations.ReleaseMigrationRequest
	var retirement migrations.ReleaseRetirementInspectionRequest
	var execution migrations.ReleaseRetirementExecutionRequest
	var decoded any = &request
	if args[0] == "--inspect-character-retirement" {
		decoded = &retirement
	} else if args[0] == "--execute-character-retirement" || args[0] == "--reconcile-character-retirement" {
		decoded = &execution
	}
	if decoder.Decode(decoded) != nil {
		return true, errors.New("invalid release migration request")
	}
	var extra interface{}
	if decoder.Decode(&extra) != io.EOF {
		return true, errors.New("one bounded migration request required")
	}
	releaseID, sourceCommit, fingerprint := request.ReleaseID, request.CandidateSourceCommit, request.CandidateInputFingerprint
	if args[0] == "--inspect-character-retirement" {
		releaseID, sourceCommit, fingerprint = retirement.ReleaseID, retirement.CandidateSourceCommit, retirement.CandidateInputFingerprint
	} else if args[0] == "--execute-character-retirement" || args[0] == "--reconcile-character-retirement" {
		releaseID, sourceCommit, fingerprint = execution.ReleaseID, execution.CandidateSourceCommit, execution.CandidateInputFingerprint
	}
	if !releaseIDPattern.MatchString(releaseID) || deployedSourceCommit() == "unavailable" || sourceCommit != componentSourceCommit || fingerprint != componentInputFingerprint {
		return true, errors.New("migration executor must match verified baked candidate identity")
	}
	dsn := os.Getenv("DATABASE_URL")
	target, err := url.Parse(dsn)
	if err != nil || len(dsn) > 8192 || target.Hostname() == "" || (target.Scheme != "postgres" && target.Scheme != "postgresql") {
		return true, errors.New("explicit DATABASE_URL required for migration executor")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return true, errors.New("migration database connection unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var result any
	if args[0] == "--inspect-character-retirement" {
		result, err = migrations.NewMigrator(db).InspectReleaseRetirement(ctx, retirement)
	} else if args[0] == "--execute-character-retirement" {
		result, err = migrations.NewMigrator(db).RunReleaseRetirement(ctx, execution)
	} else if args[0] == "--reconcile-character-retirement" {
		result, err = migrations.NewMigrator(db).ReconcileReleaseRetirement(ctx, execution)
	} else if args[0] == "--inspect-release-migrations" {
		result, err = migrations.NewMigrator(db).InspectReleaseAdditive(ctx, request)
	} else {
		result, err = migrations.NewMigrator(db).RunReleaseAdditive(ctx, request)
	}
	if err != nil {
		_ = json.NewEncoder(output).Encode(map[string]interface{}{"schemaVersion": 1, "status": "failed_or_unknown", "releaseId": releaseID, "code": "migration-reconcile-required"})
		return true, errors.New("migration rejected or outcome unknown; inspect ledger and replay only the same verified request")
	}
	return true, json.NewEncoder(output).Encode(map[string]interface{}{"schemaVersion": 1, "status": "verified", "result": result, "build": componentBuildIdentity()})
}
