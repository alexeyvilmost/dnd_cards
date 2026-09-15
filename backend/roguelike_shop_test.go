package main

import (
	"dnd-cards-backend/roguelikecontent"
	"fmt"
	"reflect"
	"testing"
)

func TestMerchantRarityExactBasisPoints(t *testing.T) {
	want := [][3]int{{50, 0, 0}, {125, 10, 0}, {210, 50, 0}, {300, 125, 10}, {300, 125, 10}}
	for level := 1; level <= 5; level++ {
		counts := map[string]int{}
		for roll := 0; roll < 10000; roll++ {
			counts[roguelikeShopRarity(level, roll)]++
		}
		row := want[level-1]
		if counts["uncommon"] != row[0] || counts["rare"] != row[1] || counts["epic"] != row[2] || counts["common"] != 10000-row[0]-row[1]-row[2] {
			t.Fatalf("level %d: %v", level, counts)
		}
	}
}

func merchantTestCatalog() ([]roguelikeShopManifestEntry, map[string]string) {
	manifest := roguelikeMerchantManifest()
	rarities := map[string]string{}
	for _, entry := range manifest {
		rarities[entry.CardNumber] = "common"
	}
	for _, item := range roguelikecontent.ShopItems() {
		rarities[item.CardNumber] = item.Rarity
	}
	return manifest, rarities
}

func TestMerchantStockGrowsUniqueDeterministicAndPreservesPinned(t *testing.T) {
	manifest, rarities := merchantTestCatalog()
	for level := 1; level <= 5; level++ {
		for _, pinned := range []string{"", "RL-SHOP-0349", "CARD-0081"} {
			stock, err := selectRoguelikeMerchantStock("shop-seed", 4, 12, level, manifest, rarities, pinned)
			if err != nil {
				t.Fatal(err)
			}
			want := 4 + level
			if pinned != "" {
				want--
			}
			if len(stock) != want {
				t.Fatalf("level %d: %d slots", level, len(stock))
			}
			seen := map[string]bool{pinned: true}
			for _, row := range stock {
				if seen[row.CardNumber] || row.MinLevel > level {
					t.Fatalf("invalid row: %+v", row)
				}
				seen[row.CardNumber] = true
			}
			again, _ := selectRoguelikeMerchantStock("shop-seed", 4, 12, level, manifest, rarities, pinned)
			if !reflect.DeepEqual(stock, again) {
				t.Fatal("stock changed on replay")
			}
		}
	}
}

func TestMerchantDistributionAndAllReviewedItemsReachable(t *testing.T) {
	manifest, rarities := merchantTestCatalog()
	seen := map[string]bool{}
	for level := 1; level <= 5; level++ {
		counts := map[string]int{}
		const shelves = 12000
		for generation := 0; generation < shelves; generation++ {
			stock, err := selectRoguelikeMerchantStock(fmt.Sprintf("distribution-%d", level), generation, 0, level, manifest, rarities, "")
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range stock {
				counts[merchantRarity(rarities[row.CardNumber])]++
				seen[row.CardNumber] = true
			}
		}
		// Broad five-sigma statistical guard; exact probabilities are separately
		// exhaustively checked over the entire basis-point domain above.
		for _, rarity := range []string{"uncommon", "rare", "epic"} {
			exact := 0
			for roll := 0; roll < 10000; roll++ {
				if roguelikeShopRarity(level, roll) == rarity {
					exact++
				}
			}
			mean := float64(exact*shelves*(4+level)) / 10000
			low, high := mean*.65-10, mean*1.35+10
			if float64(counts[rarity]) < low || float64(counts[rarity]) > high {
				t.Fatalf("L%d %s count %d expected %.1f", level, rarity, counts[rarity], mean)
			}
		}
		t.Logf("L%d, %d shelves: %v", level, shelves, counts)
	}
	for _, item := range roguelikecontent.ShopItems() {
		if !seen[item.CardNumber] {
			t.Errorf("unreachable merchant item %s", item.CardNumber)
		}
	}
}

func TestMerchantExpansionDoesNotEnterLegacyLoot(t *testing.T) {
	for _, entry := range roguelikeShopManifest {
		if len(entry.CardNumber) > 3 && entry.CardNumber[:3] == "RL-" {
			t.Fatal("merchant copy leaked into loot")
		}
	}
}
