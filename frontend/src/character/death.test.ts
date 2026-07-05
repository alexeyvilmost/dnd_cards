import { describe, expect, it } from 'vitest';
import { applyDamageAtZero, applyDeathSaveRoll, emptyDeathSaves } from './death';

describe('спасброски смерти (PHB 2024)', () => {
  it('10+ — успех; третий успех стабилизирует', () => {
    let ds = emptyDeathSaves();
    ds = applyDeathSaveRoll(ds, 10).next;
    ds = applyDeathSaveRoll(ds, 15).next;
    const third = applyDeathSaveRoll(ds, 19);
    expect(third.outcome).toBe('stable');
    expect(third.next.stable).toBe(true);
  });

  it('меньше 10 — провал; третий провал убивает', () => {
    let ds = emptyDeathSaves();
    ds = applyDeathSaveRoll(ds, 9).next;
    ds = applyDeathSaveRoll(ds, 2).next;
    const third = applyDeathSaveRoll(ds, 5);
    expect(third.outcome).toBe('dead');
    expect(third.next.dead).toBe(true);
  });

  it('нат. 20 — очнуться с 1 хитом и сбросить счётчики', () => {
    let ds = { ...emptyDeathSaves(), successes: 1, failures: 2 };
    const res = applyDeathSaveRoll(ds, 20);
    expect(res.outcome).toBe('revive');
    expect(res.next).toEqual(emptyDeathSaves());
  });

  it('нат. 1 — сразу два провала', () => {
    const res = applyDeathSaveRoll(emptyDeathSaves(), 1);
    expect(res.outcome).toBe('crit_fail');
    expect(res.next.failures).toBe(2);
    expect(applyDeathSaveRoll(res.next, 1).outcome).toBe('dead');
  });

  it('урон в нуле — провал, критический — два; сбивает стабилизацию', () => {
    const one = applyDamageAtZero({ ...emptyDeathSaves(), stable: true });
    expect(one.next.failures).toBe(1);
    expect(one.next.stable).toBe(false);
    const crit = applyDamageAtZero(one.next, true);
    expect(crit.dead).toBe(true);
  });
});
