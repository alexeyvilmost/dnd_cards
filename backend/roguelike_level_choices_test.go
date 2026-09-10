package main

import (
	"github.com/google/uuid"
	"testing"
)

func TestRoguelikeChoiceReplacementAllowance(t *testing.T) {
	for _, tc := range []struct {
		name               string
		original, selected interface{}
		limit              int
		want               bool
	}{
		{"one swap plus additional slot", []string{"a", "b", "c"}, []string{"b", "c", "d", "e"}, 1, true},
		{"two swaps", []string{"a", "b", "c"}, []string{"c", "d", "e", "f"}, 1, false},
		{"retry is idempotent", []interface{}{"a", "b"}, []interface{}{"b", "a"}, 0, true},
		{"retry cannot swap again", []string{"a", "b"}, []string{"b", "c"}, 0, false},
		{"missing choices", []string{"a", "b"}, nil, 1, false},
		{"duplicates do not create allowance", []string{"a", "b"}, []string{"b", "b"}, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := roguelikeChoiceReplacementAllowed(tc.original, tc.selected, tc.limit); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRoguelikeLevelChoiceReplacementsReadCatalogAndBlockRetry(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.Exec(`CREATE TABLE effects (id uuid PRIMARY KEY, mechanics jsonb, deleted_at timestamptz)`).Error; err != nil {
		t.Fatal(err)
	}
	feature := uuid.New()
	if err := fixture.db.Exec(`INSERT INTO effects(id,mechanics) VALUES (?, '{"effects":[{"id":"spells","replace_on_level_up":1}]}')`, feature).Error; err != nil {
		t.Fatal(err)
	}
	key := "class:" + uuid.NewString() + ":" + feature.String() + ":spells"
	before := fixture.ownerCharacter
	before.Level = 3
	before.ResolvedChoices = &JSONMap{key: []string{"a", "b", "c"}}
	valid := JSONMap{key: []string{"b", "c", "d", "e"}}
	if err := validateRoguelikeLevelChoiceReplacements(fixture.db, before, &valid, 4); err != nil {
		t.Fatal(err)
	}
	invalid := JSONMap{key: []string{"c", "d", "e", "f"}}
	if err := validateRoguelikeLevelChoiceReplacements(fixture.db, before, &invalid, 4); err == nil {
		t.Fatal("accepted two replacements")
	}
	before.Level = 4
	before.ResolvedChoices = &valid
	if err := validateRoguelikeLevelChoiceReplacements(fixture.db, before, &valid, 4); err != nil {
		t.Fatal(err)
	}
	if err := validateRoguelikeLevelChoiceReplacements(fixture.db, before, &invalid, 4); err == nil {
		t.Fatal("retry received another replacement")
	}
}
