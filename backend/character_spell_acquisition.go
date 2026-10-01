package main

import (
	"net/http"

	"gorm.io/gorm"
)

// Acquisition checks apply only to newly introduced references. Existing
// character records and historical cast choices are never rewritten here.
func validateNewCharacterSpellAcquisitions(db *gorm.DB, before *CharacterV3, spellIDs *Properties, choices *JSONMap) error {
	type referenceChange struct {
		reference string
		previous  map[string]bool
	}
	changes := []referenceChange{}
	newReferences := map[string]bool{}
	appendChanges := func(next, previous any) {
		previousSet := characterChoiceReferenceSet(previous)
		for reference := range characterChoiceReferenceSet(next) {
			if !previousSet[reference] {
				changes = append(changes, referenceChange{reference, previousSet})
				newReferences[reference] = true
			}
		}
	}
	var previousSpellIDs *Properties
	if before != nil {
		previousSpellIDs = before.SpellIDs
	}
	appendChanges(spellIDs, previousSpellIDs)
	if choices != nil {
		for key, next := range *choices {
			var previous any
			if before != nil && before.ResolvedChoices != nil {
				previous = (*before.ResolvedChoices)[key]
			}
			appendChanges(next, previous)
		}
	}
	if len(newReferences) == 0 {
		return nil
	}
	references := make([]string, 0, len(newReferences))
	for reference := range newReferences {
		references = append(references, reference)
	}
	// Resolve against spell data, not a choice key, display name, or ID prefix.
	// Unrelated feat/effect/skill choices are not spell acquisitions.
	var children []Spell
	if err := db.Select("id", "card_number").Where(
		"(id::text IN ? OR card_number IN ?) AND jsonb_typeof(mechanics->'variant_of_spell_id') = 'string'", references, references,
	).Find(&children).Error; err != nil {
		return err
	}
	for _, child := range children {
		for _, change := range changes {
			if change.reference != child.ID.String() && change.reference != child.CardNumber {
				continue
			}
			// Canonicalizing an already saved UUID/card-number reference is not
			// a new acquisition. Moving it into a new choice still is.
			if change.previous[child.ID.String()] || change.previous[child.CardNumber] {
				continue
			}
			return &characterRuntimeCommandError{Status: http.StatusBadRequest, Code: "spell_variant_acquisition_forbidden",
				Message: "Версию заклинания можно выбрать только при наложении родительского заклинания"}
		}
	}
	return nil
}

func characterChoiceReferenceSet(raw any) map[string]bool {
	result := map[string]bool{}
	switch values := raw.(type) {
	case *Properties:
		if values != nil {
			for _, reference := range *values {
				result[reference] = true
			}
		}
	case []string:
		for _, reference := range values {
			result[reference] = true
		}
	case []any:
		for _, value := range values {
			if reference, ok := value.(string); ok {
				result[reference] = true
			}
		}
	}
	return result
}
