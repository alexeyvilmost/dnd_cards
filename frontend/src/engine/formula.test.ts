import { describe, expect, it } from 'vitest';
import { evaluate, describe as describeFormula, isFormulaMarker } from './formula';

const baseCtx = {
  abilityMods: { str: 3, dex: 2, con: 1, int: 4, wis: 0, cha: -1 },
  profBonus: 2,
  selfLevel: 5,
  classLevels: { rogue: 5, barbarian: 3 },
  spellcastingMod: 4,
  spellSlotAbove: 1,
  rageBonus: 2,
  characterSpeed: 30,
  rng: () => 0.5, // d6 → 4, d8 → 5, d10 → 6
};

describe('formula.evaluate', () => {
  it('возвращает число как есть', () => {
    expect(evaluate(7, baseCtx)).toBe(7);
  });

  it('маркер weapon', () => {
    expect(evaluate('weapon', baseCtx)).toBe('weapon');
    expect(isFormulaMarker(evaluate('weapon', baseCtx))).toBe(true);
  });

  it('маркер auto', () => {
    expect(evaluate('auto', baseCtx)).toBe('auto');
  });

  it('prof_bonus и prof', () => {
    expect(evaluate('prof_bonus', baseCtx)).toBe(2);
    expect(evaluate('prof', baseCtx)).toBe(2);
  });

  it('self_level', () => {
    expect(evaluate('self_level', baseCtx)).toBe(5);
  });

  it('модификаторы характеристик', () => {
    expect(evaluate('str', baseCtx)).toBe(3);
    expect(evaluate('dex', baseCtx)).toBe(2);
    expect(evaluate('con', baseCtx)).toBe(1);
    expect(evaluate('int', baseCtx)).toBe(4);
    expect(evaluate('wis', baseCtx)).toBe(0);
    expect(evaluate('cha', baseCtx)).toBe(-1);
  });

  it('spellcasting', () => {
    expect(evaluate('spellcasting', baseCtx)).toBe(4);
  });

  it('spell_slot_above', () => {
    expect(evaluate('spell_slot_above', baseCtx)).toBe(1);
  });

  it('rage_bonus', () => {
    expect(evaluate('rage_bonus', baseCtx)).toBe(2);
  });

  it('character_speed', () => {
    expect(evaluate('character_speed', baseCtx)).toBe(30);
  });

  it('class_level:rogue', () => {
    expect(evaluate('class_level:rogue', baseCtx)).toBe(5);
  });

  it('сложение 8+prof+dex', () => {
    expect(evaluate('8+prof+dex', baseCtx)).toBe(12);
  });

  it('скобки (str+dex)*2', () => {
    expect(evaluate('(str+dex)*2', baseCtx)).toBe(10);
  });

  it('кости 1d8+spellcasting', () => {
    // rng=0.5 → d8=5, +4 = 9
    expect(evaluate('1d8+spellcasting', baseCtx)).toBe(9);
  });

  it('2d6 с фиксированным rng', () => {
    // два броска d6 по 4 = 8
    expect(evaluate('2d6', baseCtx)).toBe(8);
  });

  it('class_level:rogue/2 d6 (скрытая атака)', () => {
    // ceil(5/2)=3 кости d6 по 4 = 12
    expect(evaluate('class_level:rogue/2 d6', baseCtx)).toBe(12);
  });

  it('1d10+3', () => {
    expect(evaluate('1d10+3', baseCtx)).toBe(9);
  });

  it('self_level*2', () => {
    expect(evaluate('self_level*2', baseCtx)).toBe(10);
  });

  it('10+dex+con', () => {
    expect(evaluate('10+dex+con', baseCtx)).toBe(13);
  });

  it('prof_bonus+str', () => {
    expect(evaluate('prof_bonus+str', baseCtx)).toBe(5);
  });

  it('class_level:barbarian+con', () => {
    expect(evaluate('class_level:barbarian+con', baseCtx)).toBe(4);
  });

  it('prof_bonus d4 и prof d4 — число d4 = БМ', () => {
    // БМ=2, d4 при rng=0.5 → 3; 2×3 = 6
    expect(evaluate('prof_bonus d4', baseCtx)).toBe(6);
    expect(evaluate('prof d4', baseCtx)).toBe(6);
  });

  it('self_level d4 — число d4 = уровень', () => {
    // level=5, d4→3; 5×3 = 15
    expect(evaluate('self_level d4', baseCtx)).toBe(15);
  });

  it('числовая переменная dN и делитель', () => {
    const ctx = { ...baseCtx, variables: { rage_damage_modifier: 3 } };
    // 3 d6 → 3×4 = 12; 3/2 d6 → ceil(1.5)=2 → 8
    expect(evaluate('rage_damage_modifier d6', ctx)).toBe(12);
    expect(evaluate('rage_damage_modifier / 2 d6', ctx)).toBe(8);
  });

  it('dice-переменная в X dN запрещена', () => {
    expect(() => evaluate('martial_arts_die d4', {
      ...baseCtx,
      variables: { martial_arts_die: { count: 1, sides: 6 } },
    })).toThrow(/кость/i);
  });

  it('скаляр * кость → N бросков; кость * скаляр → умножить сумму', () => {
    // d4 при rng=0.5 → 3
    expect(evaluate('2 * d4', baseCtx)).toBe(6); // 2к4 = 3+3
    expect(evaluate('d4 * 2', baseCtx)).toBe(6); // один бросок ×2 = 3*2
    // Различие при другом rng: проверим число костей через rollFormula
  });

  it('prof_bonus * martial_arts_die → БМ раз кости переменной', () => {
    const ctx = { ...baseCtx, variables: { martial_arts_die: { count: 1, sides: 6 } } };
    // 2 * 1d6 → 2d6, каждая 4 → 8
    expect(evaluate('prof_bonus * martial_arts_die', ctx)).toBe(8);
    // один бросок d6 × БМ = 4*2 = 8 (совпадает при этом rng, но семантика другая)
    expect(evaluate('martial_arts_die * prof_bonus', ctx)).toBe(8);
  });

  it('rollFormula: скаляр * d4 бросает N костей, d4 * скаляр — одну', async () => {
    const { rollFormula } = await import('./formula');
    const a = rollFormula('3 * d4', baseCtx);
    expect(a.dice).toHaveLength(3);
    const b = rollFormula('d4 * 3', baseCtx);
    expect(b.dice).toHaveLength(1);
    expect(b.total).toBe(b.dice[0].result * 3);
  });
});

describe('formula.describe', () => {
  it('описывает формулу с модификаторами', () => {
    expect(describeFormula('1d8+spellcasting', baseCtx)).toContain('1к8');
    expect(describeFormula('8+prof+dex', baseCtx)).toContain('БМ');
    expect(describeFormula('str', baseCtx)).toContain('СИЛ');
  });

  it('описывает маркер weapon', () => {
    expect(describeFormula('weapon', baseCtx)).toBe('оружие');
  });

  it('описывает scaling dice', () => {
    expect(describeFormula('class_level:rogue/2 d6', baseCtx)).toBe('3к6');
  });

  it('подставляет self_level и переменные только когда они известны', () => {
    expect(describeFormula('1d10 + self_level', baseCtx)).toBe('1к10 + 5');
    expect(describeFormula('1d10 + self_level', {})).toBe('1к10 + self_level');
    expect(describeFormula('self_level d4', baseCtx)).toBe('5к4');
    expect(describeFormula('self_level d4', {})).toBe('self_level к4');
    expect(describeFormula('prof_bonus d4', baseCtx)).toBe('2к4');
    expect(describeFormula('prof d4', {})).toBe('prof к4');
    expect(describeFormula('2 * d4', baseCtx)).toBe('2к4');
    expect(describeFormula('prof_bonus * martial_arts_die', {
      ...baseCtx,
      variables: { martial_arts_die: { count: 1, sides: 6 } },
    })).toBe('2к6');
    expect(describeFormula('d4 * 2', baseCtx)).toBe('1к4 * 2');
    expect(describeFormula('1d8 + martial_arts_die', {
      variables: { martial_arts_die: { count: 1, sides: 6 } },
    })).toBe('1к8 + 1к6');
  });
});

describe('formatFormulaDisplay', () => {
  it('без контекста только кости, с контекстом — известные переменные', async () => {
    const { formatFormulaDisplay } = await import('./formula');
    expect(formatFormulaDisplay('1d10 + self_level')).toBe('1к10 + self_level');
    expect(formatFormulaDisplay('1d10 + self_level', baseCtx)).toBe('1к10 + 5');
  });
});
