package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestEffectResponseExposesEveryMutableRelationshipAndProvenanceField(t *testing.T) {
	nameEn := "Effect"
	source := "Player's Handbook 2024"
	relatedCards := Properties{"CARD-0001"}
	relatedActions := Properties{"ACTION-0001"}
	relatedEffects := Properties{"EFFECT-0002"}
	effect := Effect{
		ID:             uuid.New(),
		Name:           "Эффект",
		NameEn:         &nameEn,
		Description:    "Описание",
		Rarity:         RarityCommon,
		CardNumber:     "EFFECT-0001",
		EffectType:     EffectTypePassive,
		Author:         "Wizards of the Coast",
		Source:         &source,
		RelatedCards:   &relatedCards,
		RelatedActions: &relatedActions,
		RelatedEffects: &relatedEffects,
	}

	response := effect.ToEffectResponse()
	if response.Author != effect.Author || response.Source != effect.Source {
		t.Fatalf("provenance fields were lost: %#v", response)
	}
	if response.RelatedCards != effect.RelatedCards ||
		response.RelatedActions != effect.RelatedActions ||
		response.RelatedEffects != effect.RelatedEffects {
		t.Fatalf("relationship fields were lost: %#v", response)
	}
}

func TestActionResponseExposesEveryMutableRelationshipAndProvenanceField(t *testing.T) {
	nameEn := "Action"
	source := "Player's Handbook 2024"
	relatedCards := Properties{"CARD-0001"}
	relatedActions := Properties{"ACTION-0002"}
	action := Action{
		ID:             uuid.New(),
		Name:           "Действие",
		NameEn:         &nameEn,
		Description:    "Описание",
		Rarity:         RarityCommon,
		CardNumber:     "ACTION-0001",
		ActionType:     ActionTypeBaseAction,
		Author:         "Wizards of the Coast",
		Source:         &source,
		RelatedCards:   &relatedCards,
		RelatedActions: &relatedActions,
	}

	response := action.ToActionResponse()
	if response.Author != action.Author || response.Source != action.Source {
		t.Fatalf("provenance fields were lost: %#v", response)
	}
	if response.RelatedCards != action.RelatedCards || response.RelatedActions != action.RelatedActions {
		t.Fatalf("relationship fields were lost: %#v", response)
	}
}
