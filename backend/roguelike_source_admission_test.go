package main

import (
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestRoguelikeSourceAcceptsEveryExistingLevelOneClass(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.Exec(`CREATE TABLE classes (id uuid PRIMARY KEY, deleted_at timestamptz)`).Error; err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"fighter", "wizard", "cleric", "rogue"} {
		classID := uuid.New()
		if err := fixture.db.Exec(`INSERT INTO classes(id) VALUES (?)`, classID).Error; err != nil {
			t.Fatal(err)
		}
		source := fixture.ownerCharacter
		source.ClassID = &classID
		source.ClassLevels = &JSONMap{classID.String(): 1}
		source.Level = 1
		if err := validateRoguelikeSource(fixture.db, &source, fixture.owner.ID); err != nil {
			t.Fatalf("%s level-one source rejected: %v", name, err)
		}
		source.Level = 2
		if err := validateRoguelikeSource(fixture.db, &source, fixture.owner.ID); !isRoguelikeCode(err, "starting_level_required") {
			t.Fatalf("%s higher-level source accepted: %v", name, err)
		}
	}
	missing := uuid.New()
	source := fixture.ownerCharacter
	source.ClassID = &missing
	source.Level = 1
	if err := validateRoguelikeSource(fixture.db, &source, fixture.owner.ID); !isRoguelikeCode(err, "class_not_found") {
		t.Fatalf("unknown class accepted: %v", err)
	}
	source.ClassID = nil
	if err := validateRoguelikeSource(fixture.db, &source, fixture.owner.ID); !isRoguelikeCode(err, "starting_level_required") {
		t.Fatalf("classless source accepted: %v", err)
	}
	source = fixture.ownerCharacter
	source.UserID = fixture.other.ID
	if err := validateRoguelikeSource(fixture.db, &source, fixture.owner.ID); !isRoguelikeCode(err, "source_forbidden") {
		t.Fatalf("foreign source accepted: %v", err)
	}
}

func isRoguelikeCode(err error, code string) bool {
	var domain *roguelikeHTTPError
	return errors.As(err, &domain) && domain.Status >= http.StatusBadRequest && domain.Code == code
}
