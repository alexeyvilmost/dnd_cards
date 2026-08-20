package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
)

// Choice recommendations are presentation/authoring data. They deliberately
// live outside certified entity bytes: changing a Forge default must not
// invalidate or unlock a rules certification for a class or effect.
type recommendedChoiceSeed struct {
	EntityType      string
	EntityReference string
	ChoiceID        string
	Options         []string
}

var recommendedSkillChoices = []recommendedChoiceSeed{
	{EntityType: "class", EntityReference: "CLASS-barbarian", ChoiceID: "class_skills", Options: []string{"athletics", "survival"}},
	{EntityType: "class", EntityReference: "CLASS-bard", ChoiceID: "class_skills", Options: []string{"performance", "persuasion", "deception"}},
	{EntityType: "class", EntityReference: "CLASS-cleric", ChoiceID: "class_skills", Options: []string{"insight", "religion"}},
	{EntityType: "class", EntityReference: "CLASS-druid", ChoiceID: "class_skills", Options: []string{"nature", "perception"}},
	{EntityType: "class", EntityReference: "CLASS-monk", ChoiceID: "class_skills", Options: []string{"acrobatics", "insight"}},
	{EntityType: "class", EntityReference: "CLASS-paladin", ChoiceID: "class_skills", Options: []string{"athletics", "persuasion"}},
	{EntityType: "class", EntityReference: "CLASS-ranger", ChoiceID: "class_skills", Options: []string{"perception", "stealth", "survival"}},
	{EntityType: "class", EntityReference: "CLASS-rogue", ChoiceID: "class_skills", Options: []string{"investigation", "perception", "sleight_of_hand", "stealth"}},
	{EntityType: "class", EntityReference: "CLASS-sorcerer", ChoiceID: "class_skills", Options: []string{"arcana", "persuasion"}},
	{EntityType: "class", EntityReference: "CLASS-warlock", ChoiceID: "class_skills", Options: []string{"arcana", "deception"}},
	{EntityType: "class", EntityReference: "CLASS-warrior", ChoiceID: "class_skills", Options: []string{"athletics", "perception"}},
	{EntityType: "class", EntityReference: "CLASS-wizard", ChoiceID: "class_skills", Options: []string{"arcana", "investigation"}},
	{EntityType: "effect", EntityReference: "RE-elf-3", ChoiceID: "elf_skill", Options: []string{"perception"}},
	{EntityType: "effect", EntityReference: "RE-human-2", ChoiceID: "human_skill", Options: []string{"perception"}},
}

func normalizedRecommendedOptions(options []string) ([]string, error) {
	if len(options) == 0 {
		return nil, fmt.Errorf("recommended option list is empty")
	}
	seen := make(map[string]bool, len(options))
	result := make([]string, 0, len(options))
	for _, option := range options {
		if option == "" || seen[option] {
			return nil, fmt.Errorf("invalid duplicate recommended option %q", option)
		}
		seen[option] = true
		result = append(result, option)
	}
	return result, nil
}

func stringOptions(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok || text == "" {
			return nil
		}
		result = append(result, text)
	}
	return result
}

func containsAllOptions(available []string, recommended []string) bool {
	set := make(map[string]bool, len(available))
	for _, option := range available {
		set[option] = true
	}
	for _, option := range recommended {
		if !set[option] {
			return false
		}
	}
	return true
}

func validateClassSkillRecommendation(raw []byte, recommended []string) error {
	var declaration map[string]any
	if err := json.Unmarshal(raw, &declaration); err != nil {
		return fmt.Errorf("decode class skill choices: %w", err)
	}
	available := stringOptions(declaration["options"])
	count, ok := declaration["count"].(float64)
	if !ok || count < 1 || int(count) != len(recommended) || !containsAllOptions(available, recommended) {
		return fmt.Errorf("recommendation does not match class skill choice domain/count")
	}
	return nil
}

func findChoiceDeclaration(value any, choiceID string) map[string]any {
	switch current := value.(type) {
	case []any:
		for _, child := range current {
			if found := findChoiceDeclaration(child, choiceID); found != nil {
				return found
			}
		}
	case map[string]any:
		if current["kind"] == "choice" && current["id"] == choiceID {
			return current
		}
		keys := make([]string, 0, len(current))
		for key := range current {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if found := findChoiceDeclaration(current[key], choiceID); found != nil {
				return found
			}
		}
	}
	return nil
}

func validateEffectSkillRecommendation(raw []byte, choiceID string, recommended []string) error {
	var mechanics any
	if err := json.Unmarshal(raw, &mechanics); err != nil {
		return fmt.Errorf("decode effect mechanics: %w", err)
	}
	choice := findChoiceDeclaration(mechanics, choiceID)
	if choice == nil {
		return fmt.Errorf("choice %q is absent", choiceID)
	}
	options, ok := choice["options"].(map[string]any)
	if !ok || options["source"] != "skill" {
		return fmt.Errorf("choice %q is not a skill choice", choiceID)
	}
	filter := options["filter"]
	if filter == "all" {
		return nil
	}
	if !containsAllOptions(stringOptions(filter), recommended) {
		return fmt.Errorf("recommendation is outside choice %q domain", choiceID)
	}
	return nil
}

func upsertChoiceRecommendation(
	tx *sql.Tx,
	seed recommendedChoiceSeed,
	options []string,
) error {
	raw, err := json.Marshal(options)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`
		INSERT INTO content_choice_recommendations (
			entity_type, entity_reference, choice_id, recommended_options
		) VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (entity_type, entity_reference, choice_id)
		DO UPDATE SET recommended_options = EXCLUDED.recommended_options,
		              updated_at = CURRENT_TIMESTAMP
	`, seed.EntityType, seed.EntityReference, seed.ChoiceID, raw)
	return err
}

func seedRecommendedSkillChoices(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS content_choice_recommendations (
			entity_type VARCHAR(32) NOT NULL,
			entity_reference VARCHAR(255) NOT NULL,
			choice_id VARCHAR(255) NOT NULL,
			recommended_options JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (entity_type, entity_reference, choice_id),
			CONSTRAINT ck_content_choice_recommendations_entity_type
				CHECK (entity_type IN ('class', 'effect')),
			CONSTRAINT ck_content_choice_recommendations_options
				CHECK (jsonb_typeof(recommended_options) = 'array'
					AND jsonb_array_length(recommended_options) > 0)
		)
	`); err != nil {
		return fmt.Errorf("create choice recommendation sidecar: %w", err)
	}

	for _, seed := range recommendedSkillChoices {
		options, normalizeErr := normalizedRecommendedOptions(seed.Options)
		if normalizeErr != nil {
			return fmt.Errorf("%s:%s: %w", seed.EntityReference, seed.ChoiceID, normalizeErr)
		}
		var raw []byte
		switch seed.EntityType {
		case "class":
			if err := tx.QueryRow(`
				SELECT skill_choices FROM classes
				WHERE card_number = $1 AND deleted_at IS NULL
			`, seed.EntityReference).Scan(&raw); err != nil {
				return fmt.Errorf("read %s skill choice: %w", seed.EntityReference, err)
			}
			if err := validateClassSkillRecommendation(raw, options); err != nil {
				return fmt.Errorf("%s: %w", seed.EntityReference, err)
			}
		case "effect":
			if err := tx.QueryRow(`
				SELECT mechanics FROM effects
				WHERE card_number = $1 AND deleted_at IS NULL
			`, seed.EntityReference).Scan(&raw); err != nil {
				return fmt.Errorf("read %s mechanics: %w", seed.EntityReference, err)
			}
			if err := validateEffectSkillRecommendation(raw, seed.ChoiceID, options); err != nil {
				return fmt.Errorf("%s: %w", seed.EntityReference, err)
			}
		default:
			return fmt.Errorf("unsupported recommendation entity type %q", seed.EntityType)
		}
		if err := upsertChoiceRecommendation(tx, seed, options); err != nil {
			return fmt.Errorf("seed %s:%s recommendation: %w", seed.EntityReference, seed.ChoiceID, err)
		}
	}
	return tx.Commit()
}

func removeRecommendedSkillChoices(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, seed := range recommendedSkillChoices {
		if _, err := tx.Exec(`
			DELETE FROM content_choice_recommendations
			WHERE entity_type = $1 AND entity_reference = $2 AND choice_id = $3
		`, seed.EntityType, seed.EntityReference, seed.ChoiceID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
