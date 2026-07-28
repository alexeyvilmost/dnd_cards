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
			name: "verified partial requires limitations",
			request: ContentSupportRequest{
				Status:               "verified_partial",
				CertificationVersion: contentSupportString("micro-micro-v1"),
			},
			want: "limitations",
		},
		{
			name: "valid verified partial",
			request: ContentSupportRequest{
				Status:               "verified_partial",
				CertificationVersion: contentSupportString("micro-micro-v1"),
				ContentHash:          contentSupportString("content-v1"),
				DependencyHash:       contentSupportString("deps-v1"),
				Limitations:          []string{"Автоматически поддержана только базовая цель"},
			},
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
