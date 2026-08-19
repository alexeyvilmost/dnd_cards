package main

import (
	"os"
	"regexp"
	"strings"
)

var gitCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

// deployedSourceCommit exposes only a validated Git object identity. Portable
// deployments inject SOURCE_COMMIT; Railway remains a backwards-compatible
// source while the old environment is retained for rollback.
func deployedSourceCommit() string {
	commit := strings.TrimSpace(os.Getenv("SOURCE_COMMIT"))
	if commit == "" {
		commit = strings.TrimSpace(os.Getenv("RAILWAY_GIT_COMMIT_SHA"))
	}
	commit = strings.ToLower(commit)
	if !gitCommitPattern.MatchString(commit) {
		return "unavailable"
	}
	return commit
}
