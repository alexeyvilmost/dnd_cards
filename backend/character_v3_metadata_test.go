package main

import "testing"

func metadataString(value string) *string { return &value }
func metadataInt(value int) *int          { return &value }

func TestRequestedCharacterMetadataDefaults(t *testing.T) {
	system, ruleset, characterType, schema := requestedCharacterMetadata(nil, nil, nil, nil)
	if system != DefaultCharacterSystemID ||
		ruleset != DefaultCharacterRuleset ||
		characterType != DefaultCharacterType ||
		schema != CurrentCharacterSchemaVersion {
		t.Fatalf("unexpected defaults: %s %s %s %d", system, ruleset, characterType, schema)
	}
	if err := validateNewCharacterMetadata(system, ruleset, characterType, schema); err != nil {
		t.Fatalf("default metadata must be valid: %v", err)
	}
}

func TestNewCharacterRejectsUnsupportedMetadata(t *testing.T) {
	tests := []struct {
		name          string
		system        string
		ruleset       string
		characterType string
		schema        int
	}{
		{"other system", "cyberpunk-red", DefaultCharacterRuleset, DefaultCharacterType, CurrentCharacterSchemaVersion},
		{"other ruleset", DefaultCharacterSystemID, "2014", DefaultCharacterType, CurrentCharacterSchemaVersion},
		{"campaign flow not ready", DefaultCharacterSystemID, DefaultCharacterRuleset, "campaign", CurrentCharacterSchemaVersion},
		{"unknown type", DefaultCharacterSystemID, DefaultCharacterRuleset, "npc", CurrentCharacterSchemaVersion},
		{"future schema", DefaultCharacterSystemID, DefaultCharacterRuleset, DefaultCharacterType, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateNewCharacterMetadata(tt.system, tt.ruleset, tt.characterType, tt.schema); err == nil {
				t.Fatal("expected metadata validation error")
			}
		})
	}
}

func TestCharacterSystemMetadataIsImmutableThroughOrdinaryUpdate(t *testing.T) {
	character := CharacterV3{
		SystemID:               DefaultCharacterSystemID,
		RulesetVersion:         DefaultCharacterRuleset,
		CharacterType:          DefaultCharacterType,
		CharacterSchemaVersion: CurrentCharacterSchemaVersion,
	}
	if err := validateCharacterMetadataUpdate(character, UpdateCharacterV3Request{
		SystemID:               metadataString(DefaultCharacterSystemID),
		RulesetVersion:         metadataString(DefaultCharacterRuleset),
		CharacterType:          metadataString(DefaultCharacterType),
		CharacterSchemaVersion: metadataInt(CurrentCharacterSchemaVersion),
	}); err != nil {
		t.Fatalf("same metadata must be accepted: %v", err)
	}

	if err := validateCharacterMetadataUpdate(character, UpdateCharacterV3Request{
		SystemID: metadataString("cyberpunk-red"),
	}); err == nil {
		t.Fatal("system change must be rejected")
	}
	if err := validateCharacterMetadataUpdate(character, UpdateCharacterV3Request{
		RulesetVersion: metadataString("2014"),
	}); err == nil {
		t.Fatal("ruleset change must be rejected")
	}
	if err := validateCharacterMetadataUpdate(character, UpdateCharacterV3Request{
		CharacterType: metadataString("campaign"),
	}); err == nil {
		t.Fatal("character type change must be rejected")
	}
}
