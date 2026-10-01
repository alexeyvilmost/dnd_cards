package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCharacterRejectsNewVariantAcquisitionButPreservesHistoricalReferences(t *testing.T) {
	db := openCatalogPaginationTestDB(t)
	if err := db.AutoMigrate(&Spell{}, &Effect{}); err != nil {
		t.Fatal(err)
	}
	parents := []Spell{{ID: uuid.New(), CardNumber: "parent-command", Name: "Parent A"}, {ID: uuid.New(), CardNumber: "parent-hex", Name: "Parent B"}}
	for _, parent := range parents {
		child := Spell{ID: uuid.New(), CardNumber: parent.CardNumber + "-child", Name: "Renamed child", Mechanics: &JSONMap{"variant_of_spell_id": parent.ID.String()}}
		if err := db.Create(&parent).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&child).Error; err != nil {
			t.Fatal(err)
		}
		for _, reference := range []string{child.ID.String(), child.CardNumber} {
			for _, source := range []string{"spell_ids", "class:some-source:spell-choice", "builder:manual_spells"} {
				var ids *Properties
				var choices *JSONMap
				if source == "spell_ids" {
					ids = &Properties{reference}
				} else {
					choices = &JSONMap{source: []any{reference}}
				}
				err := validateNewCharacterSpellAcquisitions(db, nil, ids, choices)
				var rejection *characterRuntimeCommandError
				if !errors.As(err, &rejection) || rejection.Code != "spell_variant_acquisition_forbidden" || rejection.Status != http.StatusBadRequest {
					t.Fatalf("new child %s from %s accepted: %v", reference, source, err)
				}
			}
		}
		before := CharacterV3{SpellIDs: &Properties{child.ID.String()}, ResolvedChoices: &JSONMap{"existing-choice": []any{child.ID.String()}}}
		unchanged := &JSONMap{"existing-choice": []any{child.CardNumber}, "unrelated-ability": []any{"strength", 2}}
		if err := validateNewCharacterSpellAcquisitions(db, &before, &Properties{child.CardNumber, parent.ID.String()}, unchanged); err != nil {
			t.Fatalf("existing canonical child or ordinary parent was rejected: %v", err)
		}
		if err := validateNewCharacterSpellAcquisitions(db, &before, before.SpellIDs, &JSONMap{"new-choice": []any{child.ID.String()}}); err == nil {
			t.Fatal("moving historical child to a new choice must not grant it again")
		}
	}
	unrelated := Effect{ID: uuid.New(), CardNumber: "other-entity", Name: "Ordinary ability"}
	if err := db.Create(&unrelated).Error; err != nil {
		t.Fatal(err)
	}
	if err := validateNewCharacterSpellAcquisitions(db, nil, &Properties{parents[0].ID.String()}, &JSONMap{"feature": []any{unrelated.ID.String(), "strength"}}); err != nil {
		t.Fatalf("ordinary acquisition or unrelated choice was rejected: %v", err)
	}
}

func TestCharacterCreateAndUpdateRejectVariantBeforePersisting(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&Spell{}); err != nil {
		t.Fatal(err)
	}
	child := Spell{ID: uuid.New(), CardNumber: "child-spell", Name: "Child", Mechanics: &JSONMap{"variant_of_spell_id": uuid.NewString()}}
	if err := fixture.db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}
	token := fixture.token(t, fixture.owner)
	for _, source := range []string{"spell_ids", "resolved_choices"} {
		for _, method := range []string{http.MethodPost, http.MethodPut} {
			path := "/api/characters-v3"
			body := map[string]any{"name": "Attempted child acquisition", "level": 1}
			if method == http.MethodPut {
				path += "/" + fixture.ownerCharacter.ID.String()
			}
			if source == "spell_ids" {
				body[source] = []string{child.ID.String()}
			} else {
				body[source] = map[string]any{"selected-spell": []string{child.CardNumber}}
			}
			response := performCharacterV3Request(t, fixture.router, method, path, token, body)
			var failure map[string]any
			_ = json.Unmarshal(response.Body.Bytes(), &failure)
			if response.Code != http.StatusBadRequest || failure["code"] != "spell_variant_acquisition_forbidden" {
				t.Fatalf("%s %s: status=%d, body=%s", method, source, response.Code, response.Body.String())
			}
		}
	}
	var after CharacterV3
	if err := fixture.db.First(&after, fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Name != fixture.ownerCharacter.Name || after.RuntimeRevision != fixture.ownerCharacter.RuntimeRevision {
		t.Fatal("rejected update changed the existing character")
	}
	var added int64
	if err := fixture.db.Model(&CharacterV3{}).Where("name = ?", "Attempted child acquisition").Count(&added).Error; err != nil || added != 0 {
		t.Fatalf("rejected creation persisted a character: count=%d err=%v", added, err)
	}
}
