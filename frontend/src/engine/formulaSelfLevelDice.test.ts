/**
 * Токенизатор self_level dN: бросок «уровень персонажа [/делитель]» раз кости dN
 * (по образцу class_level:X/Y dZ). Раньше «self_level d4» падало с «Лишние символы».
 */
import { describe, expect, it } from 'vitest';
import { rollFormula } from './formula';

// rng=0 → каждая кость = floor(0*sides)+1 = 1, поэтому total == число костей.
const ctx = (level: number) => ({ selfLevel: level, abilityMods: { con: 2 }, rng: () => 0 });

describe('self_level dN — масштабирование кубиков по уровню персонажа', () => {
  it('self_level d4 → «уровень» честных костей d4', () => {
    const r = rollFormula('self_level d4', ctx(5));
    expect(r.dice.length).toBe(5); // 5 отдельных костей (не 1 кость ×5)
    expect(r.dice.every((d) => d.sides === 4)).toBe(true);
    expect(r.total).toBe(5); // 5×1
  });

  it('self_level / 2 d6 → ceil(уровень/2) костей d6', () => {
    const r = rollFormula('self_level / 2 d6', ctx(5));
    expect(r.dice.length).toBe(3); // ceil(5/2)=3
    expect(r.dice.every((d) => d.sides === 6)).toBe(true);
  });

  it('self_level без dN — по-прежнему скаляр-слагаемое, не бросок', () => {
    const r = rollFormula('self_level', ctx(5));
    expect(r.dice.length).toBe(0);
    expect(r.total).toBe(5);
  });

  it('композиция: self_level d4 + con', () => {
    const r = rollFormula('self_level d4 + con', ctx(3)); // 3 кости d4 (=1) + con(2)
    expect(r.dice.length).toBe(3);
    expect(r.total).toBe(3 + 2);
  });

  it('0 уровень → 0 костей', () => {
    const r = rollFormula('self_level d8', ctx(0));
    expect(r.dice.length).toBe(0);
    expect(r.total).toBe(0);
  });
});
