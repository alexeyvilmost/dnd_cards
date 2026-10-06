package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestReleaseMigrationCLIRejectsUnboundAndMalformedRequestsBeforeStartup(t *testing.T) {
	previousCommit, previousFingerprint := componentSourceCommit, componentInputFingerprint
	t.Cleanup(func() { componentSourceCommit, componentInputFingerprint = previousCommit, previousFingerprint })
	componentSourceCommit = ""
	componentInputFingerprint = ""
	for _, command := range []string{"--migrate-release", "--inspect-release-migrations", "--inspect-character-retirement"} {
		for _, input := range []string{`{}`, `{"schemaVersion":1,"releaseId":"candidate"}`, `{"unknown":true}`, `{} {}`} {
			var output bytes.Buffer
			handled, err := runReleaseMigrationCommand([]string{command}, strings.NewReader(input), &output)
			if !handled || err == nil || output.Len() != 0 {
				t.Fatal("untrusted request passed or touched startup")
			}
		}
	}
	if handled, _ := runReleaseMigrationCommand([]string{"--build-info"}, strings.NewReader(""), &bytes.Buffer{}); handled {
		t.Fatal("unrelated command intercepted")
	}
	if _, err := runReleaseMigrationCommand([]string{"--migrate-release", "file.json"}, strings.NewReader(""), &bytes.Buffer{}); err == nil {
		t.Fatal("unbounded file/argv request accepted")
	}
}
