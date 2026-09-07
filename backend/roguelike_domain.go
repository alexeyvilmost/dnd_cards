package main

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"
)

const roguelikeVictoryXP = 14000

var roguelikeXPThresholds = []int{0, 300, 900, 2700, 6500, roguelikeVictoryXP}

type roguelikeMonsterEntry struct {
	Slug     string
	XP       int
	MinLevel int
	MaxCount int
}

var roguelikeMonsterPool = []roguelikeMonsterEntry{
	{Slug: "bandit", XP: 25, MinLevel: 1, MaxCount: 4},
	{Slug: "guard", XP: 25, MinLevel: 1, MaxCount: 4},
	{Slug: "giant-rat", XP: 25, MinLevel: 1, MaxCount: 4},
	{Slug: "kobold-warrior", XP: 25, MinLevel: 1, MaxCount: 4},
	{Slug: "goblin-warrior", XP: 50, MinLevel: 1, MaxCount: 4},
	{Slug: "skeleton", XP: 50, MinLevel: 1, MaxCount: 4},
	{Slug: "zombie", XP: 50, MinLevel: 1, MaxCount: 3},
	{Slug: "wolf", XP: 50, MinLevel: 1, MaxCount: 4},
	{Slug: "giant-wolf-spider", XP: 50, MinLevel: 3, MaxCount: 3},
	{Slug: "hobgoblin-warrior", XP: 100, MinLevel: 2, MaxCount: 3},
	{Slug: "tough", XP: 100, MinLevel: 2, MaxCount: 3},
	{Slug: "animated-armor", XP: 200, MinLevel: 3, MaxCount: 2},
	{Slug: "dire-wolf", XP: 200, MinLevel: 3, MaxCount: 2},
	{Slug: "bugbear-warrior", XP: 200, MinLevel: 3, MaxCount: 2},
	{Slug: "ogre", XP: 450, MinLevel: 4, MaxCount: 2},
	{Slug: "berserker", XP: 450, MinLevel: 4, MaxCount: 2},
	{Slug: "bandit-captain", XP: 450, MinLevel: 4, MaxCount: 2},
	{Slug: "warrior-veteran", XP: 700, MinLevel: 5, MaxCount: 1},
}

type roguelikeShopManifestEntry struct {
	CardNumber string
	Price      int
	MinLevel   int
	Weight     int
}

var roguelikeShopManifest = []roguelikeShopManifestEntry{
	{"CARD-0319", 15, 1, 8},   // Longsword
	{"CARD-0313", 25, 1, 8},   // Rapier
	{"CARD-0311", 25, 1, 8},   // Scimitar
	{"CARD-0297", 2, 1, 6},    // Dagger
	{"CARD-0295", 5, 1, 6},    // Handaxe
	{"CARD-0317", 50, 1, 7},   // Greatsword
	{"CARD-0315", 10, 1, 7},   // Maul
	{"CARD-0323", 15, 1, 7},   // Warhammer
	{"CARD-0325", 20, 1, 6},   // Halberd
	{"CARD-0321", 20, 1, 6},   // Glaive
	{"CARD-0306", 25, 1, 7},   // Shortbow
	{"CARD-0327", 50, 1, 7},   // Longbow
	{"CARD-0307", 25, 1, 7},   // Light crossbow
	{"CARD-0200", 10, 1, 8},   // Shield
	{"CARD-0276", 45, 1, 7},   // Studded leather
	{"CARD-0283", 75, 1, 7},   // Chain mail
	{"CARD-0791", 25, 1, 5},   // Acid
	{"CARD-0815", 25, 1, 4},   // Holy water
	{"CARD-0714", 50, 2, 5},   // Alchemist's fire
	{"CARD-0290", 200, 3, 5},  // Splint
	{"CARD-0271", 400, 3, 4},  // Breastplate
	{"CARD-0840", 200, 3, 5},  // Greater healing potion
	{"CARD-0291", 1500, 5, 1}, // Plate
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

func roguelikeEncounterBudget(level, encountersWon int) (string, int) {
	budgets := map[int][3]int{
		1: {50, 75, 100}, 2: {100, 150, 200}, 3: {150, 225, 400},
		4: {250, 375, 500}, 5: {500, 750, 1100},
	}
	row, ok := budgets[level]
	if !ok {
		row = budgets[5]
	}
	index := encountersWon % 6
	if index < 2 {
		return "low", row[0]
	}
	if index < 5 {
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
	scores := make(map[string]int, len(ordered))
	for index, value := range ordered {
		scores[value.CardNumber] = roguelikeDeterministicInt(seed, stream, cursor+index*7919, 1_000_000) * value.Weight
	}
	sort.SliceStable(ordered, func(left, right int) bool {
		leftScore := scores[ordered[left].CardNumber]
		rightScore := scores[ordered[right].CardNumber]
		if leftScore == rightScore {
			return ordered[left].CardNumber < ordered[right].CardNumber
		}
		return leftScore > rightScore
	})
	return ordered
}
