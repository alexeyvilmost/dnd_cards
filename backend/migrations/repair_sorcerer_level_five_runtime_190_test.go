package migrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSorcererLevelFiveRuntimeDeclarations(t *testing.T) {
	if sorcererLevelFiveRuntimeVersion != "190_repair_sorcerer_level_five_runtime" {
		t.Fatalf("unexpected version %q", sorcererLevelFiveRuntimeVersion)
	}
	var mechanics map[string]any
	if err := json.Unmarshal([]byte(sorcerousRestorationTriggerMechanics), &mechanics); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"mode":"triggered"`,
		`"event":"short_rest"`,
		`"count":1,"per":"long_rest"`,
		`"id":"sorcery_points"`,
		`"amount":"floor(class_level:sorcerer/2)"`,
	} {
		if !strings.Contains(sorcerousRestorationTriggerMechanics, want) {
			t.Errorf("Sorcerous Restoration misses %s", want)
		}
	}
	if strings.Contains(sorcerousRestorationTriggerMechanics, "grant_action") {
		t.Fatal("rest-bound restoration must not remain an unrestricted sheet action")
	}
}
