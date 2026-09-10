package main

import (
	"fmt"
	"sort"
	"strings"
)

type roguelikeEncounterMember struct {
	Entry    roguelikeMonsterEntry
	Monster  Monster
	Quantity int
}

type roguelikeComposition struct {
	Key          string
	Members      []roguelikeEncounterMember
	XP, Quantity int
}

// Reviewed pairings, not an unrestricted cross product of the monster library.
var roguelikeMixedTemplates = []struct {
	MinLevel   int
	Slugs      [2]string
	AllowThree bool
}{
	{1, [2]string{"bandit", "guard"}, true},
	{2, [2]string{"kobold-warrior", "giant-rat"}, true},
	{2, [2]string{"guard", "tough"}, true},
	{2, [2]string{"bandit", "tough"}, true},
	{3, [2]string{"skeleton", "animated-armor"}, true},
	{4, [2]string{"wolf", "dire-wolf"}, true},
	// The late-run CR2 pairing is two opponents (900 XP), not three.
	{5, [2]string{"ogre", "berserker"}, false},
}

func roguelikeEncounterCompositions(level, budget, won int, available map[string]Monster) []roguelikeComposition {
	result := []roguelikeComposition{}
	for _, single := range roguelikeEncounterCandidates(level, budget, won, available) {
		result = append(result, roguelikeComposition{
			Key:     fmt.Sprintf("%s:%d", single.Entry.Slug, single.Quantity),
			Members: []roguelikeEncounterMember{{single.Entry, single.Monster, single.Quantity}},
			XP:      single.Entry.XP * single.Quantity, Quantity: single.Quantity,
		})
	}
	if level == 1 && won < 2 {
		return result
	}
	entries := map[string]roguelikeMonsterEntry{}
	for _, entry := range roguelikeMonsterPool {
		entries[entry.Slug] = entry
	}
	for _, template := range roguelikeMixedTemplates {
		if template.MinLevel > level {
			continue
		}
		counts := [][2]int{{1, 1}}
		if level >= 3 && template.AllowThree {
			counts = append(counts, [2]int{2, 1}, [2]int{1, 2})
		}
		for _, count := range counts {
			composition := roguelikeComposition{}
			keys := []string{}
			valid := true
			for index, slug := range template.Slugs {
				entry := entries[slug]
				monster, exists := available[slug]
				if !exists || entry.GeneratorWeight <= 0 || entry.MinLevel > level || count[index] > entry.MaxCount {
					valid = false
					break
				}
				composition.Members = append(composition.Members, roguelikeEncounterMember{entry, monster, count[index]})
				composition.XP += entry.XP * count[index]
				composition.Quantity += count[index]
				keys = append(keys, fmt.Sprintf("%s:%d", slug, count[index]))
			}
			if !valid || composition.XP*2 < budget || composition.XP > budget+budget/2 {
				continue
			}
			sort.Strings(keys)
			composition.Key = strings.Join(keys, "+")
			result = append(result, composition)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Key < result[j].Key })
	return result
}

func roguelikeEncounterHistory(checkpoint JSONMap) []string {
	history := []string{}
	switch rows := checkpoint["encounter_history"].(type) {
	case []string:
		history = append(history, rows...)
	case []any:
		for _, row := range rows {
			if key, ok := row.(string); ok {
				history = append(history, key)
			}
		}
	}
	return history
}

func avoidRepeatedRoguelikeComposition(candidates []roguelikeComposition, history []string) []roguelikeComposition {
	if len(history) < 2 || history[len(history)-1] != history[len(history)-2] {
		return candidates
	}
	result := []roguelikeComposition{}
	for _, candidate := range candidates {
		if candidate.Key != history[len(history)-1] {
			result = append(result, candidate)
		}
	}
	if len(result) == 0 {
		return candidates
	}
	return result
}
