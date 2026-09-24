package main

import "testing"

func TestTrustedCombatConclusion(t *testing.T) {
	for _, tc := range []struct {
		name, outcome     string
		finalized, defeat bool
	}{
		{"held fatal save", "defeat", false, false},
		{"confirmed defeat", "defeat", true, true},
		{"victory still awaits reward", "victory", true, false},
		{"active", "active", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			run := RoguelikeRun{Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat,
				CombatEnvelope: JSONMap{"state": map[string]any{"outcome": tc.outcome, "outcomeFinalized": tc.finalized}}}
			applyTrustedCombatConclusion(&run)
			applyTrustedCombatConclusion(&run)
			if (run.Status == RoguelikeStatusDefeat) != tc.defeat || (run.Phase == RoguelikePhaseEnded) != tc.defeat {
				t.Fatalf("unexpected conclusion: %s/%s", run.Status, run.Phase)
			}
		})
	}
}
