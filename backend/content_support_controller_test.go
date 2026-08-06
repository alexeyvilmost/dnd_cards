package main

import (
	"strings"
	"testing"
)

func contentSupportString(value string) *string { return &value }

func TestCertificationKeyAuthorizationFailsClosed(t *testing.T) {
	tests := []struct {
		name       string
		configured string
		supplied   string
		want       bool
	}{
		{name: "matching key", configured: "secret", supplied: "secret", want: true},
		{name: "missing configuration", configured: "", supplied: "secret"},
		{name: "missing supplied key", configured: "secret", supplied: ""},
		{name: "wrong key", configured: "secret", supplied: "other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isCertificationKeyAuthorized(tt.configured, tt.supplied); got != tt.want {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
		})
	}
}

func TestValidateContentSupportRequest(t *testing.T) {
	validHash := "sha256:" + strings.Repeat("a", 64)
	validDependencyHash := "sha256:" + strings.Repeat("b", 64)
	validEvidenceID := "00000000-0000-4000-8000-000000000001"
	tests := []struct {
		name    string
		request ContentSupportRequest
		want    string
	}{
		{
			name:    "unknown status",
			request: ContentSupportRequest{Status: "green"},
			want:    "неизвестный status",
		},
		{
			name:    "verified requires version",
			request: ContentSupportRequest{Status: "verified_mechanical"},
			want:    "certification_version",
		},
		{
			name: "verified rejects non-sha hashes",
			request: ContentSupportRequest{
				Status:               "verified_mechanical",
				CertificationVersion: contentSupportString("micro-mvp-v1"),
				ContentHash:          contentSupportString("content-v1"),
				DependencyHash:       contentSupportString("deps-v1"),
			},
			want: "sha256",
		},
		{
			name: "verified rejects offset timestamp",
			request: ContentSupportRequest{
				Status:               "verified_mechanical",
				CertificationVersion: contentSupportString("micro-mvp-v1"),
				ContentHash:          &validHash,
				DependencyHash:       &validDependencyHash,
				CertifiedAt:          contentSupportString("2026-08-05T12:00:00+03:00"),
			},
			want: "UTC RFC3339",
		},
		{
			name: "verified partial requires limitations",
			request: ContentSupportRequest{
				Status:               "verified_partial",
				CertificationVersion: contentSupportString("micro-micro-v1"),
				ContentHash:          &validHash,
				DependencyHash:       &validDependencyHash,
			},
			want: "limitations",
		},
		{
			name: "valid verified partial",
			request: ContentSupportRequest{
				Status:               "verified_partial",
				CertificationVersion: contentSupportString("micro-micro-v1"),
				ContentHash:          &validHash,
				DependencyHash:       &validDependencyHash,
				CertifiedAt:          contentSupportString("2026-08-05T12:00:00.123Z"),
				Limitations:          []string{"Автоматически поддержана только базовая цель"},
			},
		},
		{
			name: "micro MVP v3 requires release evidence",
			request: ContentSupportRequest{
				Status:               "verified_mechanical",
				CertificationVersion: contentSupportString(microMVPEvidenceCertificationVersion),
				ContentHash:          &validHash,
				DependencyHash:       &validDependencyHash,
				CertifiedAt:          contentSupportString("2026-08-05T12:00:00Z"),
			},
			want: "evidence_id",
		},
		{
			name: "valid micro MVP v3 evidence",
			request: ContentSupportRequest{
				Status:               "verified_mechanical",
				CertificationVersion: contentSupportString(microMVPEvidenceCertificationVersion),
				ContentHash:          &validHash,
				DependencyHash:       &validDependencyHash,
				CertifiedAt:          contentSupportString("2026-08-05T12:00:00Z"),
				EvidenceID:           &validEvidenceID,
				EvidenceHash:         &validHash,
				EvidenceCompletedAt:  contentSupportString("2026-08-05T11:59:00Z"),
				GateSourceHash:       &validHash,
				SourceContentHash:    &validHash,
				RulesHash:            &validHash,
				ReleaseContentHash:   &validHash,
				ReleaseHash:          &validHash,
				PatchHash:            &validHash,
				CatalogHash:          &validHash,
			},
		},
		{
			name: "micro MVP v3 rejects non-canonical evidence hash whitespace",
			request: ContentSupportRequest{
				Status:               "verified_mechanical",
				CertificationVersion: contentSupportString(microMVPEvidenceCertificationVersion),
				ContentHash:          &validHash,
				DependencyHash:       &validDependencyHash,
				CertifiedAt:          contentSupportString("2026-08-05T12:00:00Z"),
				EvidenceID:           &validEvidenceID,
				EvidenceHash:         contentSupportString(validHash + " "),
				EvidenceCompletedAt:  contentSupportString("2026-08-05T11:59:00Z"),
				GateSourceHash:       &validHash,
				SourceContentHash:    &validHash,
				RulesHash:            &validHash,
				ReleaseContentHash:   &validHash,
				ReleaseHash:          &validHash,
				PatchHash:            &validHash,
				CatalogHash:          &validHash,
			},
			want: "evidence_hash",
		},
		{
			name:    "non-verified status does not require version",
			request: ContentSupportRequest{Status: "untested"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := validateContentSupportRequest(tt.request)
			if tt.want == "" {
				if len(issues) != 0 {
					t.Fatalf("expected no issues, got %v", issues)
				}
				return
			}
			if !strings.Contains(strings.Join(issues, " "), tt.want) {
				t.Fatalf("expected issue containing %q, got %v", tt.want, issues)
			}
		})
	}
}
