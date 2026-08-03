import { describe, expect, it } from 'vitest';

import { resourceMaximumBreakdown } from './resourceInit';
import type { AssembledCharacter } from './assemble';
import type { CharacterContext } from '../mvp/contracts';

const ctx = {
  level: 3,
  hitDie: 'd10',
  profBonus: 2,
  abilityMods: { str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: -1 },
} as CharacterContext;

const assembled = {
  klass: {
    id: 'fighter',
    name: 'Воин',
    hit_die: 'd10',
    resources: { second_wind: { by_level: { 1: 2, 3: 3 }, per: 'short_rest' } },
  },
  subclass: null,
  effects: [],
  actions: [],
  spells: [],
  feats: [],
  resources: [],
} as unknown as AssembledCharacter;

describe('resourceMaximumBreakdown', () => {
  it('explains hit dice through class level and die', () => {
    const result = resourceMaximumBreakdown('hit_dice_d10', ctx, assembled, [], 3);
    expect(result.value).toBe(3);
    expect(result.parts).toEqual([{ value: 3, source: 'Воин', reason: '3 ур. · d10' }]);
  });

  it('explains a by-level class resource', () => {
    const result = resourceMaximumBreakdown('second_wind', ctx, assembled, [], 3);
    expect(result.parts).toEqual([{ value: 3, source: 'Воин', reason: 'значение на 3-м уровне' }]);
  });

  it('makes a persisted legacy override explicit and keeps the sum invariant', () => {
    const result = resourceMaximumBreakdown('unknown', ctx, assembled, [], 2);
    expect(result.parts.reduce((sum, part) => sum + part.value, 0)).toBe(result.value);
    expect(result.parts[0].source).toBe('Сохранённое состояние');
  });
});
