/**
 * Фаза F — детализация значений листа (F2).
 * Зелёный набор = «можно понять базовое значение и какие бонусы влияют».
 */
import { describe, expect, it } from 'vitest';
import { breakdownValue } from './contracts';
import { equippedFighterState, FIGHTER_CTX, FIGHTER_CTX_EQUIPPED, freshFighterState } from './fixtures';

describe('F2: breakdownValue', () => {
  it('КЗ: сумма частей равна значению, у каждой части есть источник', () => {
    const bd = breakdownValue('ac', FIGHTER_CTX_EQUIPPED, equippedFighterState(), []);
    expect(bd.parts.length).toBeGreaterThanOrEqual(2);
    expect(bd.parts.reduce((s, p) => s + p.value, 0)).toBe(bd.value);
    expect(bd.parts.every((p) => p.source.length > 0)).toBe(true);
  });

  it('макс. HP: кость хитов + ТЕЛ видны раздельно', () => {
    const bd = breakdownValue('max_hp', FIGHTER_CTX, freshFighterState(), []);
    expect(bd.value).toBe(11);
    expect(bd.parts.reduce((s, p) => s + p.value, 0)).toBe(11);
    expect(bd.parts.some((p) => p.value === 10)).toBe(true); // d10 максимум на 1 уровне
    expect(bd.parts.some((p) => p.value === 1)).toBe(true);  // ТЕЛ
  });

  it('макс. HP волшебника: d6 + ТЕЛ, не d8', () => {
    const wizardCtx = {
      abilityMods: { str: 0, dex: 2, con: 1, int: 3, wis: 0, cha: -1 },
      profBonus: 2,
      level: 1,
      classLevels: { wizard: 1 },
      hitDie: 'd6',
    };
    const bd = breakdownValue('max_hp', wizardCtx, freshFighterState(), []);
    expect(bd.value).toBe(7);
    expect(bd.parts.some((p) => p.value === 6 && p.reason === 'd6')).toBe(true);
  });

  it('спасбросок с владением: характеристика + БМ раздельно', () => {
    const bd = breakdownValue('save:str', FIGHTER_CTX, freshFighterState(), []);
    // Воин владеет спасбросками СИЛ/ТЕЛ: +2 СИЛ + 2 БМ
    expect(bd.value).toBe(4);
    expect(bd.parts).toHaveLength(2);
  });

  it('навык без владения: только характеристика', () => {
    const bd = breakdownValue('skill:arcana', FIGHTER_CTX, freshFighterState(), []);
    expect(bd.value).toBe(1); // ИНТ +1
    expect(bd.parts).toHaveLength(1);
  });

  it('инициатива и скорость имеют разбивку', () => {
    expect(breakdownValue('initiative', FIGHTER_CTX, freshFighterState(), []).value).toBe(2);
    expect(breakdownValue('speed', FIGHTER_CTX, freshFighterState(), []).value).toBe(30);
  });

  it('временный модификатор (активный эффект) появляется в разбивке с источником-эффектом', () => {
    const state = freshFighterState();
    state.activeEffects.push({
      id: 'ac-buff', name: 'Щит веры',
      mechanics: {
        activation: { mode: 'passive' },
        effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+2' }] }],
      },
      source: 'заклинание',
    });
    const bd = breakdownValue('ac', FIGHTER_CTX, state, []);
    expect(bd.value).toBe(14); // 10 + 2 ЛВК + 2 эффект
    expect(bd.parts.some((p) => p.source.includes('Щит веры'))).toBe(true);
  });
});
