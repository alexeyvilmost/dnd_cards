package main

import (
	"encoding/json"
	"io"
	"os"
	"regexp"
	"runtime"
	"strings"

	"dnd-cards-backend/migrations"
)

// Image-contract inspection exits before configuration/database initialization.
func writeBuildIdentityCommand(args []string, output io.Writer) bool {
	if len(args) != 1 || (args[0] != "--build-info" && args[0] != "--migration-info") {
		return false
	}
	if args[0] == "--migration-info" {
		versions := make([]string, 0)
		for _, migration := range migrations.GetAllMigrations() {
			versions = append(versions, migration.Version)
		}
		// Historical DB rows do not contain source checksums. Never invent them.
		_ = json.NewEncoder(output).Encode(map[string]interface{}{"schemaVersion": 1, "versions": versions, "retiredObservedMigrationIds": migrations.RetiredObservedMigrationIDs(), "supportedRetirementMigrations": []migrations.MigrationIdentity{migrations.RetirementMigrationIdentity()}, "checksums": "unavailable", "additiveMigrations": migrations.AdditiveMigrationIdentities(), "migrationLockId": migrations.MigrationAdvisoryLockIdentity(), "build": componentBuildIdentity()})
		return true
	}
	_ = json.NewEncoder(output).Encode(componentBuildIdentity())
	return true
}

var gitCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var buildFingerprintPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var releaseIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

// Source-owned reader protocol versions, independent of writer feature flags.
// The surrounding baked source/input identity binds these claims to image bytes.
const receiptReaderV1 = "receipt-v1"
const receiptReaderV2 = "receipt-v2"
const imageJobReaderV1 = "image-job-v1"

// Set only by the build's -ldflags. Runtime SOURCE_COMMIT is not provenance.
var componentSourceCommit string
var componentInputFingerprint string

// deployedSourceCommit retains the existing wire alias with truthful semantics.
func deployedSourceCommit() string {
	if !gitCommitPattern.MatchString(componentSourceCommit) || !buildFingerprintPattern.MatchString(componentInputFingerprint) {
		return "unavailable"
	}
	return componentSourceCommit
}

func componentBuildIdentity() map[string]interface{} {
	commit := deployedSourceCommit()
	provenance, fingerprint := "unverified", ""
	if commit != "unavailable" {
		provenance, fingerprint = "baked", componentInputFingerprint
	}
	releaseCommit, releaseID := strings.TrimSpace(os.Getenv("RELEASE_COMMIT")), strings.TrimSpace(os.Getenv("RELEASE_ID"))
	if !gitCommitPattern.MatchString(releaseCommit) {
		releaseCommit = ""
	}
	if !releaseIDPattern.MatchString(releaseID) {
		releaseID = ""
	}
	return map[string]interface{}{
		"identitySchemaVersion": 1, "component": "backend", "provenance": provenance,
		"sourceCommit": commit, "source_commit": commit, "inputFingerprint": fingerprint,
		"releaseCommit": releaseCommit, "releaseId": releaseID, "apiProtocolVersion": 1,
		"goRuntime":          runtime.Version(),
		"readerCapabilities": []string{receiptReaderV1, receiptReaderV2, imageJobReaderV1},
	}
}
