package main

import (
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
	if len(args) == 0 || (args[0] != "--migrate-release" && args[0] != "--inspect-release-migrations") {
		return false, nil
	}
	if len(args) != 1 {
		return true, errors.New("migration request must be supplied on stdin")
	}
	decoder := json.NewDecoder(io.LimitReader(input, 512*1024))
	decoder.DisallowUnknownFields()
	var request migrations.ReleaseMigrationRequest
	if decoder.Decode(&request) != nil {
		return true, errors.New("invalid release migration request")
	}
	var extra interface{}
	if decoder.Decode(&extra) != io.EOF {
		return true, errors.New("one bounded migration request required")
	}
	if !releaseIDPattern.MatchString(request.ReleaseID) || deployedSourceCommit() == "unavailable" || request.CandidateSourceCommit != componentSourceCommit || request.CandidateInputFingerprint != componentInputFingerprint {
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
	var result migrations.ReleaseMigrationResult
	if args[0] == "--inspect-release-migrations" {
		result, err = migrations.NewMigrator(db).InspectReleaseAdditive(ctx, request)
	} else {
		result, err = migrations.NewMigrator(db).RunReleaseAdditive(ctx, request)
	}
	if err != nil {
		_ = json.NewEncoder(output).Encode(map[string]interface{}{"schemaVersion": 1, "status": "failed_or_unknown", "releaseId": request.ReleaseID, "code": "migration-reconcile-required"})
		return true, errors.New("migration rejected or outcome unknown; inspect ledger and replay only the same verified request")
	}
	return true, json.NewEncoder(output).Encode(map[string]interface{}{"schemaVersion": 1, "status": "verified", "result": result, "build": componentBuildIdentity()})
}
