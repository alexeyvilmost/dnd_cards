package migrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSleep2024LifecycleMigrationFollowsMageHandRepair(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != sleep2024LifecycleMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("123 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != mageHandControlMigrationVersion {
			t.Fatal("migration 123 must immediately follow 122")
		}
		return
	}
	t.Fatal("migration 123 is not registered")
}

func TestCanonicalSleep2024LifecycleAndHelpWakeChoice(t *testing.T) {
	sleep := canonicalSleep2024Mechanics()
	effects := sleep["effects"].([]any)
	save := effects[0].(map[string]any)
	if save["automatic_success"] == nil {
		t.Fatal("Sleep must declare automatic save success rules")
	}
	onFail := save["on_fail"].([]any)[0].(map[string]any)
	if onFail["value"] != "incapacitated" {
		t.Fatalf("Sleep first stage must be Incapacitated, got %v", onFail["value"])
	}
	saveEnds := onFail["save_ends"].(map[string]any)
	if saveEnds["on_failure_condition"] != "unconscious" {
		t.Fatalf("Sleep repeat-save transition drifted: %v", saveEnds)
	}
	duration := onFail["duration"].(map[string]any)
	if duration["amount"] != 10 || duration["concentration"] != true {
		t.Fatalf("Sleep duration drifted: %v", duration)
	}

	helpJSON, err := json.Marshal(canonicalHelp2024Mechanics())
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		`"id":"help_mode"`,
		`"id":"wake_sleeping_target"`,
		`"required_end_trigger":"wake_action_within_5_ft"`,
	} {
		if !json.Valid(helpJSON) || !strings.Contains(string(helpJSON), required) {
			t.Fatalf("Help wake contract missing %s: %s", required, helpJSON)
		}
	}
}
