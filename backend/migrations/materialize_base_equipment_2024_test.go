package migrations

import (
	"encoding/json"
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
		if row.WeaponType == "" || row.MasteryID == "" || len(row.Modes) == 0 {
			t.Fatalf("incomplete weapon %#v", row)
		}
		if _, err := json.Marshal(row); err != nil {
			t.Fatalf("%s: %v", row.CardNumber, err)
		}
	}
	if !seen["CARD-BASE2024-MORNINGSTAR"] {
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
		if _, err := json.Marshal(row.Mechanics); err != nil {
			t.Fatalf("%s: %v", row.CardNumber, err)
		}
	}
	if !utilitySeen["CARD-BASE2024-BULLSEYE-LANTERN"] {
		t.Fatal("Bullseye Lantern declaration is absent")
	}
}

func TestBaseEquipment2024MigrationIsRegisteredLast(t *testing.T) {
	migrations := GetAllMigrations()
	last := migrations[len(migrations)-1]
	if last.Version != baseEquipment2024MigrationVersion {
		t.Fatalf("last=%s", last.Version)
	}
	if last.Up == nil || last.Down == nil {
		t.Fatal("migration must register Up and Down")
	}
}
