package main

import (
	"errors"
	"strings"
	"testing"
)

func TestCanonicalJSONMatchesRulesCoreShape(t *testing.T) {
	value, canonical, err := canonicalizeRawJSON([]byte(`{
		"z":-0,
		"omitted-equivalent":{"b":true,"a":null},
		"array":[1.0,0.000001,1e-7],
		"text":"<&\u2028é"
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if value == nil {
		t.Fatal("decoded canonical value is nil")
	}
	want := `{"array":[1,0.000001,1e-7],"omitted-equivalent":{"a":null,"b":true},"text":"<&` + "\u2028" + `é","z":0}`
	if string(canonical) != want {
		t.Fatalf("canonical JSON = %q, want %q", canonical, want)
	}
	if hash := canonicalSHA256(canonical); !strings.HasPrefix(hash, "sha256:") || len(hash) != 71 {
		t.Fatalf("canonical hash = %q", hash)
	}
}

func TestCanonicalJSONUsesJavaScriptUTF16KeyOrdering(t *testing.T) {
	// U+10000 sorts before U+E000 in UTF-16 (D800 DC00 < E000), although its
	// UTF-8 bytes sort after U+E000. rules-core uses Object.keys(...).sort().
	_, canonical, err := canonicalizeRawJSON([]byte(`{"\ue000":1,"\ud800\udc00":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(canonical), `{"𐀀":2,"":1}`; got != want {
		t.Fatalf("canonical key order = %q, want %q", got, want)
	}
}

func TestCanonicalJSONRejectsDuplicateKeysAndTrailingValues(t *testing.T) {
	if _, err := decodeUniqueJSON([]byte(`{"same":1,"same":2}`)); !errors.Is(err, errCanonicalJSONDuplicateKey) {
		t.Fatalf("duplicate key error = %v", err)
	}
	if _, err := decodeUniqueJSON([]byte(`{} {}`)); err == nil {
		t.Fatal("trailing JSON value was accepted")
	}
}
