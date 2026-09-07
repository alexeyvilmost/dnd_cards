package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCombatJournalCapturesOnePrivateBaselineAndAcceptedIntent(t *testing.T) {
	hash := "sha256:" + strings.Repeat("a", 64)
	before := JSONMap{"artifactHash": hash, "entropy": JSONMap{"seed": "private", "cursor": 2}}
	result := &roguelikeWorkerResult{Envelope: before, Trace: JSONMap{"beforeHash": hash, "afterHash": hash, "runtimeRevision": 8}, RandomValues: []float64{0.5}}
	request := RoguelikeCommandRequest{Type: "combat_intent", Payload: JSONMap{"intent": JSONMap{"type": "end_turn"}}}
	initial, err := roguelikeCombatJournalRecord(request, before, result, true)
	if err != nil || initial["baselinePosition"] != "before" {
		t.Fatalf("missing rollout baseline: %v", err)
	}
	subsequent, err := roguelikeCombatJournalRecord(request, before, result, false)
	if err != nil || subsequent["baseline"] != nil || subsequent["intent"] == nil {
		t.Fatalf("invalid compact record: %v", err)
	}
	request.Type = "initialize_combat"
	initialized, err := roguelikeCombatJournalRecord(request, nil, result, true)
	if err != nil || initialized["baselinePosition"] != "after" {
		t.Fatalf("invalid initialization record: %v", err)
	}
	key, err := roguelikeCombatJournalKey(before)
	if err != nil || len(key) != 64 || strings.Contains(key, "private") {
		t.Fatal("invalid opaque combat key")
	}
	encoded, _ := json.Marshal(RoguelikeCombatEvent{Record: initial})
	if strings.Contains(string(encoded), "private") {
		t.Fatal("journal leaked through JSON")
	}
	result.Trace = nil
	if _, err := roguelikeCombatJournalRecord(request, nil, result, true); err == nil {
		t.Fatal("accepted unverifiable record")
	}
}
