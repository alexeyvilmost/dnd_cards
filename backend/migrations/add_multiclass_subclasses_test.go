package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestMulticlassSubclassesMigrationPinsOwnershipAndLegacyBackfill(t *testing.T) {
	raw, err := os.ReadFile("add_multiclass_subclasses.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`subclass_ids JSONB NOT NULL DEFAULT '{}'::jsonb`,
		`jsonb_build_object(`,
		`class_id::text`,
		`resolved_choices->'builder:subclass'->>0`,
		`COALESCE(subclass_ids, '{}'::jsonb) = '{}'::jsonb`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("migration is missing %q", required)
		}
	}
}
