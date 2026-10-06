package migrations

import (
	"context"
	"strings"
	"testing"
)

func TestExplicitRetirementRejectsUnboundRequestsBeforeConnecting(t *testing.T) {
	request := ReleaseRetirementExecutionRequest{SchemaVersion: 1, Kind: "execute-character-retirement-301", ReleaseID: "owned-explicit-retirement",
		SQLSourceHash: RetirementMigrationIdentity().Checksum, ExpectedAdditiveSchemaProofHash: "sha256:" + strings.Repeat("c", 64), Retirement: testRetirementRequest()}
	// Empty registry is deliberately not a valid complete baseline. Every
	// variant must fail validation without touching the nil database.
	for name, change := range map[string]func(*ReleaseRetirementExecutionRequest){
		"missing baseline":         func(r *ReleaseRetirementExecutionRequest) {},
		"wrong operation":          func(r *ReleaseRetirementExecutionRequest) { r.Kind = "migrate-release" },
		"wrong source":             func(r *ReleaseRetirementExecutionRequest) { r.SQLSourceHash = "sha256:" + strings.Repeat("d", 64) },
		"missing structural proof": func(r *ReleaseRetirementExecutionRequest) { r.ExpectedAdditiveSchemaProofHash = "" },
		"missing external binding": func(r *ReleaseRetirementExecutionRequest) { r.Retirement.BackupHash = "" },
		"unknown migration": func(r *ReleaseRetirementExecutionRequest) {
			r.ExpectedCurrent = []MigrationIdentity{{ID: "999_unknown", Checksum: r.SQLSourceHash}}
		},
		"retirement in ordinary baseline": func(r *ReleaseRetirementExecutionRequest) {
			r.ExpectedCurrent = []MigrationIdentity{RetirementMigrationIdentity()}
		},
	} {
		t.Run(name, func(t *testing.T) {
			copy := request
			change(&copy)
			if _, err := NewMigrator(nil).RunReleaseRetirement(context.Background(), copy); err == nil {
				t.Fatal("unbound execution accepted")
			}
		})
	}
}
