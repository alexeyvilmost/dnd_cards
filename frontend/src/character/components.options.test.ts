import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../mechanics/collectChoices';
import { optionsForChoice } from './components';
import { WEAPON_TYPE_PROFICIENCY_CATEGORY } from '../mechanics/registries';

const origin: PendingChoice['origin'] = {
  kind: 'feat',
  id: 'feat:magic-initiate',
  name: 'Посвящённый в магию',
};

function abilityChoice(overrides: Partial<PendingChoice> = {}): PendingChoice {
  return {
    id: 'magic_initiate_spellcasting_ability',
    prompt: 'Выберите характеристику заклинаний',
    count: 1,
    source: 'ability',
    origin,
    ...overrides,
  };
}

describe('optionsForChoice explicit option domains', () => {
  it('uses an entity-declared ability subset instead of expanding the global registry', () => {
    expect(optionsForChoice(abilityChoice({
      items: [
        { id: 'int', name: 'Интеллект' },
        { id: 'wis', name: 'Мудрость' },
        { id: 'cha', name: 'Харизма' },
      ],
    }))).toEqual([
      { id: 'int', label: 'Интеллект' },
      { id: 'wis', label: 'Мудрость' },
      { id: 'cha', label: 'Харизма' },
    ]);
  });

  it('keeps the reusable full ability registry when no explicit domain is declared', () => {
    expect(optionsForChoice(abilityChoice()).map((option) => option.id))
      .toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  });

  it('presents terse data-owned half-feat ability ids with readable labels', () => {
    expect(optionsForChoice(abilityChoice({
      source: 'explicit',
      grant: { kind: 'grant_ability_score', amount: 1, cap: 20 },
      items: [
        { id: 'str', name: 'str' },
        { id: 'dex', name: 'dex' },
      ],
    }))).toEqual([
      { id: 'str', label: 'Сила' },
      { id: 'dex', label: 'Ловкость' },
    ]);
  });

  it('hides explicit options above the owning class level', () => {
    const invocation = abilityChoice({
      source: 'effect',
      origin: { kind: 'class', id: 'warlock', name: 'Warlock', owningClassLevel: 2 },
      items: [
        { id: 'level-2', name: 'Level 2', minimumClassLevel: 2 },
        { id: 'level-5', name: 'Level 5', minimumClassLevel: 5 },
      ],
    });
    expect(optionsForChoice(invocation).map((option) => option.id)).toEqual(['level-2']);
    expect(optionsForChoice({
      ...invocation,
      origin: { ...invocation.origin, owningClassLevel: 5 },
    }).map((option) => option.id)).toEqual(['level-2', 'level-5']);
  });

  it('expands Weapon Master from the shared weapon-type catalog', () => {
    const options = optionsForChoice({
      id: 'feat_weapon_mastery', prompt: 'Вид оружия', count: 1, source: 'weapon', origin,
      grant: { kind: 'grant_weapon_mastery' },
    });
    expect(options.length).toBeGreaterThan(10);
    expect(options.some((option) => option.id === 'longsword')).toBe(true);
    expect(WEAPON_TYPE_PROFICIENCY_CATEGORY.longsword).toBe('martial');
    expect(WEAPON_TYPE_PROFICIENCY_CATEGORY.dagger).toBe('simple');
  });
});
