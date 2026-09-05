package main

import "testing"

func TestNextGeneratedCardNumberIgnoresNamedCardNumbers(t *testing.T) {
	cardNumbers := []string{
		"CARD-0001",
		"CARD-0978",
		"CARD-B24-BULLSEYE",
		"CARD-B24-MORNINGSTAR",
		"MVP-9999",
	}

	if got, want := nextGeneratedCardNumber(cardNumbers), "CARD-0979"; got != want {
		t.Fatalf("nextGeneratedCardNumber() = %q, want %q", got, want)
	}
}

func TestNextGeneratedCardNumberStartsAtOne(t *testing.T) {
	if got, want := nextGeneratedCardNumber(nil), "CARD-0001"; got != want {
		t.Fatalf("nextGeneratedCardNumber() = %q, want %q", got, want)
	}
}

func TestNextGeneratedCardNumberSupportsMoreThanFourDigits(t *testing.T) {
	if got, want := nextGeneratedCardNumber([]string{"CARD-9999"}), "CARD-10000"; got != want {
		t.Fatalf("nextGeneratedCardNumber() = %q, want %q", got, want)
	}
}

func TestNextGeneratedNumberIgnoresNamedIDsAndUsesNumericMaximum(t *testing.T) {
	ids := []string{"EFFECT-runtime-fire", "EFFECT-9999", "EFFECT-10000", "EFFECT-0042-extra"}
	if got, want := nextGeneratedNumber(ids, "EFFECT"), "EFFECT-10001"; got != want {
		t.Fatalf("nextGeneratedNumber() = %q, want %q", got, want)
	}
}

func TestNextGeneratedNumberDoesNotUseAnotherPrefix(t *testing.T) {
	ids := []string{"ACTION-0007", "ACT-9000", "ACTION-custom"}
	if got, want := nextGeneratedNumber(ids, "ACTION"), "ACTION-0008"; got != want {
		t.Fatalf("nextGeneratedNumber() = %q, want %q", got, want)
	}
}
