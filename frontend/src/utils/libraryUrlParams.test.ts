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
    expect(rebuilt.has('featCategory')).toBe(false);
    expect(rebuilt.has('backgroundSkill')).toBe(false);

    expect(parseLibrarySearchParams(rebuilt)).toEqual(parsed);
  });

  it.each(['cards','actions','spells','effects','races','classes','backgrounds','feats','resources','variables','concepts','passives'])('scopes rarity and facets to %s', type => {
    const parsed=parseLibrarySearchParams(new URLSearchParams({type,rarity:'rare',actionMode:'reaction',technical:'true',raceSize:'Средний',hitDie:'d8',narrative:'true'}));
    const params=buildLibrarySearchParams(parsed);
    expect(params.has('rarity')).toBe(type==='cards');
    expect(params.has('actionMode')).toBe(type==='actions');
    expect(params.has('technical')).toBe(type==='effects');
    expect(params.has('raceSize')).toBe(type==='races');
    expect(params.has('hitDie')).toBe(type==='classes');
    expect(params.has('narrative')).toBe(type==='actions'||type==='spells');
    expect(parseLibrarySearchParams(params)).toEqual(parsed);
  });

  it('removes stale specialized filters when they are cleared', () => {
    const existing = new URLSearchParams('type=spells&spellLevel=3&concentration=true&card=kept');
    const filters = parseLibrarySearchParams(new URLSearchParams());
    const rebuilt = buildLibrarySearchParams(filters, existing);

    expect(rebuilt.get('spellLevel')).toBeNull();
    expect(rebuilt.get('concentration')).toBeNull();
    expect(rebuilt.get('card')).toBe('kept');
  });

  it('preserves mechanic source filters on reload and removes them on reset', () => {
    const source = new URLSearchParams('type=effects&referenceState=linked&referenceType=class&referenceId=fighter&referenceLevel=3');
    const filters = parseLibrarySearchParams(source);
    expect(filters).toMatchObject({ referenceState: 'linked', referenceType: 'class', referenceId: 'fighter', referenceLevel: '3' });
    expect(parseLibrarySearchParams(buildLibrarySearchParams(filters))).toEqual(filters);
    const reset = buildLibrarySearchParams({ ...filters, referenceState: '', referenceType: '', referenceId: '', referenceLevel: '' }, source);
    expect(reset.has('referenceState')).toBe(false);
    expect(reset.has('referenceType')).toBe(false);
    expect(reset.has('referenceId')).toBe(false);
    expect(reset.has('referenceLevel')).toBe(false);
  });
});
