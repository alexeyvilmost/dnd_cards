package main

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
)

func currencyCopper(c *CharacterV3) int {
	total := 0
	if c != nil && c.Currency != nil {
		for key, rate := range map[string]int{"gold": 100, "silver": 10, "copper": 1, "electrum": 50, "platinum": 1000} {
			n, _ := numberFromJSON((*c.Currency)[key])
			if n > 0 {
				total += n * rate
			}
		}
	}
	return total
}
func setCurrencyCopper(c *CharacterV3, total int) {
	wallet := cloneJSONMapValue(c.Currency)
	wallet["gold"] = total / 100
	wallet["silver"] = (total % 100) / 10
	wallet["copper"] = total % 10
	wallet["electrum"] = 0
	wallet["platinum"] = 0
	c.Currency = &wallet
}
func runWalletCopper(run *RoguelikeRun) int {
	return run.Gold*100 + currencyCopper(run.Character) - characterGold(run.Character)*100
}
func spendRunCopper(run *RoguelikeRun, cost int) error {
	total := runWalletCopper(run)
	if cost < 0 || cost > total {
		return roguelikeError(409, "insufficient_gold", "недостаточно монет")
	}
	if cost > 0 {
		setCurrencyCopper(run.Character, total-cost)
		run.Gold = (total - cost) / 100
	}
	return nil
}
func offerCopper(offer RoguelikeOffer) (int, error) {
	rate := 100
	switch offer.PriceCurrency {
	case "", "gold":
	case "copper":
		rate = 1
	case "silver":
		rate = 10
	default:
		return 0, fmt.Errorf("неизвестная валюта предложения")
	}
	if offer.Price < 0 || offer.Price > 100000000 {
		return 0, fmt.Errorf("некорректная цена")
	}
	return offer.Price * rate, nil
}

type RoguelikeCartLine struct {
	OfferID  string `json:"offer_id"`
	Quantity int    `json:"quantity"`
}

// Validate on an isolated candidate. The surrounding command transaction locks
// the run/characters and records the receipt, making the entire cart atomic.
func buyRoguelikeCart(tx *gorm.DB, run *RoguelikeRun, lines []RoguelikeCartLine) error {
	if len(lines) == 0 || len(lines) > 100 {
		return roguelikeError(400, "invalid_cart", "корзина должна содержать от 1 до 100 позиций")
	}
	candidate := *run
	var character CharacterV3
	raw, err := json.Marshal(run.Character)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &character); err != nil {
		return err
	}
	candidate.Character = &character
	seen := map[string]bool{}
	for _, line := range lines {
		if line.OfferID == "" || seen[line.OfferID] || line.Quantity < 1 || line.Quantity > 1000 {
			return roguelikeError(400, "invalid_cart_quantity", "некорректное количество или повтор товара")
		}
		seen[line.OfferID] = true
		if err = buyRoguelikeQuantity(tx, &candidate, line.OfferID, line.Quantity); err != nil {
			return err
		}
	}
	*run.Character = character
	run.Gold = candidate.Gold
	run.Supplies = candidate.Supplies
	run.Shop = candidate.Shop
	return nil
}
func decodeRoguelikeCart(request RoguelikeCommandRequest) ([]RoguelikeCartLine, error) {
	var lines []RoguelikeCartLine
	raw, err := json.Marshal(request.Payload["items"])
	if err == nil {
		err = json.Unmarshal(raw, &lines)
	}
	if err != nil {
		return nil, roguelikeError(400, "invalid_cart", "неверный формат корзины")
	}
	return lines, nil
}
