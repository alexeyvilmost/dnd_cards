package main

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"sort"
)

const roguelikeVictoryXP = 14000

var roguelikeXPThresholds = []int{0, 300, 900, 2700, 6500, roguelikeVictoryXP}

type roguelikeMonsterEntry struct {
	Slug            string
	XP              int
	MinLevel        int
	MaxCount        int
	GeneratorWeight int
}

var roguelikeMonsterPool = []roguelikeMonsterEntry{
	{Slug: "bandit", XP: 25, MinLevel: 1, MaxCount: 4, GeneratorWeight: 1},
	{Slug: "guard", XP: 25, MinLevel: 1, MaxCount: 4, GeneratorWeight: 1},
	{Slug: "giant-rat", XP: 25, MinLevel: 1, MaxCount: 4, GeneratorWeight: 1},
	{Slug: "kobold-warrior", XP: 25, MinLevel: 1, MaxCount: 4, GeneratorWeight: 1},
	{Slug: "goblin-warrior", XP: 50, MinLevel: 1, MaxCount: 4, GeneratorWeight: 1}, // Shared Nimble Escape and advantage-only damage.
	{Slug: "skeleton", XP: 50, MinLevel: 1, MaxCount: 4, GeneratorWeight: 1},
	{Slug: "zombie", XP: 50, MinLevel: 1, MaxCount: 3, GeneratorWeight: 1}, // Undead Fortitude and defenses accepted through browser/replay.
	{Slug: "wolf", XP: 50, MinLevel: 2, MaxCount: 4, GeneratorWeight: 1},
	{Slug: "giant-wolf-spider", XP: 50, MinLevel: 3, MaxCount: 3, GeneratorWeight: 1}, // Poison, senses and Spider Climb declaration accepted.
	{Slug: "hobgoblin-warrior", XP: 100, MinLevel: 2, MaxCount: 3, GeneratorWeight: 1},
	{Slug: "tough", XP: 100, MinLevel: 2, MaxCount: 3, GeneratorWeight: 1},
	{Slug: "animated-armor", XP: 200, MinLevel: 3, MaxCount: 2, GeneratorWeight: 1},
	{Slug: "dire-wolf", XP: 200, MinLevel: 3, MaxCount: 2, GeneratorWeight: 1},
	{Slug: "bugbear-warrior", XP: 200, MinLevel: 3, MaxCount: 2, GeneratorWeight: 1}, // Grab, hammer Advantage and Abduct accepted.
	{Slug: "ogre", XP: 450, MinLevel: 4, MaxCount: 2, GeneratorWeight: 1},
	{Slug: "berserker", XP: 450, MinLevel: 4, MaxCount: 2, GeneratorWeight: 1},
	{Slug: "bandit-captain", XP: 450, MinLevel: 4, MaxCount: 2, GeneratorWeight: 1},  // Mixed Multiattack and weapon switching accepted through browser/replay.
	{Slug: "warrior-veteran", XP: 700, MinLevel: 5, MaxCount: 1, GeneratorWeight: 1}, // Parry and weapon switching accepted through browser/replay.
}

type roguelikeShopManifestEntry struct {
	CardNumber string
	Price      int
	MinLevel   int
	Weight     int
	Kind       string
}

func roguelikeLootKind(level, roll int) string {
	if level <= 2 {
		if roll < 80 {
			return "consumable"
		}
		return "equipment"
	}
	if level <= 4 {
		if roll < 70 {
			return "consumable"
		}
		if roll < 90 {
			return "equipment"
		}
		return "magic"
	}
	if roll < 60 {
		return "consumable"
	}
	if roll < 75 {
		return "equipment"
	}
	return "magic"
}

func roguelikeLevelForXP(xp int) int {
	for level := 5; level >= 1; level-- {
		if xp >= roguelikeXPThresholds[level-1] {
			return level
		}
	}
	return 1
}

func roguelikeNextLevelXP(level int) int {
	if level < 1 {
		return roguelikeXPThresholds[1]
	}
	if level >= 5 {
		return roguelikeVictoryXP
	}
	return roguelikeXPThresholds[level]
}

func roguelikeEncounterBudget(level, experience int) (string, int) {
	budgets := map[int][3]int{
		1: {50, 75, 100}, 2: {100, 150, 200}, 3: {150, 225, 400},
		4: {250, 375, 500}, 5: {500, 750, 1100},
	}
	row, ok := budgets[level]
	if !ok {
		row = budgets[5]
	}
	stageStart := roguelikeXPThresholds[level-1]
	stageEnd := roguelikeXPThresholds[level]
	progress := experience - stageStart
	if progress < 0 {
		progress = 0
	}
	span := stageEnd - stageStart
	if progress*3 < span {
		return "low", row[0]
	}
	if progress*4 < span*3 {
		return "moderate", row[1]
	}
	return "high", row[2]
}

// roguelikeDeterministicInt keeps encounter, reward, loot, shop and AI streams
// independent. Adding a shop roll cannot change a future encounter.
func roguelikeDeterministicInt(seed, stream string, cursor, upper int) int {
	if upper <= 0 {
		return 0
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d", seed, stream, cursor)))
	return int(binary.BigEndian.Uint64(sum[:8]) % uint64(upper))
}

func roguelikeWeightedOrder(seed, stream string, cursor int, values []roguelikeShopManifestEntry) []roguelikeShopManifestEntry {
	ordered := append([]roguelikeShopManifestEntry(nil), values...)
	scores := make(map[string]float64, len(ordered))
	for index, value := range ordered {
		// Exponential race samples without replacement in proportion to weight.
		// Uniform*weight would nearly exclude low-weight items in a large pool.
		uniform := float64(roguelikeDeterministicInt(seed, stream, cursor+index*7919, 1_000_000)+1) / 1_000_001
		scores[value.CardNumber] = math.Inf(1)
		if value.Weight > 0 {
			scores[value.CardNumber] = -math.Log(uniform) / float64(value.Weight)
		}
	}
	sort.SliceStable(ordered, func(left, right int) bool {
		leftScore := scores[ordered[left].CardNumber]
		rightScore := scores[ordered[right].CardNumber]
		if leftScore == rightScore {
			return ordered[left].CardNumber < ordered[right].CardNumber
		}
		return leftScore < rightScore
	})
	return ordered
}
