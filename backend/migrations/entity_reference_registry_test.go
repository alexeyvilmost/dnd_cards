package migrations

import (
	"reflect"
	"testing"
)

func TestEntityReferenceMigrationsFollowProductionCatalogMigrations(t *testing.T) {
	all := GetAllMigrations()
	want := []string{"280_catalog_variants_and_multitarget", "281_entity_references", "282_effect_classification", "283_explicit_reference_levels", "284_entity_reference_coverage", "285_production_effect_classification"}
	var got []string
	seen := map[string]bool{}
	start := -1
	for index, m := range all {
		if seen[m.Version] {
			t.Fatalf("duplicate version %s", m.Version)
		}
		seen[m.Version] = true
		if m.Version == want[0] {
			start = index
		}
	}
	if start < 0 || start+len(want) > len(all) {
		t.Fatal("required catalog/reference migration sequence is missing")
	}
	// Later append-only migrations may follow; the dependency sequence itself
	// must remain contiguous and ordered, with all original handlers present.
	for _, m := range all[start : start+len(want)] {
		got = append(got, m.Version)
		if m.Up == nil || m.Down == nil {
			t.Fatalf("migration %s has missing handler", m.Version)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("catalog/reference dependency sequence: got %v want %v", got, want)
	}
}
