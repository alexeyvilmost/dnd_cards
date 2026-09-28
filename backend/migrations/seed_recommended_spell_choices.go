package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// Spell recommendations are presentation/authoring defaults for Forge. They
// live in content_choice_recommendations so certified effect bytes stay intact.
var recommendedSpellChoices = []recommendedChoiceSeed{
	{EntityType: "effect", EntityReference: "EFF-paladin-spellcasting", ChoiceID: "paladin_spells_l1", Options: []string{
		"33c69e7d-7524-421a-9d68-521e1b7fb57a", // Bless
		"8d98d8f6-7085-48cd-b2a4-1f18cd8470d9", // Cure Wounds
	}},
	{EntityType: "effect", EntityReference: "EFF-cleric-spellcasting", ChoiceID: "cleric_cantrips", Options: []string{
		"70dcdadd-7e66-43f0-81b1-1fd1d346d9b7", // Guidance
		"8cddf152-e406-4c7a-8d34-cc8bcbfc0dfa", // Sacred Flame
		"8b708d7b-097e-4624-8a41-c8c8e00f044c", // Thaumaturgy
	}},
	{EntityType: "effect", EntityReference: "EFF-cleric-spellcasting", ChoiceID: "cleric_spells_l1", Options: []string{
		"33c69e7d-7524-421a-9d68-521e1b7fb57a", // Bless
		"8d98d8f6-7085-48cd-b2a4-1f18cd8470d9", // Cure Wounds
		"851027a9-0b6a-49d1-9f61-5eef831bf297", // Guiding Bolt
		"ddb5e045-045c-45ce-ab5e-4d6a489be913", // Healing Word
	}},
	{EntityType: "effect", EntityReference: "EFF-bard-spellcasting", ChoiceID: "bard_cantrips", Options: []string{
		"bdeda1c3-6574-4946-8b91-5faf0f76072c", // Vicious Mockery
		"70e35366-5446-49ff-b0b9-759dbbff347e", // Mage Hand
	}},
	{EntityType: "effect", EntityReference: "EFF-bard-spellcasting", ChoiceID: "bard_spells_l1", Options: []string{
		"ddb5e045-045c-45ce-ab5e-4d6a489be913", // Healing Word
		"8821d595-ec03-42b8-aeaf-f50f7d72b726", // Dissonant Whispers
		"4abefac8-329b-4c70-a59a-84dca2d194d3", // Tasha's Hideous Laughter
		"a6c7db7d-f35c-4072-a5eb-29d4d58be93e", // Charm Person
	}},
	{EntityType: "effect", EntityReference: "EFF-druid-spellcasting", ChoiceID: "druid_cantrips", Options: []string{
		"3c68b9a7-d143-4b39-b06c-3d78e3276117", // Druidcraft
		"ba23242c-eb9c-46a6-ba01-ebdc3b5b9618", // Produce Flame
	}},
	{EntityType: "effect", EntityReference: "EFF-druid-spellcasting", ChoiceID: "druid_spells_l1", Options: []string{
		"4291b817-6869-4f87-afae-5bd1a37aee3f", // Goodberry
		"b347be07-68e7-4cd1-8a5a-222e206711c2", // Entangle
		"b132a28e-f6c9-4832-924b-1a680390e7fb", // Faerie Fire
		"8d98d8f6-7085-48cd-b2a4-1f18cd8470d9", // Cure Wounds
	}},
	{EntityType: "effect", EntityReference: "EFF-ranger-spellcasting", ChoiceID: "ranger_spells_l1", Options: []string{
		"8c2702cd-4cfa-4c02-919a-178bd2196ca4", // Hunter's Mark
		"8d98d8f6-7085-48cd-b2a4-1f18cd8470d9", // Cure Wounds
	}},
	{EntityType: "effect", EntityReference: "EFF-sorcerer-spellcasting", ChoiceID: "sorcerer_cantrips", Options: []string{
		"50626b5a-33c5-46e0-af0e-50599f4306a0", // Fire Bolt
		"70e35366-5446-49ff-b0b9-759dbbff347e", // Mage Hand
		"e47e71cb-f44e-402e-91af-e6fad63982dc", // Prestidigitation
		"ebe432dd-c124-4f79-a39b-db14ca2ed741", // Ray of Frost
	}},
	{EntityType: "effect", EntityReference: "EFF-sorcerer-spellcasting", ChoiceID: "sorcerer_spells_known", Options: []string{
		"938a86fd-e0bf-4845-b4b3-acfe2fed2b59", // Magic Missile
		"d87f4507-849f-450b-b328-0198cb011587", // Shield
	}},
	{EntityType: "effect", EntityReference: "EFF-warlock-spellcasting", ChoiceID: "warlock_cantrips", Options: []string{
		"0f0eca67-f241-4f1a-b01b-37c6f16adea2", // Eldritch Blast
		"70e35366-5446-49ff-b0b9-759dbbff347e", // Mage Hand
	}},
	{EntityType: "effect", EntityReference: "EFF-warlock-spellcasting", ChoiceID: "warlock_spells_known", Options: []string{
		"b6cb9612-8dea-4949-bbd5-595bd5501beb", // Hex
		"f55f58e8-a6f9-4c97-ab6f-8e7f385591d0", // Armor of Agathys
	}},
}

func validateEffectSpellRecommendation(raw []byte, choiceID string, recommended []string) error {
	var mechanics any
	if err := json.Unmarshal(raw, &mechanics); err != nil {
		return fmt.Errorf("decode effect mechanics: %w", err)
	}
	choice := findChoiceDeclaration(mechanics, choiceID)
	if choice == nil {
		return fmt.Errorf("choice %q is absent", choiceID)
	}
	options, ok := choice["options"].(map[string]any)
	if !ok || options["source"] != "spell" {
		return fmt.Errorf("choice %q is not a spell choice", choiceID)
	}
	count, ok := choice["count"].(float64)
	if !ok || int(count) != len(recommended) {
		return fmt.Errorf("recommendation count does not match choice %q", choiceID)
	}
	return nil
}

func seedRecommendedSpellChoices(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, seed := range recommendedSpellChoices {
		options, normalizeErr := normalizedRecommendedOptions(seed.Options)
		if normalizeErr != nil {
			return fmt.Errorf("%s:%s: %w", seed.EntityReference, seed.ChoiceID, normalizeErr)
		}
		var raw []byte
		if err := tx.QueryRow(`
			SELECT mechanics FROM effects
			WHERE card_number = $1 AND deleted_at IS NULL
		`, seed.EntityReference).Scan(&raw); err != nil {
			return fmt.Errorf("read %s mechanics: %w", seed.EntityReference, err)
		}
		if err := validateEffectSpellRecommendation(raw, seed.ChoiceID, options); err != nil {
			return fmt.Errorf("%s: %w", seed.EntityReference, err)
		}
		for _, option := range options {
			var exists bool
			if err := tx.QueryRow(`
				SELECT EXISTS(
					SELECT 1 FROM spells
					WHERE (id::text = $1 OR card_number = $1) AND deleted_at IS NULL
				)
			`, option).Scan(&exists); err != nil {
				return fmt.Errorf("lookup spell %s: %w", option, err)
			}
			if !exists {
				return fmt.Errorf("%s:%s recommends unknown spell %s", seed.EntityReference, seed.ChoiceID, option)
			}
		}
		if err := upsertChoiceRecommendation(tx, seed, options); err != nil {
			return fmt.Errorf("seed %s:%s recommendation: %w", seed.EntityReference, seed.ChoiceID, err)
		}
	}
	return tx.Commit()
}

func removeRecommendedSpellChoices(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, seed := range recommendedSpellChoices {
		if _, err := tx.Exec(`
			DELETE FROM content_choice_recommendations
			WHERE entity_type = $1 AND entity_reference = $2 AND choice_id = $3
		`, seed.EntityType, seed.EntityReference, seed.ChoiceID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
