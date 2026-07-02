import { describe, expect, it } from 'vitest';
import { evaluate } from './formula';
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
