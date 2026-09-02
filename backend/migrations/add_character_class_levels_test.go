package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestCharacterClassLevelsMigrationContract(t *testing.T) {
	raw, err := os.ReadFile("add_character_class_levels.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{"class_levels JSONB", "jsonb_build_object(class_id::text", "GREATEST(level, 1)"} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing migration contract %q", required)
		}
	}
}
