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
	for _, m := range all {
		if seen[m.Version] {
			t.Fatalf("duplicate version %s", m.Version)
		}
		seen[m.Version] = true
	}
	for _, m := range all[len(all)-len(want):] {
		got = append(got, m.Version)
		if m.Up == nil || m.Down == nil {
			t.Fatalf("migration %s has missing handler", m.Version)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("migration tail: got %v want %v", got, want)
	}
}
