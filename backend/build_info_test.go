package main

import "testing"

func TestDeployedSourceCommit(t *testing.T) {
	t.Run("portable source commit takes precedence", func(t *testing.T) {
		t.Setenv("SOURCE_COMMIT", "512B3C66C41A43A40A6C96239FA89321AD2D52B0")
		t.Setenv("RAILWAY_GIT_COMMIT_SHA", "8742e6de58f984f8a583dcffd0d763e2f836a59f")
		if got := deployedSourceCommit(); got != "512b3c66c41a43a40a6c96239fa89321ad2d52b0" {
			t.Fatalf("unexpected portable commit: %q", got)
		}
	})

	t.Run("exact Railway commit", func(t *testing.T) {
		t.Setenv("SOURCE_COMMIT", "")
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
			t.Setenv("SOURCE_COMMIT", "")
			t.Setenv("RAILWAY_GIT_COMMIT_SHA", value)
			if got := deployedSourceCommit(); got != "unavailable" {
				t.Fatalf("invalid deployment identity must fail closed, got %q", got)
			}
		})
	}
}
