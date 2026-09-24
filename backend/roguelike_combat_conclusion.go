package main

// Only the trusted worker can finalize a combat. Held death-save results must
// remain acknowledgeable; victory rewards still use complete_encounter.
func applyTrustedCombatConclusion(run *RoguelikeRun) {
	state, ok := run.CombatEnvelope["state"].(map[string]any)
	if !ok || state["outcomeFinalized"] != true || state["outcome"] != "defeat" {
		return
	}
	run.Status = RoguelikeStatusDefeat
	run.Phase = RoguelikePhaseEnded
}
