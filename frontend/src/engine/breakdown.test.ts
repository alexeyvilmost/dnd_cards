import { describe, expect, it } from 'vitest';
import { breakdownValue } from './breakdown';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

const character: CharacterContext = {
  abilityScores: { str: 17 },
  abilityMods: { str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  abilitySources: {
    str: [
      { value: 15, source: 'Point-buy', reason: 'база' },
      { value: 2, source: 'Предыстория: Солдат', reason: 'бонус распределения' },
    ],
  },
  profBonus: 2,
  level: 1,
};

describe('MM4 — breakdown характеристик', () => {
  it('показывает постоянные источники и сохраняет сумму итогового значения', () => {
    const result = breakdownValue('ability:str', character, {} as RuntimeState, []);

    expect(result.value).toBe(17);
    expect(result.parts.map((part) => part.source)).toEqual(['Point-buy', 'Предыстория: Солдат']);
    expect(result.parts.reduce((sum, part) => sum + part.value, 0)).toBe(result.value);
  });

  it('выводит модификатор от той же итоговой характеристики', () => {
    const result = breakdownValue('ability_mod:str', character, {} as RuntimeState, []);

    expect(result.value).toBe(3);
    expect(result.parts[0]).toMatchObject({ value: 3, source: 'модификатор СИЛ' });
  });
});
