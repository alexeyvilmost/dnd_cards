package migrations

import "testing"

func TestWildCompanionTargetingRepairCoversBothResourceVariants(t *testing.T) {
	want := map[string]bool{
		"ACT-wild-companion":      true,
		"ACT-wild-companion-slot": true,
	}
	if len(wildCompanionActionCardNumbers) != len(want) {
		t.Fatalf("action count=%d, want %d", len(wildCompanionActionCardNumbers), len(want))
	}
	for _, cardNumber := range wildCompanionActionCardNumbers {
		if !want[cardNumber] {
			t.Fatalf("unexpected action card number %q", cardNumber)
		}
		delete(want, cardNumber)
	}
	if len(want) != 0 {
		t.Fatalf("missing action variants: %#v", want)
	}
}
