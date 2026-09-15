package main

import (
	"dnd-cards-backend/roguelikecontent"
	"fmt"
)

// Percentages are per newly generated slot, in basis points (1/100 percent).
// Level five retains the last explicitly configured rarity table.
func roguelikeShopRarity(level, roll int) string {
	thresholds := [3]int{50, 0, 0}
	if level == 2 {
		thresholds = [3]int{125, 10, 0}
	}
	if level == 3 {
		thresholds = [3]int{210, 50, 0}
	}
	if level >= 4 {
		thresholds = [3]int{300, 125, 10}
	}
	if roll < thresholds[2] {
		return "epic"
	}
	if roll < thresholds[2]+thresholds[1] {
		return "rare"
	}
	if roll < thresholds[2]+thresholds[1]+thresholds[0] {
		return "uncommon"
	}
	return "common"
}

func roguelikeShopSlots(level int) int {
	if level < 1 {
		level = 1
	}
	if level > 5 {
		level = 5
	}
	return 4 + level
}

func roguelikeMerchantManifest() []roguelikeShopManifestEntry {
	entries := []roguelikeShopManifestEntry{}
	// Retain mundane equipment and consumables. The old magic/greater-potion
	// rows belong only to loot; merchant copies have their own library prices.
	for _, entry := range roguelikeShopManifest {
		if entry.Kind != "magic" && entry.CardNumber != "CARD-0840" {
			entries = append(entries, entry)
		}
	}
	for _, item := range roguelikecontent.ShopItems() {
		entries = append(entries, roguelikeShopManifestEntry{CardNumber: item.CardNumber, Price: item.Price,
			MinLevel: item.MinLevel, Weight: 1, Kind: item.Kind})
	}
	return entries
}

func merchantRarity(value string) string {
	if value == "very_rare" {
		return "epic"
	}
	return value
}

// Every free slot receives an independent rarity draw, then a weighted choice
// without replacement inside that rarity. No guaranteed-kind slot dilutes the
// configured probabilities. Staples already supply guaranteed consumables.
func selectRoguelikeMerchantStock(seed string, generation, wins, level int,
	available []roguelikeShopManifestEntry, rarities map[string]string, pinned string,
) ([]roguelikeShopManifestEntry, error) {
	selected := []roguelikeShopManifestEntry{}
	used := map[string]bool{}
	start := 0
	if pinned != "" {
		used[pinned] = true
		start = 1
	}
	for slot := start; slot < roguelikeShopSlots(level); slot++ {
		stream := fmt.Sprintf("shop-v2:%d:%d:%d", generation, wins, slot)
		rarity := roguelikeShopRarity(level, roguelikeDeterministicInt(seed, stream+":rarity", 0, 10000))
		pool := []roguelikeShopManifestEntry{}
		for _, entry := range available {
			if entry.MinLevel <= level && !used[entry.CardNumber] && merchantRarity(rarities[entry.CardNumber]) == rarity {
				pool = append(pool, entry)
			}
		}
		// A very unlikely shelf can exhaust a small rarity pool. Fill it from
		// common stock, never silently upgrade to another rare tier.
		if len(pool) == 0 && rarity != "common" {
			for _, entry := range available {
				if entry.MinLevel <= level && !used[entry.CardNumber] && rarities[entry.CardNumber] == "common" {
					pool = append(pool, entry)
				}
			}
		}
		if len(pool) == 0 {
			return nil, fmt.Errorf("merchant has no unique stock for slot %d", slot)
		}
		entry := roguelikeWeightedOrder(seed, stream+":item", 0, pool)[0]
		selected = append(selected, entry)
		used[entry.CardNumber] = true
	}
	return selected, nil
}
