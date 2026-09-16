package main

import (
	"github.com/google/uuid"
	"testing"
)

func TestRunCopperChangeAndLegacyPrices(t *testing.T) {
	run := RoguelikeRun{Gold: 5, Character: &CharacterV3{}}
	if err := spendRunCopper(&run, 5); err != nil {
		t.Fatal(err)
	}
	if run.Gold != 4 || runWalletCopper(&run) != 495 {
		t.Fatalf("wrong change: %+v", run.Character.Currency)
	}
	silver, _ := numberFromJSON((*run.Character.Currency)["silver"])
	copper, _ := numberFromJSON((*run.Character.Currency)["copper"])
	if silver != 9 || copper != 5 {
		t.Fatal(run.Character.Currency)
	}
	for _, tc := range []struct {
		offer RoguelikeOffer
		want  int
	}{{RoguelikeOffer{Price: 1}, 100}, {RoguelikeOffer{Price: 5, PriceCurrency: "copper"}, 5}, {RoguelikeOffer{Price: 2, PriceCurrency: "silver"}, 20}} {
		got, e := offerCopper(tc.offer)
		if e != nil || got != tc.want {
			t.Fatal(got, e)
		}
	}
	before := runWalletCopper(&run)
	if spendRunCopper(&run, 496) == nil || runWalletCopper(&run) != before {
		t.Fatal("insufficient payment mutated purse")
	}
}
func TestRoguelikeCartAtomicQuantitiesAndWeight(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	price := 5.
	weight := .05
	cards := []Card{{ID: uuid.New(), Name: "Test projectile A", Description: "test", CardNumber: "CART-A", Rarity: RarityCommon, Price: &price, Weight: &weight}, {ID: uuid.New(), Name: "Test projectile B", Description: "test", CardNumber: "CART-B", Rarity: RarityCommon, Price: &price, Weight: &weight}}
	seedTaggedShopTest(t, f.db, cards...)
	offers := []RoguelikeOffer{}
	for _, c := range cards {
		offers = append(offers, RoguelikeOffer{ID: "staple:" + c.ID.String(), CardID: c.ID.String(), Price: 5, PriceCurrency: "copper", Quantity: 1})
	}
	shop, _ := mapFromJSON(RoguelikeShop{Staples: offers})
	run := RoguelikeRun{ID: uuid.New(), Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Gold: 5, Character: &CharacterV3{ID: uuid.New()}, Shop: shop}
	if err := buyRoguelikeCart(f.db, &run, []RoguelikeCartLine{{offers[0].ID, 20}, {offers[1].ID, 1}}); err != nil {
		t.Fatal(err)
	}
	if runWalletCopper(&run) != 395 || (*run.Character.InventoryItems)[0].Qty != 20 || (*run.Character.InventoryItems)[1].Qty != 1 {
		t.Fatal("cart not committed", run.Character)
	}
	before, _ := mapFromJSON(run.Character)
	beforeMoney := runWalletCopper(&run)
	for _, bad := range [][]RoguelikeCartLine{{{offers[0].ID, 1}, {"missing", 1}}, {{offers[0].ID, 100}}, {{offers[0].ID, 0}}, {{offers[0].ID, 1}, {offers[0].ID, 1}}, {{offers[0].ID, 1001}}} {
		if buyRoguelikeCart(f.db, &run, bad) == nil {
			t.Fatal("invalid cart accepted", bad)
		}
		after, _ := mapFromJSON(run.Character)
		if !roguelikeJSONEqual(before, after) || runWalletCopper(&run) != beforeMoney {
			t.Fatal("partial cart committed")
		}
	}
	heavy := 500.
	if e := f.db.Model(&Card{}).Where("id=?", cards[1].ID).Update("weight", heavy).Error; e != nil {
		t.Fatal(e)
	}
	if buyRoguelikeCart(f.db, &run, []RoguelikeCartLine{{offers[0].ID, 1}, {offers[1].ID, 1}}) == nil {
		t.Fatal("overweight cart accepted")
	}
	if runWalletCopper(&run) != beforeMoney {
		t.Fatal("weight failure charged money")
	}
	run.Phase = RoguelikePhaseCombat
	if applyRoguelikeCommand(f.db, &run, RoguelikeCommandRequest{Type: "buy_cart"}) == nil {
		t.Fatal("combat purchase accepted")
	}
}
func TestTaggedCardPriceUsesCopperWithoutGoldRounding(t *testing.T) {
	for _, currency := range []string{"copper", "silver", "gold"} {
		amount := 5.
		want := 5
		if currency == "silver" {
			want = 50
		}
		if currency == "gold" {
			want = 500
		}
		got, e := runCardPrice(Card{Price: &amount, PriceCurrency: &currency}, MerchantItemRule{Quantity: 1})
		if e != nil || got != want {
			t.Fatal(currency, got, e)
		}
	}
}
