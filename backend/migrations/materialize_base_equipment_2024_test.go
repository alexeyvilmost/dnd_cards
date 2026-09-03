package migrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBaseEquipment2024DeclaresEveryOfficialWeaponAndArmor(t *testing.T) {
	if len(baseWeapons2024) != 38 {
		t.Fatalf("weapons=%d, want 38", len(baseWeapons2024))
	}
	if len(baseArmors2024) != 13 {
		t.Fatalf("armor=%d, want 13", len(baseArmors2024))
	}
	seen := map[string]bool{}
	for _, row := range baseWeapons2024 {
		if seen[row.CardNumber] {
			t.Fatalf("duplicate weapon %s", row.CardNumber)
		}
		seen[row.CardNumber] = true
		if len(row.CardNumber) > 20 {
			t.Fatalf("card number %q exceeds the production cards.card_number limit", row.CardNumber)
		}
		if row.WeaponType == "" || row.MasteryID == "" || len(row.Modes) == 0 {
			t.Fatalf("incomplete weapon %#v", row)
		}
		if _, err := json.Marshal(row); err != nil {
			t.Fatalf("%s: %v", row.CardNumber, err)
		}
	}
	if !seen["CARD-B24-MORNINGSTAR"] {
		t.Fatal("Morningstar declaration is absent")
	}
	utilities := utilityItems2024()
	if len(utilities) != 55 {
		t.Fatalf("utility mechanics=%d, want 55 (potion is pre-existing)", len(utilities))
	}
	utilitySeen := map[string]bool{}
	for _, row := range utilities {
		if utilitySeen[row.CardNumber] {
			t.Fatalf("duplicate utility %s", row.CardNumber)
		}
		utilitySeen[row.CardNumber] = true
		if len(row.CardNumber) > 20 {
			t.Fatalf("card number %q exceeds the production cards.card_number limit", row.CardNumber)
		}
		if _, err := json.Marshal(row.Mechanics); err != nil {
			t.Fatalf("%s: %v", row.CardNumber, err)
		}
	}
	if !utilitySeen["CARD-B24-BULLSEYE"] {
		t.Fatal("Bullseye Lantern declaration is absent")
	}
}

func TestLatestMigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != draconicSorcerySpellAbilityVersion {
		t.Fatalf("last=%s", last.Version)
	}
	if last.Up == nil || last.Down == nil {
		t.Fatal("migration must register Up and Down")
	}
}

func TestBaseEquipment2024RuntimeDeclarationsAreExecutable(t *testing.T) {
	byCard := map[string]map[string]any{}
	for _, row := range utilityItems2024() {
		byCard[row.CardNumber] = row.Mechanics
	}
	for _, cardNumber := range []string{"CARD-0799", "CARD-0790", "CARD-0411", "CARD-0723", "CARD-0823"} {
		mechanics := byCard[cardNumber]
		effects := mechanics["effects"].([]map[string]any)
		payload := effects[0]["result"].([]map[string]any)[0]
		geometry := payload["geometry"].(map[string]any)
		if geometry["size_ft"] == nil || geometry["radius_ft"] != nil {
			t.Fatalf("%s has invalid world-zone geometry: %#v", cardNumber, geometry)
		}
	}

	healer := byCard["CARD-0491"]
	if healer["uses"].(map[string]any)["count"] != 10 {
		t.Fatalf("healer kit uses=%#v", healer["uses"])
	}
	healerCosts := healer["activation"].(map[string]any)["cost"].([]map[string]any)
	if healerCosts[len(healerCosts)-1]["resource"] != "self_uses" {
		t.Fatalf("healer kit does not consume its declared uses: %#v", healerCosts)
	}
	healerTargeting := healer["targeting"].(map[string]any)
	healerRelations := healerTargeting["allowed_relations"].([]string)
	if healerTargeting["range_ft"] != 5 || len(healerRelations) != 1 || healerRelations[0] != "ally" {
		t.Fatalf("healer kit must select one adjacent ally: %#v", healerTargeting)
	}
	if healer["effects"].([]map[string]any)[0]["who"] != "target" {
		t.Fatalf("healer kit interaction must validate the selected target: %#v", healer["effects"])
	}

	poisonPayload := byCard["CARD-0832"]["effects"].([]map[string]any)[0]["result"].([]map[string]any)[0]
	if poisonPayload["kind"] != "damage_rider" || poisonPayload["consume"] != "next" {
		t.Fatalf("basic poison is not a one-hit damage rider: %#v", poisonPayload)
	}
	for _, cardNumber := range []string{"CARD-0407", "CARD-0819", "CARD-0822", "CARD-0389", "CARD-0696", "CARD-0831"} {
		cost := byCard[cardNumber]["activation"].(map[string]any)["cost"].([]map[string]any)
		if len(cost) != 0 {
			t.Fatalf("%s sheet helper is blocked by a turn resource: %#v", cardNumber, cost)
		}
	}

	firePayloads := byCard["CARD-0714"]["effects"].([]map[string]any)[0]["on_fail"].([]map[string]any)
	if firePayloads[1]["kind"] != "triggered_effect" || firePayloads[1]["event"] != "turn_start" {
		t.Fatalf("alchemist fire does not persist burning: %#v", firePayloads)
	}
}

func TestBaseArmorDescriptionsContainRulesRatherThanLegacyBonuses(t *testing.T) {
	for _, row := range baseArmors2024 {
		description := armorDescription2024(row)
		if !strings.Contains(description, "КЗ:") || !strings.Contains(description, "Без владения") {
			t.Fatalf("incomplete armor description for %s: %s", row.CardNumber, description)
		}
		if strings.Contains(description, "максимальному здоровью") {
			t.Fatalf("legacy HP bonus leaked into %s", row.CardNumber)
		}
	}
}
