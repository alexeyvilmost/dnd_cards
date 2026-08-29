package main

import "testing"

func TestPropertiesValueDistinguishesMissingFromExplicitEmpty(t *testing.T) {
	missing, err := (Properties)(nil).Value()
	if err != nil {
		t.Fatal(err)
	}
	if missing != nil {
		t.Fatalf("nil Properties encoded as %#v, want SQL NULL", missing)
	}

	empty, err := (Properties{}).Value()
	if err != nil {
		t.Fatal(err)
	}
	encoded, ok := empty.([]byte)
	if !ok {
		t.Fatalf("empty Properties encoded as %T, want []byte", empty)
	}
	if string(encoded) != "[]" {
		t.Fatalf("empty Properties encoded as %q, want []", encoded)
	}
}
