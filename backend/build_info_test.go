package main

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"dnd-cards-backend/migrations"
)

func TestBuildIdentityCommand(t *testing.T) {
	var output bytes.Buffer
	if writeBuildIdentityCommand(nil, &output) || writeBuildIdentityCommand([]string{"--build-info", "unexpected"}, &output) {
		t.Fatal("normal startup or unknown args entered inspection mode")
	}
	if !writeBuildIdentityCommand([]string{"--build-info"}, &output) {
		t.Fatal("inspection mode not handled")
	}
	var identity map[string]interface{}
	if err := json.Unmarshal(output.Bytes(), &identity); err != nil || identity["component"] != "backend" {
		t.Fatalf("invalid build info: %v", err)
	}
}

func TestMigrationInfoCommand(t *testing.T) {
	var output bytes.Buffer
	if !writeBuildIdentityCommand([]string{"--migration-info"}, &output) {
		t.Fatal("migration inspection mode not handled")
	}
	var info struct {
		Versions                      []string                       `json:"versions"`
		Checksums                     string                         `json:"checksums"`
		MigrationLockID               string                         `json:"migrationLockId"`
		RetiredObservedMigrationIDs   []string                       `json:"retiredObservedMigrationIds"`
		SupportedRetirementMigrations []migrations.MigrationIdentity `json:"supportedRetirementMigrations"`
	}
	if err := json.Unmarshal(output.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	registered := migrations.GetAllMigrations()
	if !reflect.DeepEqual(info.SupportedRetirementMigrations, []migrations.MigrationIdentity{migrations.RetirementMigrationIdentity()}) {
		t.Fatal("retirement support must bind embedded SQL separately from executable migrations")
	}
	if !reflect.DeepEqual(info.RetiredObservedMigrationIDs, migrations.RetiredObservedMigrationIDs()) {
		t.Fatal("retired observation support must be distinct from executable migration versions")
	}
	if info.MigrationLockID != migrations.MigrationAdvisoryLockIdentity() {
		t.Fatal("exact migration lock must be serialized as a decimal string, not a lossy JSON number")
	}
	if len(info.Versions) != len(registered) || info.Checksums != "unavailable" {
		t.Fatal("incomplete or invented migration provenance")
	}
	for i, migration := range registered {
		if info.Versions[i] != migration.Version {
			t.Fatal("inspection differs from actual executable migrations")
		}
	}
}

func TestComponentBuildIdentity(t *testing.T) {
	oldCommit, oldFingerprint := componentSourceCommit, componentInputFingerprint
	t.Cleanup(func() { componentSourceCommit, componentInputFingerprint = oldCommit, oldFingerprint })
	componentSourceCommit, componentInputFingerprint = strings.Repeat("a", 40), "sha256:"+strings.Repeat("b", 64)
	t.Setenv("SOURCE_COMMIT", strings.Repeat("f", 40))
	t.Setenv("RELEASE_COMMIT", strings.Repeat("c", 40))
	t.Setenv("RELEASE_ID", "new-release-2")
	got := componentBuildIdentity()
	if got["sourceCommit"] != strings.Repeat("a", 40) || got["source_commit"] != got["sourceCommit"] || got["provenance"] != "baked" {
		t.Fatalf("runtime env changed image provenance: %#v", got)
	}
	if got["releaseCommit"] != strings.Repeat("c", 40) || got["releaseId"] != "new-release-2" {
		t.Fatalf("new release identity missing: %#v", got)
	}
	for _, value := range []string{"", "123", strings.Repeat("A", 40), strings.Repeat("z", 40)} {
		componentSourceCommit = value
		if deployedSourceCommit() != "unavailable" || componentBuildIdentity()["provenance"] != "unverified" {
			t.Fatal("invalid baked source must not fall back to SOURCE_COMMIT")
		}
	}
	componentSourceCommit, componentInputFingerprint = strings.Repeat("a", 40), ""
	if deployedSourceCommit() != "unavailable" {
		t.Fatal("missing input fingerprint must fail closed")
	}
	t.Setenv("RELEASE_COMMIT", "short")
	t.Setenv("RELEASE_ID", "bad\nidentifier")
	if componentBuildIdentity()["releaseCommit"] != "" || componentBuildIdentity()["releaseId"] != "" {
		t.Fatal("invalid release metadata exposed")
	}
}

func TestComponentBuildIdentityReaderCapabilities(t *testing.T) {
	oldCommit, oldFingerprint := componentSourceCommit, componentInputFingerprint
	t.Cleanup(func() { componentSourceCommit, componentInputFingerprint = oldCommit, oldFingerprint })
	componentSourceCommit, componentInputFingerprint = strings.Repeat("a", 40), "sha256:"+strings.Repeat("b", 64)
	expected := []string{"receipt-v1", "receipt-v2", "image-job-v1"}
	for _, enabled := range []string{"0", "1"} {
		t.Setenv("DB_COMPACT_RECEIPTS", enabled)
		t.Setenv("IMAGE_JOBS_ENABLED", enabled)
		t.Setenv("READER_CAPABILITIES", "forged-reader-v99")
		identity := componentBuildIdentity()
		actual, ok := identity["readerCapabilities"].([]string)
		if !ok || !reflect.DeepEqual(actual, expected) || identity["provenance"] != "baked" || identity["inputFingerprint"] != componentInputFingerprint {
			t.Fatal("reader protocols must be source-owned and bound to baked identity")
		}
		actual[0] = "mutated-response"
		if !reflect.DeepEqual(componentBuildIdentity()["readerCapabilities"], expected) {
			t.Fatal("identity response must not mutate future capability claims")
		}
	}
	for _, flag := range []string{"--build-info", "--migration-info"} {
		var output bytes.Buffer
		if !writeBuildIdentityCommand([]string{flag}, &output) {
			t.Fatal("identity command unavailable")
		}
		var result map[string]interface{}
		if err := json.Unmarshal(output.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if flag == "--migration-info" {
			result = result["build"].(map[string]interface{})
		}
		if !reflect.DeepEqual(result["readerCapabilities"], []interface{}{"receipt-v1", "receipt-v2", "image-job-v1"}) {
			t.Fatal("inspection must preserve exact reader protocols")
		}
	}
	componentInputFingerprint = ""
	if componentBuildIdentity()["provenance"] != "unverified" {
		t.Fatal("reader protocols must not manufacture missing image provenance")
	}
}
