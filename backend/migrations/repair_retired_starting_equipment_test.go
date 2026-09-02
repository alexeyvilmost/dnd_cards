package migrations

import "testing"

func TestRetiredStartingEquipmentUsesDistinctCanonicalReplacements(t *testing.T) {
	if len(retiredStartingEquipment) != 2 {
		t.Fatalf("replacement count=%d", len(retiredStartingEquipment))
	}
	seen := map[string]bool{}
	for _, replacement := range retiredStartingEquipment {
		if replacement.oldID == replacement.newID || seen[replacement.oldID] {
			t.Fatalf("invalid replacement: %#v", replacement)
		}
		seen[replacement.oldID] = true
	}
}
