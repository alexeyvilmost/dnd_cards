import { describe, expect, it } from 'vitest';
import { characterToDraft } from './forgeHelpers';
import {
  CURRENT_CHARACTER_SCHEMA_VERSION,
  DEFAULT_CHARACTER_RULESET_VERSION,
  DEFAULT_CHARACTER_SYSTEM_ID,
  DEFAULT_CHARACTER_TYPE,
  characterMetadataLabel,
  type ForgeCharacter,
} from './types';

function characterFixture(overrides: Partial<ForgeCharacter> = {}): ForgeCharacter {
  return {
    id: 'character-1',
    user_id: 'user-1',
    name: 'Тест',
    system_id: DEFAULT_CHARACTER_SYSTEM_ID,
    ruleset_version: DEFAULT_CHARACTER_RULESET_VERSION,
    character_type: DEFAULT_CHARACTER_TYPE,
    character_schema_version: CURRENT_CHARACTER_SCHEMA_VERSION,
    level: 1,
    max_hp: 10,
    current_hp: 10,
    speed: 30,
    proficiency_bonus: 2,
    created_at: '',
    updated_at: '',
    ...overrides,
    access_mode: overrides.access_mode ?? 'owner',
  };
}

describe('character system metadata', () => {
  it('survives conversion from persisted character to forge draft', () => {
    const draft = characterToDraft(characterFixture());
    expect({
      systemId: draft.systemId,
      rulesetVersion: draft.rulesetVersion,
      characterType: draft.characterType,
      characterSchemaVersion: draft.characterSchemaVersion,
    }).toEqual({
      systemId: 'dnd5e-2024',
      rulesetVersion: '2024',
      characterType: 'free',
      characterSchemaVersion: 1,
    });
  });

  it('renders safe defaults for a pre-migration API response', () => {
    const legacy = characterFixture({
      system_id: undefined as unknown as string,
      ruleset_version: undefined as unknown as string,
      character_type: undefined as unknown as 'free',
    });
    expect(characterMetadataLabel(legacy)).toBe('D&D 5e · 2024 · Свободный лист');
    expect(characterToDraft(legacy).systemId).toBe(DEFAULT_CHARACTER_SYSTEM_ID);
  });
});
