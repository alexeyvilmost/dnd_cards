package main

import (
	"encoding/json"
	"github.com/google/uuid"
	"testing"
)

func TestItemPurchasePriceCatalogGatesAndCart(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	price := 5.
	goods := Card{ID: uuid.New(), Name: "Commodity", CardNumber: "PRICE-GOODS", Description: "goods", Rarity: RarityCommon, Price: &price}
	seedTaggedShopTest(t, f.db, goods)
	for _, discount := range []int{200, 75} {
		raw, _ := json.Marshal(map[string]any{"activation": map[string]any{"mode": "passive", "while": "equipped"}, "effects": []any{map[string]any{"resolution": "auto", "result": []any{map[string]any{"kind": "purchase_price_policy", "discount_copper": discount}}}}})
		var m JSONMap
		_ = json.Unmarshal(raw, &m)
		attunable := true
		card := Card{ID: uuid.New(), Name: "Discount", CardNumber: uuid.NewString(), Description: "discount", Rarity: RarityCommon, Mechanics: &m, RequiresAttunement: &attunable}
		if err := f.db.Create(&card).Error; err != nil {
			t.Fatal(err)
		}
		eq := JSONMap{"ring_1": card.ID.String(), "ring_2": card.ID.String()}
		turn := JSONMap{"attuned_ids": []string{card.ID.String()}}
		character := CharacterV3{ID: uuid.New(), Equipment: &eq, TurnState: &turn}
		if got, err := catalogPurchaseCopper(f.db, &character, 500); err != nil || got != 500-discount {
			t.Fatal(got, err)
		}
		if got, err := catalogPurchaseCopper(f.db, &character, 20); err != nil || got != 0 {
			t.Fatal(got, err)
		}
		character.TurnState = nil
		if got, err := catalogPurchaseCopper(f.db, &character, 500); err != nil || got != 500 {
			t.Fatal("unattuned discount", got, err)
		}
		character.TurnState = &turn
		shop, _ := mapFromJSON(RoguelikeShop{Staples: []RoguelikeOffer{{ID: "staple:" + goods.ID.String(), CardID: goods.ID.String(), Price: 500, PriceCurrency: "copper", Quantity: 1}}})
		run := RoguelikeRun{ID: uuid.New(), Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Gold: 10, Character: &character, Shop: shop}
		if err := buyRoguelikeCart(f.db, &run, []RoguelikeCartLine{{"staple:" + goods.ID.String(), 2}}); err != nil {
			t.Fatal(err)
		}
		if got := runWalletCopper(&run); got != 1000-2*(500-discount) {
			t.Fatal("actual cart did not apply each offer discount", got)
		}
	}
}
