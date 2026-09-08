import { describe, expect, it } from 'vitest';
import { evaluate, formatFormulaDisplay } from './formula';
import { FIGHTER_CTX } from '../mvp/fixtures';

describe('min/max в формулах (R7)', () => {
  it('12+min(dex,2) для средней брони', () => {
    const v = evaluate('12+min(dex,2)', {
      abilityMods: FIGHTER_CTX.abilityMods,
      profBonus: FIGHTER_CTX.profBonus,
    });
    expect(v).toBe(14); // 12 + min(2,2)
  });
});


it('folds scalar functions in dice previews without consulting RNG', () => {
  const ctx = { classLevels: { warrior: 3 }, abilityMods: { str: 3, dex: 2 },
    variables: { superiority_die: { count: 1, sides: 8 } }, rng: () => { throw Error('Preview must not roll'); } };
  expect(formatFormulaDisplay('superiority_die + floor(class_level:warrior / 2)', ctx)).toBe('1к8 + 1');
  expect(formatFormulaDisplay('superiority_die + max(str, dex)', ctx)).toBe('1к8 + 3');
  expect(formatFormulaDisplay('1d8 + max(1, floor(class_level:warrior / 2))', ctx)).toBe('1к8 + 1');
  expect(formatFormulaDisplay('1d8 + floor(class_level:missing / 2)', ctx)).toContain('class_level:missing');
  expect(formatFormulaDisplay('max(1d8, 2)', ctx)).toContain('1к8');
});
