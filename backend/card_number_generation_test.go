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
