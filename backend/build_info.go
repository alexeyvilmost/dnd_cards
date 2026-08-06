package main

import (
	"os"
	"regexp"
	"strings"
)

var gitCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

// deployedSourceCommit exposes only a validated Git object identity. Railway
// injects RAILWAY_GIT_COMMIT_SHA for GitHub-triggered deployments; local runs
// deliberately report "unavailable" instead of pretending to be a release.
func deployedSourceCommit() string {
	commit := strings.ToLower(strings.TrimSpace(os.Getenv("RAILWAY_GIT_COMMIT_SHA")))
	if !gitCommitPattern.MatchString(commit) {
		return "unavailable"
	}
	return commit
}
