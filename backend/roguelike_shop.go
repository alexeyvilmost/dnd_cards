package main

import (
	"fmt"
)

func merchantRarity(value string) string {
	if value == "very_rare" {
		return "epic"
	}
	return value
}

// Every free slot receives an independent rarity draw, then a weighted choice
// without replacement inside that rarity. No guaranteed-kind slot dilutes the
// configured probabilities. Staples already supply guaranteed consumables.
func selectConfiguredMerchantStock(seed string, generation, wins, level int,
	available []roguelikeShopManifestEntry, rarities map[string]string, pinned string, policy MerchantLevel,
) ([]roguelikeShopManifestEntry, error) {
	selected := []roguelikeShopManifestEntry{}
	used := map[string]bool{}
	start := 0
	if pinned != "" {
		used[pinned] = true
		start = 1
	}
	magicCount := 0
	if pinned != "" && merchantRarity(rarities[pinned]) != "common" { magicCount++ }
	for slot := start; slot < policy.Slots; slot++ {
		stream := fmt.Sprintf("shop-v2:%d:%d:%d", generation, wins, slot)
		rarity := policy.rarity( roguelikeDeterministicInt(seed, stream+":rarity", 0, 10000))
		if magicCount >= policy.MagicLimit { rarity = "common" }
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
			continue // Still roll remaining slots, even if the common pool is empty.
		}
		entry := roguelikeWeightedOrder(seed, stream+":item", 0, pool)[0]
		selected = append(selected, entry)
		used[entry.CardNumber] = true
		if merchantRarity(rarities[entry.CardNumber]) != "common" { magicCount++ }
	}
	return selected, nil
}
