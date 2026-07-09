/**
 * C6: единый резолвер длительностей. Модификатор с duration.rounds теперь ИСТЕКАЕТ (раньше висел
 * вечно — roundsLeft не выставлялся); без длительности — «стоячий» (manual); длинный отдых обнуляет
 * временные хиты. Тесты дискриминирующие: до C6 первый падал бы (модификатор не истекал).
 */
import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import { startTurn, longRest } from './turn';
import { collectModifiers } from './modifiers';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };
const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
const fresh = (over: Partial<RuntimeState> = {}): RuntimeState => ({ hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [], ...over });

// Действие: даёт себе +2 к атаке (опц. на N раундов).
const buff = (duration?: Dict): Dict => ({
  name: 'Бафф', activation: { cost: [] },
  effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '2', ...(duration ? { duration } : {}) }] }],
});
const hasAtkMod = (state: RuntimeState) => collectModifiers(state, [], { roll: 'attack' }).modifiers.some((m) => m.value === 2);

describe('C6 — длительности стоячих эффектов', () => {
  it('модификатор с duration.rounds истекает после тиков начала хода', () => {
    const { state } = executeAction(fresh(), buff({ type: 'rounds', amount: 2 }), { character, rng: () => 0.5 } as unknown as Ctx);
    expect(hasAtkMod(state)).toBe(true);            // применён
    const t1 = startTurn(state).state;              // раунд 1: 2 → 1
    expect(hasAtkMod(t1)).toBe(true);
    const t2 = startTurn(t1).state;                 // раунд 2: 1 → 0 → истёк
    expect(hasAtkMod(t2)).toBe(false);
  });

  it('модификатор без длительности сохраняется через ходы (manual)', () => {
    const { state } = executeAction(fresh(), buff(), { character, rng: () => 0.5 } as unknown as Ctx);
    const after = startTurn(startTurn(state).state).state;
    expect(hasAtkMod(after)).toBe(true);
  });

  it('длинный отдых обнуляет временные хиты', () => {
    const { state } = longRest(fresh({ hp: { current: 20, max: 20, temp: 7 } }), character);
    expect(state.hp.temp).toBe(0);
  });

  it('состояние с duration.rounds по-прежнему истекает (регрессия)', () => {
    const cond: Dict = { name: 'Яд', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'condition', value: 'poisoned', duration: { type: 'rounds', amount: 1 } }] }] };
    const { state } = executeAction(fresh(), cond, { character, rng: () => 0.5 } as unknown as Ctx);
    expect(state.activeEffects.some((e) => (e.mechanics as Dict).value === 'poisoned')).toBe(true);
    const t1 = startTurn(state).state;              // 1 → 0 → истёк
    expect(t1.activeEffects.some((e) => (e.mechanics as Dict).value === 'poisoned')).toBe(false);
  });

  it('невалидный amount (0 / формула «1d4») НЕ делает эффект вечным — истекает через 1 раунд', () => {
    const ctx = { character, rng: () => 0.5 } as unknown as Ctx;
    const s0 = executeAction(fresh(), buff({ type: 'rounds', amount: 0 }), ctx).state;
    expect(hasAtkMod(s0)).toBe(true);                       // применён
    expect(hasAtkMod(startTurn(s0).state)).toBe(false);    // 0 → не вечный, истёк за 1 раунд
    const sF = executeAction(fresh(), buff({ type: 'rounds', amount: '1d4' }), ctx).state; // Number→NaN
    expect(hasAtkMod(startTurn(sF).state)).toBe(false);
  });

  it('дробный amount нормализуется через Math.floor', () => {
    const s = executeAction(fresh(), buff({ type: 'rounds', amount: 2.9 }), { character, rng: () => 0.5 } as unknown as Ctx).state;
    expect(hasAtkMod(startTurn(s).state)).toBe(true);                        // floor(2.9)=2 → 2→1
    expect(hasAtkMod(startTurn(startTurn(s).state).state)).toBe(false);      // 1→0
  });

  it('сопротивление с duration.rounds истекает (Ярость с таймером)', () => {
    const rage: Dict = { name: 'Ярость', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'resistance', damage_type: 'bludgeoning', value: 'resistance', duration: { type: 'rounds', amount: 1 } }] }] };
    const { state } = executeAction(fresh(), rage, { character, rng: () => 0.5 } as unknown as Ctx);
    expect(state.activeEffects.some((e) => (e.mechanics as Dict).kind === 'resistance')).toBe(true);
    expect(startTurn(state).state.activeEffects.some((e) => (e.mechanics as Dict).kind === 'resistance')).toBe(false);
  });
});
