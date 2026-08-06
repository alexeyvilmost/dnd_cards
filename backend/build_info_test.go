package main

import "testing"

func TestDeployedSourceCommit(t *testing.T) {
	t.Run("exact Railway commit", func(t *testing.T) {
		t.Setenv("RAILWAY_GIT_COMMIT_SHA", "8742E6DE58F984F8A583DCFFD0D763E2F836A59F")
		if got := deployedSourceCommit(); got != "8742e6de58f984f8a583dcffd0d763e2f836a59f" {
			t.Fatalf("unexpected normalized commit: %q", got)
		}
	})

	for name, value := range map[string]string{
		"missing":   "",
		"short":     "8742e6d",
		"non hex":   "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
		"decorated": "commit:8742e6de58f984f8a583dcffd0d763e2f836a59f",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("RAILWAY_GIT_COMMIT_SHA", value)
			if got := deployedSourceCommit(); got != "unavailable" {
				t.Fatalf("invalid deployment identity must fail closed, got %q", got)
			}
		})
	}
}
