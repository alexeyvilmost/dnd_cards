import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../mechanics/collectChoices';
import { optionsForChoice } from './components';

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
});
