package main

import (
	"os"
	"regexp"
	"strings"
)

var gitCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

// deployedSourceCommit exposes only a validated Git object identity. The
// Timecloud release runner injects SOURCE_COMMIT into both application images.
func deployedSourceCommit() string {
	commit := strings.TrimSpace(os.Getenv("SOURCE_COMMIT"))
	commit = strings.ToLower(commit)
	if !gitCommitPattern.MatchString(commit) {
		return "unavailable"
	}
	return commit
}
