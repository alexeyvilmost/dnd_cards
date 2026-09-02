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

func TestBaseEquipment2024MigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != baseEquipmentDescriptionMigrationVersion {
		t.Fatalf("last=%s", last.Version)
	}
	if last.Up == nil || last.Down == nil {
		t.Fatal("migration must register Up and Down")
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
