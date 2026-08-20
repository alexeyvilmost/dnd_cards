package migrations

import (
	"encoding/json"
	"testing"
)

func TestRecommendedSkillChoiceMigrationIsRegisteredAfter103(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "104_seed_recommended_skill_choices" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("104 must register Up and Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("104_seed_recommended_skill_choices is not registered")
	}
	if previous := migrations[index-1].Version; previous != "103_revoke_invalid_mage_hand_certification" {
		t.Fatalf("migration before 104 = %q, want 103", previous)
	}
}

func TestRecommendedSkillChoiceAuthoringIsCompleteAndUnique(t *testing.T) {
	if len(recommendedSkillChoices) != 14 {
		t.Fatalf("recommended choices = %d, want 14", len(recommendedSkillChoices))
	}
	seen := map[string]bool{}
	classes, effects := 0, 0
	for _, seed := range recommendedSkillChoices {
		key := seed.EntityType + ":" + seed.EntityReference + ":" + seed.ChoiceID
		if seen[key] {
			t.Fatalf("duplicate recommendation %s", key)
		}
		seen[key] = true
		if _, err := normalizedRecommendedOptions(seed.Options); err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		switch seed.EntityType {
		case "class":
			classes++
		case "effect":
			effects++
		default:
			t.Fatalf("unsupported entity type %q", seed.EntityType)
		}
	}
	if classes != 12 || effects != 2 {
		t.Fatalf("class/effect recommendations = %d/%d, want 12/2", classes, effects)
	}
}

func TestRecommendationValidationUsesOwnedChoiceDomains(t *testing.T) {
	classRaw := []byte(`{"count":2,"options":["arcana","history","investigation"]}`)
	if err := validateClassSkillRecommendation(classRaw, []string{"arcana", "investigation"}); err != nil {
		t.Fatalf("valid class recommendation rejected: %v", err)
	}
	if err := validateClassSkillRecommendation(classRaw, []string{"arcana", "perception"}); err == nil {
		t.Fatal("class recommendation outside options must be rejected")
	}

	effect := map[string]any{"effects": []any{map[string]any{
		"resolution": "auto",
		"result": []any{map[string]any{
			"kind": "choice", "id": "species_skill",
			"options": map[string]any{"source": "skill", "filter": []any{"insight", "perception"}},
		}},
	}}}
	effectRaw, _ := json.Marshal(effect)
	if err := validateEffectSkillRecommendation(effectRaw, "species_skill", []string{"perception"}); err != nil {
		t.Fatalf("valid species recommendation rejected: %v", err)
	}
	if err := validateEffectSkillRecommendation(effectRaw, "species_skill", []string{"arcana"}); err == nil {
		t.Fatal("species recommendation outside options must be rejected")
	}
}

func TestNormalizedRecommendedOptionsRejectsEmptyAndDuplicates(t *testing.T) {
	if _, err := normalizedRecommendedOptions(nil); err == nil {
		t.Fatal("empty recommendations must be rejected")
	}
	if _, err := normalizedRecommendedOptions([]string{"perception", "perception"}); err == nil {
		t.Fatal("duplicate recommendations must be rejected")
	}
}
