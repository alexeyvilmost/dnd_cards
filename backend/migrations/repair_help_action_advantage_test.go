package migrations

import (
	"encoding/json"
	"testing"
)

func TestHelpActionUsesExactSingleRollAdvantageChoices(t *testing.T) {
	var mechanics struct {
		Effects []struct {
			Result []struct {
				Options struct {
					Items []struct {
						ID     string           `json:"id"`
						Grants []map[string]any `json:"grants"`
					} `json:"items"`
				} `json:"options"`
			} `json:"result"`
		} `json:"effects"`
	}
	if err := json.Unmarshal([]byte(helpActionAdvantageMechanics), &mechanics); err != nil {
		t.Fatal(err)
	}
	items := mechanics.Effects[0].Result[0].Options.Items
	if len(items) != 4 {
		t.Fatalf("Help choices=%d, want 4", len(items))
	}
	for _, item := range items[:2] {
		grant := item.Grants[0]
		if grant["kind"] != "modifier" || grant["op"] != "advantage" || grant["consume"] != "next" {
			t.Fatalf("%s has malformed Advantage grant: %#v", item.ID, grant)
		}
		if _, malformedDieBoon := grant["die"]; malformedDieBoon {
			t.Fatalf("%s must not create a die boon", item.ID)
		}
	}
}
