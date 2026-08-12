package migrations

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestMicroMVPRulesReleaseIsRegisteredAfterRuntimeCommandLedger(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != "096_register_micro_mvp_rules_release" {
			continue
		}
		if index == 0 || migrations[index-1].Version != "095_add_character_runtime_commands" {
			t.Fatalf("096 predecessor = %q", migrations[index-1].Version)
		}
		return
	}
	t.Fatal("096_register_micro_mvp_rules_release is not registered")
}

func TestMicroMVPRulesReleaseIdentityRepairIsRegisteredAfterRelease(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != "097_repair_micro_mvp_rules_release_identity" {
			continue
		}
		if index == 0 || migrations[index-1].Version != "096_register_micro_mvp_rules_release" {
			t.Fatalf("097 predecessor = %q", migrations[index-1].Version)
		}
		return
	}
	t.Fatal("097_repair_micro_mvp_rules_release_identity is not registered")
}

func TestMicroMVPManifestHashMatchesCanonicalBytes(t *testing.T) {
	digest := sha256.Sum256([]byte(microMVPManifestCanonical))
	actual := "sha256:" + hex.EncodeToString(digest[:])
	if actual != microMVPManifestHash {
		t.Fatalf("manifest hash = %s, want %s", actual, microMVPManifestHash)
	}
}

func TestMicroMVPRulesReleaseRegistersIdempotentlyOnPostgres(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	if _, err := db.Exec(`
		CREATE EXTENSION IF NOT EXISTS pgcrypto;
		CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY);
		CREATE TABLE IF NOT EXISTS characters_v3 (id UUID PRIMARY KEY);
	`); err != nil {
		t.Fatalf("bootstrap legacy boundary: %v", err)
	}
	if err := createCanonicalRuntime(db); err != nil {
		t.Fatal(err)
	}
	if err := registerMicroMVPRulesRelease(db); err != nil {
		t.Fatal(err)
	}
	if err := registerMicroMVPRulesRelease(db); err != nil {
		t.Fatalf("rules release registration is not idempotent: %v", err)
	}

	var manifestBytes []byte
	var count int
	if err := db.QueryRow(`
		SELECT manifest_canonical_bytes,
			COUNT(*) OVER ()
		FROM ruleset_releases
		WHERE id = $1 AND manifest_hash = $2
	`, microMVPRulesReleaseID, microMVPManifestHash).Scan(&manifestBytes, &count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("registered release rows = %d, want 1", count)
	}
	var artifactVersion string
	if err := db.QueryRow(`SELECT artifact_version FROM ruleset_releases WHERE id = $1`,
		microMVPRulesReleaseID).Scan(&artifactVersion); err != nil {
		t.Fatal(err)
	}
	if artifactVersion != microMVPReleaseID {
		t.Fatalf("artifact_version = %q, want WorldState releaseId %q", artifactVersion, microMVPReleaseID)
	}

	// Exercise the exact production repair path from the 096 prerelease value.
	if _, err := db.Exec(`ALTER TABLE ruleset_releases DISABLE TRIGGER ruleset_releases_append_only`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE ruleset_releases SET artifact_version = '1.0.0' WHERE id = $1`,
		microMVPRulesReleaseID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE ruleset_releases ENABLE TRIGGER ruleset_releases_append_only`); err != nil {
		t.Fatal(err)
	}
	if err := repairMicroMVPRulesReleaseIdentity(db); err != nil {
		t.Fatal(err)
	}
	if err := repairMicroMVPRulesReleaseIdentity(db); err != nil {
		t.Fatalf("release identity repair is not idempotent: %v", err)
	}
	if err := db.QueryRow(`SELECT artifact_version FROM ruleset_releases WHERE id = $1`,
		microMVPRulesReleaseID).Scan(&artifactVersion); err != nil {
		t.Fatal(err)
	}
	if artifactVersion != microMVPReleaseID {
		t.Fatalf("repaired artifact_version = %q, want %q", artifactVersion, microMVPReleaseID)
	}
	if !bytes.Equal(manifestBytes, []byte(microMVPManifestCanonical)) {
		t.Fatalf("manifest canonical bytes = %q", manifestBytes)
	}
}
