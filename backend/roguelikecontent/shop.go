// Package roguelikecontent owns the reviewed merchant catalog shared by the
// generator and the database migration. Mechanics remain ordinary engine data.
package roguelikecontent

import (
	_ "embed"
	"encoding/json"
)

//go:embed shop_items.json
var shopJSON []byte

type SourceCard struct {
	ID          string          `json:"id"`
	CardNumber  string          `json:"card_number"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Rarity      string          `json:"rarity"`
	Mechanics   json.RawMessage `json:"mechanics"`
}

type ShopItem struct {
	Source     SourceCard      `json:"source"`
	ID         string          `json:"id"`
	CardNumber string          `json:"card_number"`
	Name       string          `json:"name"`
	Price      int             `json:"price"`
	Rarity     string          `json:"rarity"`
	MinLevel   int             `json:"min_level"`
	Kind       string          `json:"kind"`
	Mechanics  json.RawMessage `json:"mechanics"`
}

func ShopItems() []ShopItem {
	var document struct {
		Entries []ShopItem `json:"entries"`
	}
	if err := json.Unmarshal(shopJSON, &document); err != nil {
		panic(err)
	}
	return document.Entries
}
