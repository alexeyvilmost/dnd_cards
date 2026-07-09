/**
 * C8: value_method характеристики (парадигма №3). Характеристика = максимум(база+ASI, ...value_method).
 * Флагман — Пояс силы огра (семантика): СИЛ становится 19, если ниже; уже-высокую не опускает; магия не
 * режется потолком 20. Тесты дискриминирующие: до C8 характеристика была чистым base+delta. NB: источник
 * здесь — ЭФФЕКТ (черта/класс/раса); value_method от ПРЕДМЕТА пока не доходит до резолвера (отдельный слайс).
 */
import { describe, expect, it } from 'vitest';
import { resolveCharacterRules } from './resolveCharacterRules';
import { emptyDraft, type CharacterDraft } from '../types';
import type { AssembledCharacter, OriginEffect } from '../assemble';

const ORIGIN = { kind: 'other', id: 'belt', name: 'Пояс силы огра' } as const;

function build(mechanics: unknown, str: number) {
  const effect = { id: 'belt-eff', name: 'Пояс', mechanics } as unknown as OriginEffect['effect'];
  const assembled = {
    race: { id: 'x', name: 'x', speed: 30 }, klass: null, subclass: null, background: null,
    feats: [], effects: [{ effect, origin: ORIGIN }], actions: [], spells: [],
    pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
  const draft: CharacterDraft = { ...emptyDraft(), abilities: { str, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, level: 5 };
  return resolveCharacterRules({ draft, assembled });
}
const belt = (formula: string): unknown => ({ effects: [{ kind: 'value_method', target: 'str', formula }] });

describe('C8 — value_method характеристики (Пояс силы огра)', () => {
  it('поднимает низкую СИЛ до значения метода (max)', () => {
    expect(build(belt('19'), 12).abilities.str).toBe(19);
  });
  it('НЕ опускает уже-высокую СИЛ', () => {
    expect(build(belt('19'), 20).abilities.str).toBe(20);
  });
  it('метод может превышать потолок 20 (Пояс силы великана 25)', () => {
    expect(build(belt('25'), 15).abilities.str).toBe(25);
  });
  it('без value_method — обычная база (регресс аддитивного пути)', () => {
    expect(build({ effects: [] }, 14).abilities.str).toBe(14);
  });
  it('взаимодействие с ASI: max(база+ASI, метод)', () => {
    const mech = { effects: [{ kind: 'grant_ability_score', ability: 'str', amount: 2 }, { kind: 'value_method', target: 'str', formula: '19' }] };
    expect(build(mech, 16).abilities.str).toBe(19); // 16+2=18 vs 19 → 19
    expect(build(mech, 18).abilities.str).toBe(20); // 18+2=20 vs 19 → 20 (ASI выигрывает)
  });
  it('прирост от метода доходит до модификатора характеристики (СИЛ 19 → +4)', () => {
    expect(build(belt('19'), 12).abilityMods.str).toBe(4);
  });
  it('уровневая формула резолвится (preFctx: self_level)', () => {
    expect(build(belt('10 + self_level'), 12).abilities.str).toBe(15); // level 5 → 10+5=15
  });
});
