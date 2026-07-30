package migrations

import (
	"strings"
	"testing"
)

func TestMicroMicroCertificationsAreCompleteAndUnique(t *testing.T) {
	if len(microMicroCertifications) != 37 {
		t.Fatalf("expected 37 certifications, got %d", len(microMicroCertifications))
	}
	seen := map[string]bool{}
	for _, certification := range microMicroCertifications {
		key := certification.Table + ":" + certification.CardNumber
		if seen[key] {
			t.Fatalf("duplicate certification %s", key)
		}
		seen[key] = true
		if !microMicroCertificationTables[certification.Table] {
			t.Fatalf("%s uses an unsupported table", key)
		}
		for field, hash := range map[string]string{
			"content":    certification.ContentHash,
			"dependency": certification.DependencyHash,
		} {
			if !strings.HasPrefix(hash, "sha256:") || len(hash) != len("sha256:")+64 {
				t.Fatalf("%s has invalid %s hash %q", key, field, hash)
			}
		}
	}
}

func TestMicroMicroQaCertificationsAreCompleteAndUnique(t *testing.T) {
	if len(microMicroQaCertifications) != 22 {
		t.Fatalf("expected 22 QA certifications, got %d", len(microMicroQaCertifications))
	}
	seen := map[string]bool{}
	for _, certification := range microMicroQaCertifications {
		key := certification.Table + ":" + certification.CardNumber
		if seen[key] {
			t.Fatalf("duplicate QA certification %s", key)
		}
		seen[key] = true
		if !microMicroCertificationTables[certification.Table] {
			t.Fatalf("%s uses an unsupported table", key)
		}
		for field, hash := range map[string]string{
			"content":    certification.ContentHash,
			"dependency": certification.DependencyHash,
		} {
			if !strings.HasPrefix(hash, "sha256:") || len(hash) != len("sha256:")+64 {
				t.Fatalf("%s has invalid %s hash %q", key, field, hash)
			}
		}
	}
}
