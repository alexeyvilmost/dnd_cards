import { describe, expect, it } from 'vitest';
import { buildLibrarySearchParams, parseLibrarySearchParams } from './libraryUrlParams';

describe('library URL filters', () => {
  it('round-trips specialized spell, feat and background filters', () => {
    const source = new URLSearchParams({
      type: 'spells', q: 'огонь', spellLevel: '3', spellClass: 'wizard', spellSubclass: 'evoker',
      spellSchool: 'evocation', concentration: 'true', ritual: 'false', featCategory: 'origin',
      repeatable: 'true', featAbility: 'wis', backgroundAbility: 'int', backgroundSkill: 'arcana',
    });
    const parsed = parseLibrarySearchParams(source);
    const rebuilt = buildLibrarySearchParams(parsed);

    expect(parseLibrarySearchParams(rebuilt)).toEqual(parsed);
  });

  it('removes stale specialized filters when they are cleared', () => {
    const existing = new URLSearchParams('type=spells&spellLevel=3&concentration=true&card=kept');
    const filters = parseLibrarySearchParams(new URLSearchParams());
    const rebuilt = buildLibrarySearchParams(filters, existing);

    expect(rebuilt.get('spellLevel')).toBeNull();
    expect(rebuilt.get('concentration')).toBeNull();
    expect(rebuilt.get('card')).toBe('kept');
  });
});
