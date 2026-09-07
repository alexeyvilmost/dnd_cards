package main

import (
	"fmt"
	"testing"
)

// This models successful encounters and XP pacing, not combat win probability.
func TestRoguelikeProgressionSeedsReachVictory(t *testing.T) {
	available := map[string]Monster{}
	for _, entry := range roguelikeMonsterPool {
		available[entry.Slug] = Monster{Slug: entry.Slug}
	}
	minimum, maximum, total := 1000, 0, 0
	visits := map[string]int{}
	for seedIndex := 0; seedIndex < 1000; seedIndex++ {
		seed := fmt.Sprintf("roguelike-pacing-v1:%d", seedIndex)
		xp, encounters := 0, 0
		for xp < roguelikeVictoryXP {
			level := roguelikeLevelForXP(xp)
			_, budget := roguelikeEncounterBudget(level, xp)
			candidates := roguelikeEncounterCandidates(level, budget, encounters, available)
			if len(candidates) == 0 {
				t.Fatalf("seed %d stopped at XP %d", seedIndex, xp)
			}
			cursor := encounters + 1
			selectedIndex := roguelikeDeterministicInt(seed, "encounter", cursor, len(candidates))
			// Camp RNG consumption cannot alter a repeated encounter after retry.
			for shop := 0; shop < 10; shop++ {
				_ = roguelikeDeterministicInt(seed, "shop", shop, 1000)
			}
			if selectedIndex != roguelikeDeterministicInt(seed, "encounter", cursor, len(candidates)) {
				t.Fatal("camp changed encounter")
			}
			selected := candidates[selectedIndex]
			if selected.Entry.GeneratorWeight <= 0 || selected.Entry.MinLevel > level {
				t.Fatal("unsupported candidate")
			}
			xp += selected.Entry.XP * selected.Quantity
			visits[selected.Entry.Slug]++
			encounters++
			if encounters > 200 {
				t.Fatalf("seed %d exceeded progression safety limit", seedIndex)
			}
		}
		if encounters < minimum {
			minimum = encounters
		}
		if encounters > maximum {
			maximum = encounters
		}
		total += encounters
	}
	t.Logf("1000 successful-encounter simulations: min=%d max=%d mean=%.2f encounters; monster visits=%v", minimum, maximum, float64(total)/1000, visits)
}
