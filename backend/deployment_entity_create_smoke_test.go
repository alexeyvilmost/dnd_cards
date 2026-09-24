package main

import (
	"reflect"
	"testing"
)

func TestDeploymentEntityCreateSmokeCoversEveryCatalogConstructor(t *testing.T) {
	checks := catalogEntityCreateChecks(nil, "12345678")
	got := make([]string, 0, len(checks))
	for _, check := range checks {
		got = append(got, check.name)
	}
	want := []string{
		"card", "action", "effect", "spell", "feat", "background",
		"race", "class", "resource", "variable", "concept", "monster",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("covered constructors = %v, want %v", got, want)
	}
	if price := checks[0].payload["price"]; price != 1000000 {
		t.Fatalf("card smoke price = %v, want production boundary 1000000", price)
	}
}
