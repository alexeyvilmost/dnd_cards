import { describe, expect, it } from 'vitest';
import { carryingCapacity, carrySizeMultiplier } from '../character/runtime';
import { breakdownValue } from './breakdown';
import { startTurn, shortRest } from './turn';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

const ctx = (baseSize = 2): CharacterContext =>
  ({ abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5, baseSize });

function stateFx(effects: RuntimeState['activeEffects']): RuntimeState {
  return { hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: effects };
}
const sizeFx = (rounds: number) => ({
  id: 'lf', name: 'Большая форма', source: 'Большая форма', roundsLeft: rounds,
  mechanics: { kind: 'modifier', applies_to: { roll: 'size' }, op: 'add', value: '1' },
});

describe('Грузоподъёмность с учётом размера (Мощное телосложение)', () => {
  it('множитель размера: Крошечный ×0.5, Средний ×1, Большой ×2, Огромный ×4', () => {
    expect(carrySizeMultiplier(0)).toBe(0.5);
    expect(carrySizeMultiplier(2)).toBe(1);
    expect(carrySizeMultiplier(3)).toBe(2);
    expect(carrySizeMultiplier(4)).toBe(4);
  });
  it('Сила 15: Средний 225 фн, «на размер больше» (Мощное телосложение) 450 фн', () => {
    expect(carryingCapacity(15, 2)).toBe(225);
    expect(carryingCapacity(15, 3)).toBe(450);
  });
});

describe('Размер как значение с модификаторами (breakdown size) — Большая форма', () => {
  it('база = baseSize; активный эффект size +1 повышает на категорию', () => {
    expect(breakdownValue('size', ctx(2), stateFx([]), []).value).toBe(2);
    expect(breakdownValue('size', ctx(2), stateFx([sizeFx(10)]), []).value).toBe(3);
  });
});

describe('Раунд-таймерные эффекты: истечение по ходам + короткий отдых = 600 раундов', () => {
  it('эффект с roundsLeft истекает через N начал хода', () => {
    let s = stateFx([sizeFx(2)]);
    s = startTurn(s).state;
    expect(s.activeEffects.length).toBe(1); // 2 → 1
    s = startTurn(s).state;
    expect(s.activeEffects.length).toBe(0); // 1 → 0, истёк
  });
  it('короткий отдых снимает раунд-таймерный эффект (истекло 600 раундов = 1 час)', () => {
    const res = shortRest(stateFx([sizeFx(10)]), { ...ctx(), resourceRecharge: {} } as CharacterContext);
    expect(res.state.activeEffects.length).toBe(0);
  });
});
