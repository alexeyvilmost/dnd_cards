package main

import "dnd-cards-backend/roguelikecontent"

// Historical fixtures only. Live generation reads tags and persisted settings.
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

var roguelikeShopManifest = []roguelikeShopManifestEntry{
	{"CARD-0319", 15, 1, 8, "equipment"},
	{"CARD-0313", 25, 1, 8, "equipment"},
	{"CARD-0311", 25, 1, 8, "equipment"},
	{"CARD-0297", 2, 1, 6, "equipment"},
	{"CARD-0295", 5, 1, 6, "equipment"},
	{"CARD-0317", 50, 1, 7, "equipment"},
	{"CARD-0315", 10, 1, 7, "equipment"},
	{"CARD-0323", 15, 1, 7, "equipment"},
	{"CARD-0325", 20, 1, 6, "equipment"},
	{"CARD-0321", 20, 1, 6, "equipment"},
	{"CARD-0306", 25, 1, 7, "equipment"},
	{"CARD-0327", 50, 1, 7, "equipment"},
	{"CARD-0307", 25, 1, 7, "equipment"},
	{"CARD-0200", 10, 1, 8, "equipment"},
	{"CARD-0276", 45, 1, 7, "equipment"},
	{"CARD-0283", 75, 1, 7, "equipment"},
	{"CARD-0791", 25, 1, 5, "consumable"},
	{"CARD-0815", 25, 1, 4, "consumable"},
	{"CARD-0714", 50, 2, 5, "consumable"},
	{"CARD-0290", 200, 3, 5, "equipment"},
	{"CARD-0271", 400, 3, 4, "equipment"},
	{"CARD-0840", 200, 3, 5, "consumable"},
	{"CARD-0081", 415, 3, 2, "magic"},
	{"CARD-0118", 415, 3, 2, "magic"},
	{"CARD-0548", 400, 4, 1, "magic"},
	{"CARD-0624", 400, 4, 1, "magic"},
	{"CARD-0291", 1500, 5, 1, "equipment"},
}

func selectRoguelikeMerchantStock(seed string, generation, wins, level int, available []roguelikeShopManifestEntry, rarities map[string]string, pinned string) ([]roguelikeShopManifestEntry, error) {
	row := MerchantLevel{Level: level, Slots: roguelikeShopSlots(level), MagicLimit: 40}
	for i := 0; i < 10000; i++ {
		switch roguelikeShopRarity(level, i) {
		case "uncommon":
			row.UncommonBP++
		case "rare":
			row.RareBP++
		case "epic":
			row.EpicBP++
		}
	}
	return selectConfiguredMerchantStock(seed, generation, wins, level, available, rarities, pinned, row)
}
