package migrations

import "testing"

func TestPugilistMechanicSpecsCoverEveryFeatureOnce(t *testing.T) {
	if len(pugilistMechanicSpecs) != 25 {
		t.Fatalf("expected 25 Pugilist mechanics specs, got %d", len(pugilistMechanicSpecs))
	}

	seen := make(map[string]bool, len(pugilistMechanicSpecs))
	for _, spec := range pugilistMechanicSpecs {
		if seen[spec.CardNumber] {
			t.Fatalf("duplicate Pugilist feature %s", spec.CardNumber)
		}
		seen[spec.CardNumber] = true

		mode, ok := spec.Activation["mode"].(string)
		if !ok || mode == "" {
			t.Fatalf("%s has no activation mode", spec.CardNumber)
		}
		if mode != "passive" && mode != "active" && mode != "reaction" && mode != "triggered" {
			t.Fatalf("%s has unsupported activation mode %q", spec.CardNumber, mode)
		}
	}

	for i := 1; i <= 20; i++ {
		cardNumber := "PUG-F" + twoDigits(i)
		if !seen[cardNumber] {
			t.Errorf("missing base Pugilist feature %s", cardNumber)
		}
	}
	for i := 1; i <= 5; i++ {
		cardNumber := "PUG-SS" + twoDigits(i)
		if !seen[cardNumber] {
			t.Errorf("missing Sweet Science feature %s", cardNumber)
		}
	}
}

func twoDigits(value int) string {
	if value < 10 {
		return "0" + string(rune('0'+value))
	}
	return string([]rune{'0' + rune(value/10), '0' + rune(value%10)})
}
