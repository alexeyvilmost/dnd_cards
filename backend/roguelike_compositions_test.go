package main

import "testing"

func TestRoguelikeEarlyToughGroupsDoNotExceedTwo(t *testing.T) {
	available := map[string]Monster{}
	for _, entry := range roguelikeMonsterPool {
		available[entry.Slug] = Monster{Slug: entry.Slug}
	}
	for _, level := range []int{2, 3} {
		for _, budget := range []int{100, 150, 200, 225, 400} {
			for _, candidate := range roguelikeEncounterCompositions(level, budget, 20, available) {
				for _, member := range candidate.Members {
					if member.Entry.Slug == "tough" && member.Quantity > 2 {
						t.Fatalf("uncertified early pack: level %d, %+v", level, candidate)
					}
				}
			}
		}
	}
	// Retain the supported two-Tough encounter and its unmodified reward.
	found := false
	for _, candidate := range roguelikeEncounterCompositions(3, 400, 20, available) {
		if candidate.Key == "tough:2" {
			found = candidate.XP == 200
		}
	}
	if !found {
		t.Fatal("two-Tough reserve or exact XP was lost")
	}
}

func TestRoguelikeMixedCompositionBounds(t *testing.T) {
	available := map[string]Monster{}
	for _, entry := range roguelikeMonsterPool {
		available[entry.Slug] = Monster{Slug: entry.Slug}
	}
	mixed := 0
	for level := 1; level <= 5; level++ {
		for _, progress := range []int{0, 40, 90} {
			xp := roguelikeXPThresholds[level-1] + (roguelikeXPThresholds[level]-roguelikeXPThresholds[level-1])*progress/100
			_, budget := roguelikeEncounterBudget(level, xp)
			for _, won := range []int{0, 1, 5, 20} {
				candidates := roguelikeEncounterCompositions(level, budget, won, available)
				if len(candidates) == 0 {
					t.Fatal("no reserve candidate")
				}
				seen := map[string]bool{}
				for _, candidate := range candidates {
					if seen[candidate.Key] {
						t.Fatal("duplicate composition")
					}
					seen[candidate.Key] = true
					limit := 3
					if level <= 2 {
						limit = 2
					}
					if level == 1 && won < 2 {
						limit = 1
					}
					if candidate.Quantity > limit || candidate.XP*2 < budget || candidate.XP > budget+budget/2 {
						t.Fatalf("illegal composition: %+v", candidate)
					}
					totalXP, bodies := 0, 0
					for _, member := range candidate.Members {
						if member.Entry.GeneratorWeight <= 0 || member.Entry.MinLevel > level || member.Quantity > member.Entry.MaxCount {
							t.Fatal("unsupported monster")
						}
						totalXP += member.Entry.XP * member.Quantity
						bodies += member.Quantity
					}
					if totalXP != candidate.XP || bodies != candidate.Quantity {
						t.Fatal("incorrect reward denominator")
					}
					if len(candidate.Members) > 1 {
						mixed++
					}
				}
			}
		}
	}
	if mixed == 0 {
		t.Fatal("mixed encounters never generated")
	}
	delete(available, "tough")
	for _, candidate := range roguelikeEncounterCompositions(2, 150, 5, available) {
		for _, member := range candidate.Members {
			if member.Entry.Slug == "tough" {
				t.Fatal("missing content entered roster")
			}
		}
	}
}

func TestRoguelikeCompositionHistoryAndReserve(t *testing.T) {
	candidates := []roguelikeComposition{{Key: "a"}, {Key: "b"}}
	if got := avoidRepeatedRoguelikeComposition(candidates, []string{"a", "a"}); len(got) != 1 || got[0].Key != "b" {
		t.Fatal("third repeat was not excluded")
	}
	if got := avoidRepeatedRoguelikeComposition(candidates[:1], []string{"a", "a"}); len(got) != 1 {
		t.Fatal("reserve became empty")
	}
	if got := avoidRepeatedRoguelikeComposition(candidates, []string{"b", "a"}); len(got) != 2 {
		t.Fatal("unnecessary history exclusion")
	}
}
