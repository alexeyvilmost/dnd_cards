import { describe, expect, it } from 'vitest';
import {
  isPendingAttackNegated,
  pendingAttackDamage,
  restoreNegatedPendingAttack,
} from './pendingAttack';

describe('pending attack HP channel continuation', () => {
  it('restores damage absorbed entirely by temporary HP back to temporary HP', () => {
    const damage = pendingAttackDamage({ hp: 20, temp: 5 }, { hp: 20, temp: 1 });
    expect(damage).toEqual({ damage: 4, hpDamage: 0, tempHpDamage: 4 });
    expect(restoreNegatedPendingAttack({ hp: 20, maxHp: 20, temp: 1 }, damage))
      .toEqual({ hp: 20, temp: 5 });
  });

  it('restores split damage to its original pools without manufacturing current HP', () => {
    const damage = pendingAttackDamage({ hp: 20, temp: 3 }, { hp: 18, temp: 0 });
    expect(damage).toEqual({ damage: 5, hpDamage: 2, tempHpDamage: 3 });
    expect(restoreNegatedPendingAttack({ hp: 18, maxHp: 30, temp: 0 }, damage))
      .toEqual({ hp: 20, temp: 3 });
  });

  it('keeps an HP-only fallback for pending attacks persisted before channel support', () => {
    expect(restoreNegatedPendingAttack(
      { hp: 10, maxHp: 20, temp: 2 },
      { damage: 4 },
    )).toEqual({ hp: 14, temp: 2 });
  });

  it('uses reaction-produced AC while preserving the critical-hit invariant', () => {
    expect(isPendingAttackNegated({ attackTotal: 17 }, 18)).toBe(true);
    expect(isPendingAttackNegated({ attackTotal: 18 }, 18)).toBe(false);
    expect(isPendingAttackNegated({ attackTotal: 17, crit: true }, 18)).toBe(false);
  });
});
