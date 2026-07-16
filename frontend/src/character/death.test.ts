import { describe, expect, it } from 'vitest';
import { applyDamageAtZero, applyDeathSaveRoll, emptyDeathSaves, rollDeathSaveDie } from './death';
import type { RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
const freshState = (): RuntimeState => ({
  hp: { current: 0, max: 20, temp: 0 }, resources: {}, maxResources: {},
  equipment: {}, inventory: [], activeEffects: [],
});
/** Пассивка-механика с одним payload (форма из движка: effects→result). */
const passive = (payload: Dict): Dict => ({ effects: [{ resolution: 'auto', result: [payload] }] });
/** rng, выдающий заранее заданную последовательность значений в [0,1). */
const seqRng = (values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

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

describe('rollDeathSaveDie (KB-042: правила бросков и преимущество)', () => {
  // rollDie(faces, rng) = floor(rng()*faces)+1. rng=0 → 1; rng=0.7 → 15 (при faces=20).
  const NAT1 = 0;
  const HIGH = 0.7; // → 15

  it('Везение полурослика перебрасывает натуральную 1 (reroll на roll:d20)', () => {
    const luck = passive({ kind: 'modifier', applies_to: { roll: 'd20' }, op: 'reroll', natural: { max: 1 } });
    const state: RuntimeState = { ...freshState(), activeEffects: [{ id: 'l', name: 'Везение', mechanics: luck } as never] };
    const roll = rollDeathSaveDie(state, [], {}, seqRng([NAT1, HIGH]));
    const kept = roll.dice.find((d) => !d.discarded);
    expect(kept?.result).toBe(15); // переброшенная кость, а не исходная 1
    expect(roll.dice.some((d) => d.discarded && d.result === 1)).toBe(true);
  });

  it('без Везения натуральная 1 остаётся (нет переброса → два провала по applyDeathSaveRoll)', () => {
    const roll = rollDeathSaveDie(freshState(), [], {}, seqRng([NAT1, HIGH]));
    const kept = roll.dice.find((d) => !d.discarded);
    expect(kept?.result).toBe(1);
    expect(applyDeathSaveRoll(emptyDeathSaves(), 1).next.failures).toBe(2);
  });

  it('беcфильтровое преимущество на спасбросок применяется к death save', () => {
    const adv = passive({ kind: 'modifier', applies_to: { roll: 'saving_throw' }, op: 'advantage' });
    const roll = rollDeathSaveDie(freshState(), [adv], {}, seqRng([NAT1, HIGH]));
    expect(roll.advantage).toBe('advantage');
    // при преимуществе берётся большая из двух костей (1 и 15) → 15
    expect(roll.dice.find((d) => !d.discarded)?.result).toBe(15);
  });

  it('преимущество на спас С ФИЛЬТРОМ (напр. против яда) на death save НЕ распространяется', () => {
    const advPoison = passive({ kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'con' } }, op: 'advantage' });
    const roll = rollDeathSaveDie(freshState(), [advPoison], {}, seqRng([NAT1, HIGH]));
    expect(roll.advantage).toBe('none');
  });
});
