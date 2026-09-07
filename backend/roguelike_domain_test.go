package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestRoguelikeLevelAndVictoryThresholds(t *testing.T) {
	tests := []struct{ xp, level, next int }{
		{0, 1, 300}, {299, 1, 300}, {300, 2, 900}, {900, 3, 2700},
		{2700, 4, 6500}, {6500, 5, 14000}, {14000, 5, 14000},
	}
	for _, test := range tests {
		if got := roguelikeLevelForXP(test.xp); got != test.level {
			t.Fatalf("xp %d: level=%d, want %d", test.xp, got, test.level)
		}
		if got := roguelikeNextLevelXP(test.level); got != test.next {
			t.Fatalf("level %d: next=%d, want %d", test.level, got, test.next)
		}
	}
}

func TestRoguelikeEncounterBudgetProgressesWithinCycle(t *testing.T) {
	difficulties := []string{"low", "low", "moderate", "moderate", "moderate", "high"}
	for index, want := range difficulties {
		got, budget := roguelikeEncounterBudget(3, index)
		if got != want {
			t.Fatalf("encounter %d: difficulty=%s, want %s", index, got, want)
		}
		if budget <= 0 {
			t.Fatalf("encounter %d: invalid budget %d", index, budget)
		}
	}
}

func TestRoguelikeRandomStreamsAreStableAndIndependent(t *testing.T) {
	first := roguelikeDeterministicInt("seed", "encounter", 4, 1000)
	if first != roguelikeDeterministicInt("seed", "encounter", 4, 1000) {
		t.Fatal("same stream/cursor is not deterministic")
	}
	if first == roguelikeDeterministicInt("seed", "shop", 4, 1000) {
		t.Fatal("test fixture unexpectedly aliases independent streams")
	}
}

func TestRoguelikeContentManifestsAreUniqueAndComplete(t *testing.T) {
	if len(roguelikeMonsterPool) != 18 {
		t.Fatalf("monster pool has %d entries, want 18", len(roguelikeMonsterPool))
	}
	monsters := map[string]bool{}
	for _, entry := range roguelikeMonsterPool {
		if entry.Slug == "" || entry.XP <= 0 || entry.MinLevel < 1 || entry.MinLevel > 5 || entry.MaxCount < 1 {
			t.Fatalf("invalid monster manifest entry: %#v", entry)
		}
		if monsters[entry.Slug] {
			t.Fatalf("duplicate monster slug %q", entry.Slug)
		}
		monsters[entry.Slug] = true
	}
	items := map[string]bool{}
	for _, entry := range roguelikeShopManifest {
		if entry.CardNumber == "" || entry.Price < 1 || entry.MinLevel < 1 || entry.MinLevel > 5 || entry.Weight < 1 {
			t.Fatalf("invalid shop manifest entry: %#v", entry)
		}
		if items[entry.CardNumber] {
			t.Fatalf("duplicate shop card %q", entry.CardNumber)
		}
		items[entry.CardNumber] = true
	}
}

func TestConsumeRoguelikeInventoryItem(t *testing.T) {
	cardID := uuid.New().String()
	rows := InventoryItemRows{{CardID: cardID, Qty: 2}, {CardID: uuid.New().String(), Qty: 1}}
	character := CharacterV3{InventoryItems: &rows}
	if !consumeRoguelikeInventoryItem(&character, cardID) || (*character.InventoryItems)[0].Qty != 1 {
		t.Fatalf("first consumption failed: %#v", character.InventoryItems)
	}
	if !consumeRoguelikeInventoryItem(&character, cardID) || len(*character.InventoryItems) != 1 {
		t.Fatalf("last copy was not removed: %#v", character.InventoryItems)
	}
	if consumeRoguelikeInventoryItem(&character, cardID) {
		t.Fatal("consumed an unavailable item")
	}
}
