package migrations

import (
	"encoding/json"
	"testing"
)

func TestRangerFavoredEnemy2024AlwaysPreparesHunterMarkWithTwoFreeUses(t *testing.T) {
	var mechanics struct {
		Effects []struct {
			Result []struct {
				Kind    string `json:"kind"`
				Value   string `json:"value"`
				Label   string `json:"label"`
				Freeuse struct {
					Count int    `json:"count"`
					Per   string `json:"per"`
				} `json:"freeuse"`
			} `json:"result"`
		} `json:"effects"`
	}
	if err := json.Unmarshal([]byte(rangerFavoredEnemy2024Mechanics), &mechanics); err != nil {
		t.Fatal(err)
	}
	grant := mechanics.Effects[0].Result[0]
	if grant.Kind != "grant_spell" || grant.Value != "SPELL-0223" || grant.Label != "prepared" {
		t.Fatalf("Hunter's Mark grant=%#v", grant)
	}
	if grant.Freeuse.Count != 2 || grant.Freeuse.Per != "long_rest" {
		t.Fatalf("Favored Enemy free use=%#v", grant.Freeuse)
	}
}
