import { describe, expect, it } from 'vitest';
import { combatHpLabel } from './CombatHotbar';

describe('combat hotbar HP summary', () => {
  it('makes temporary HP visible while it is available', () => {
    expect(combatHpLabel({ current: 4, max: 12, temp: 5 }))
      .toBe('HP 4/12 · Врем. HP +5');
  });

  it('keeps the default summary compact without temporary HP', () => {
    expect(combatHpLabel({ current: 4, max: 12, temp: 0 })).toBe('HP 4/12');
  });
});
