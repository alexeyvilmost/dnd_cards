/**
 * D1: слоты полного кастера by_level. Гарантирует, что залитые в прод (seed-full-caster-
 * slots.mjs) сетки spell_slot_1..9 корректно резолвятся движком в пулы по уровню —
 * т.е. заклинания 2+ круга перестают быть серыми (costKey spell_slot_N существует).
 */
import { describe, expect, it } from 'vitest';
import { initResources, resolveByLevel, maxAvailableSpellSlotLevel } from './resources';
import type { CharacterContext } from '../mvp/contracts';

// Сетка полного кастера PHB 2024 (как залито классам Бард/Жрец/Друид/Чародей/Волшебник).
const FULL_CASTER = {
  spell_slot_1: { by_level: { 1: 2, 2: 3, 3: 4 }, per: 'long_rest' },
  spell_slot_2: { by_level: { 3: 2, 4: 3 }, per: 'long_rest' },
  spell_slot_3: { by_level: { 5: 2, 6: 3 }, per: 'long_rest' },
  spell_slot_4: { by_level: { 7: 1, 8: 2, 9: 3 }, per: 'long_rest' },
  spell_slot_5: { by_level: { 9: 1, 10: 2, 18: 3 }, per: 'long_rest' },
  spell_slot_9: { by_level: { 17: 1 }, per: 'long_rest' },
};

const ctxAt = (level: number): CharacterContext => ({
  abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 },
  profBonus: 2,
  level,
});

describe('D1 — слоты полного кастера by_level', () => {
  it('resolveByLevel берёт значение с макс. ключом ≤ уровня', () => {
    expect(resolveByLevel({ 1: 2, 2: 3, 3: 4 }, 1)).toBe(2);
    expect(resolveByLevel({ 1: 2, 2: 3, 3: 4 }, 5)).toBe(4);
    expect(resolveByLevel({ 3: 2, 4: 3 }, 2)).toBeNull(); // до 3 уровня слотов 2 круга нет
  });

  it('L1: только spell_slot_1=2 (круги 2+ ещё недоступны)', () => {
    const { maxResources } = initResources(ctxAt(1), FULL_CASTER, []);
    expect(maxResources.spell_slot_1).toBe(2);
    expect(maxResources.spell_slot_2).toBeUndefined();
  });

  it('L5: slot1=4, slot2=3, slot3=2, круг 4 ещё нет (стена 3 круга снята)', () => {
    const { maxResources } = initResources(ctxAt(5), FULL_CASTER, []);
    expect(maxResources.spell_slot_1).toBe(4);
    expect(maxResources.spell_slot_2).toBe(3);
    expect(maxResources.spell_slot_3).toBe(2);
    expect(maxResources.spell_slot_4).toBeUndefined();
  });

  it('L17: slot9=1 (заклинание 9 круга кастуемо)', () => {
    const { maxResources } = initResources(ctxAt(17), FULL_CASTER, []);
    expect(maxResources.spell_slot_9).toBe(1);
  });
});

describe('maxAvailableSpellSlotLevel (grant_spells only_available_slots)', () => {
  it('берёт наибольший spell_slot_N с count>0', () => {
    expect(maxAvailableSpellSlotLevel(initResources(ctxAt(1), FULL_CASTER, []).maxResources)).toBe(1);
    expect(maxAvailableSpellSlotLevel(initResources(ctxAt(5), FULL_CASTER, []).maxResources)).toBe(3);
    expect(maxAvailableSpellSlotLevel(initResources(ctxAt(17), FULL_CASTER, []).maxResources)).toBe(9);
  });

  it('нулевые/отсутствующие ячейки не считаются', () => {
    expect(maxAvailableSpellSlotLevel({ spell_slot_1: 0, action: 1 })).toBe(0);
    expect(maxAvailableSpellSlotLevel({ action: 1, bonus_action: 1 })).toBe(0);
  });

  it('колдунские пактовые ячейки тоже учитываются (нативная поддержка)', () => {
    expect(maxAvailableSpellSlotLevel({ warlock_spell_slot_3: 2 })).toBe(3);
    expect(maxAvailableSpellSlotLevel({ pact_slot_2: 2, spell_slot_1: 4 })).toBe(2);
  });
});
