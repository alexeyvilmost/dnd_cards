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
});
