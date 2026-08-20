package main

import (
	"fmt"

	"gorm.io/gorm"
)

// ContentChoiceRecommendation is presentation-only authoring data stored
// outside certified entity bytes. EntityReference is the stable card_number;
// ChoiceID is the raw mechanics/Forge choice id owned by that entity.
type ContentChoiceRecommendation struct {
	EntityType         string     `json:"entity_type" gorm:"column:entity_type;primaryKey"`
	EntityReference    string     `json:"entity_reference" gorm:"column:entity_reference;primaryKey"`
	ChoiceID           string     `json:"choice_id" gorm:"column:choice_id;primaryKey"`
	RecommendedOptions Properties `json:"recommended_options" gorm:"column:recommended_options;type:jsonb"`
}

func (ContentChoiceRecommendation) TableName() string {
	return "content_choice_recommendations"
}

type ChoiceRecommendations map[string][]string

func loadChoiceRecommendations(
	db *gorm.DB,
	entityType string,
	entityReferences []string,
) (map[string]ChoiceRecommendations, error) {
	result := make(map[string]ChoiceRecommendations)
	if len(entityReferences) == 0 {
		return result, nil
	}
	var rows []ContentChoiceRecommendation
	if err := db.Where(
		"entity_type = ? AND entity_reference IN ?",
		entityType,
		entityReferences,
	).Order("entity_reference ASC, choice_id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load %s choice recommendations: %w", entityType, err)
	}
	for _, row := range rows {
		choices := result[row.EntityReference]
		if choices == nil {
			choices = make(ChoiceRecommendations)
			result[row.EntityReference] = choices
		}
		choices[row.ChoiceID] = append([]string(nil), row.RecommendedOptions...)
	}
	return result, nil
}
