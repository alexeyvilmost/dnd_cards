/**
 * 2.4: case set_value в роутере payload-ов (раньше падал в NOT_IMPLEMENTED). Флагман — Неумолимая
 * стойкость: триггер reduced_to_0_hp → set_value hp=1. Плюс target temp_hp/max_hp/ресурс, who:'target',
 * формула. variable — намеренная заглушка-нарратив (нет рантайм-переменных).
 */
import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage } from './execute';
import { computeAC } from './ac';
import { longRest } from './turn';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };
const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
const ctx = { character, rng: () => 0.5 } as unknown as Ctx;
const fresh = (hp: { current: number; max: number; temp: number } = { current: 20, max: 20, temp: 0 }): RuntimeState =>
  ({ hp, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });
const setAct = (target: string, value: string): Dict =>
  ({ name: 'Set', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'set_value', target, value }] }] });

describe('2.4 — set_value', () => {
  it('ФЛАГМАН Неумолимая стойкость (uses long_rest): спасает РАЗ за отдых, не бесконечно', () => {
    const relentless: Dict = {
      id: 'relentless', name: 'Неумолимая стойкость', uses: { per: 'long_rest' },
      activation: { mode: 'triggered', trigger: { event: 'reduced_to_0_hp' } },
      effects: [{ resolution: 'auto', result: [{ kind: 'set_value', target: 'hp', value: '1' }] }],
    };
    const c = { character, rng: () => 0.5, passives: [relentless] } as unknown as Ctx;
    const r1 = applyIncomingDamage(fresh({ current: 5, max: 20, temp: 0 }), 10, c, { damageType: 'slashing' });
    expect(r1.state.hp.current).toBe(1);                    // сведён к 0 → триггер → 1
    const r2 = applyIncomingDamage(r1.state, 10, c, { damageType: 'slashing' });
    expect(r2.state.hp.current).toBe(0);                    // второй раз — гейт firedThisRest, НЕ спасён
    const rested = longRest(r2.state, character).state;     // отдых сбрасывает гейт
    const r3 = applyIncomingDamage({ ...rested, hp: { current: 5, max: 20, temp: 0 } }, 10, c, { damageType: 'slashing' });
    expect(r3.state.hp.current).toBe(1);                    // снова спасает
  });

  it('set_value hp клампится в [0, max]', () => {
    expect(executeAction(fresh({ current: 10, max: 20, temp: 0 }), setAct('hp', '1'), ctx).state.hp.current).toBe(1);
    expect(executeAction(fresh({ current: 10, max: 20, temp: 0 }), setAct('hp', '99'), ctx).state.hp.current).toBe(20);
    expect(executeAction(fresh({ current: 10, max: 20, temp: 0 }), setAct('hp', '-5'), ctx).state.hp.current).toBe(0);
  });

  it('set_value temp_hp / max_hp (max клампит текущие)', () => {
    expect(executeAction(fresh(), setAct('temp_hp', '7'), ctx).state.hp.temp).toBe(7);
    const s = executeAction(fresh({ current: 20, max: 20, temp: 0 }), setAct('max_hp', '12'), ctx).state;
    expect(s.hp.max).toBe(12);
    expect(s.hp.current).toBe(12);
  });

  it('set_value с ИЗВЕСТНЫМ ресурсом (target = id ресурса)', () => {
    const st: RuntimeState = { ...fresh(), resources: { rage: 3 }, maxResources: { rage: 3 } };
    expect(executeAction(st, setAct('rage', '0'), ctx).state.resources.rage).toBe(0);
  });

  it('НЕИЗВЕСТНЫЙ target (опечатка/характеристика) → нарратив, фантомный ресурс НЕ создаётся', () => {
    const { state, events } = executeAction(fresh(), setAct('hpp', '1'), ctx);
    expect(state.resources.hpp).toBeUndefined();                                  // не создали фантом
    expect(state.hp.current).toBe(20);                                            // hp не тронут
    expect(events.some((e) => JSON.stringify(e).includes('неизвестный target'))).toBe(true);
  });

  it('who:target с ФОРМУЛОЙ берёт статы ЦЕЛИ, не атакующего', () => {
    const act: Dict = { name: 'X', activation: { cost: [] }, effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'set_value', target: 'current_hp', value: 'prof' }] }] };
    const targetCC: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 6, level: 8 };
    const res = executeAction(fresh(), act, { character, rng: () => 0.5, target: { characterContext: targetCC, runtimeState: fresh({ current: 20, max: 20, temp: 0 }) } } as unknown as Ctx);
    expect(res.targetState?.hp.current).toBe(6); // БМ ЦЕЛИ (6), не атакующего (2)
  });

  it('set_value поддерживает формулу', () => {
    expect(executeAction(fresh({ current: 1, max: 20, temp: 0 }), setAct('hp', '2+3'), ctx).state.hp.current).toBe(5);
  });

  it('set_value who:target устанавливает поле ЦЕЛИ', () => {
    const act: Dict = { name: 'Drain', activation: { cost: [] }, effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'set_value', target: 'hp', value: '1' }] }] };
    const res = executeAction(fresh(), act, { character, rng: () => 0.5, target: { runtimeState: fresh({ current: 10, max: 20, temp: 0 }) } } as unknown as Ctx);
    expect(res.targetState?.hp.current).toBe(1);
  });

  it('#8 Доспех мага: set_value ac_base ставит стоячий метод КЗ (не NOT_IMPLEMENTED), computeAC берёт 13+ЛВК', () => {
    const cc: CharacterContext = { abilityMods: { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 3 };
    const c = { character: cc, rng: () => 0.5 } as unknown as Ctx;
    const mageArmor: Dict = { name: 'Доспех мага', activation: { cost: [] }, effects: [{ resolution: 'auto', who: 'self', result: [{ kind: 'set_value', target: 'ac_base', formula: '13+dex' }] }] };
    const { state, events } = executeAction(fresh(), mageArmor, c);
    expect(events.some((e) => JSON.stringify(e).includes('NOT_IMPLEMENTED'))).toBe(false);
    const eff = state.activeEffects.find((e) => (e.mechanics as Dict)?.target === 'ac_base');
    expect(eff).toBeTruthy();                       // установлен стоячий активный эффект
    expect(computeAC(cc, state, []).value).toBe(16); // 13+ЛВК(3) без доспеха, перебивает базу 10+3
  });

  it('#8 (реальный кейс) Доспехи мага через grant_effect: каст ставит выданный эффект → КЗ 13+ЛВК', () => {
    const cc: CharacterContext = { abilityMods: { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 3 };
    // Заклинание выдаёт ОТДЕЛЬНЫЙ эффект (как EFFECT-0256) — механику лист кладёт в grantedEffects.
    const spell: Dict = { name: 'Доспехи мага', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', values: ['EFFECT-0256'] }] }] };
    const granted = {
      'EFFECT-0256': {
        name: 'Доспехи мага',
        mechanics: { activation: { mode: 'passive' }, duration: { type: 'until_long_rest' }, effects: [{ resolution: 'auto', result: [{ kind: 'set_value', target: 'ac_base', formula: '13 + dex' }] }] },
      },
    };
    const c = { character: cc, rng: () => 0.5, grantedEffects: granted } as unknown as Ctx;
    const { state, events } = executeAction(fresh(), spell, c);
    expect(events.some((e) => JSON.stringify(e).includes('NOT_IMPLEMENTED'))).toBe(false);
    expect(state.activeEffects.length).toBe(1);              // выданный эффект установлен
    expect(computeAC(cc, state, []).value).toBe(16);         // 13 + ЛВК(3)
  });

  it('повторяемый grant_effect (условие) НАКАПЛИВАЕТСЯ: два каста → два экземпляра', () => {
    const poison: Dict = { name: 'Отравление', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: 'EFF-poison' }] }] };
    const granted = {
      'EFF-poison': { name: 'Отравление', repeatable: true, mechanics: { effects: [{ resolution: 'auto', result: [{ kind: 'condition', op: 'apply', value: 'poisoned' }] }] } },
    };
    const c = { character, rng: () => 0.5, grantedEffects: granted } as unknown as Ctx;
    const after1 = executeAction(fresh(), poison, c).state;
    const after2 = executeAction(after1, poison, c).state;
    expect(after2.activeEffects.length).toBe(2); // складывается (stack_type='stack'), не перезаписывается
  });

  it('НЕповторяемый grant_effect (условие) НЕ накапливается: два каста → один экземпляр', () => {
    const curse: Dict = { name: 'Проклятие', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: 'EFF-curse' }] }] };
    const granted = {
      'EFF-curse': { name: 'Проклятие', mechanics: { effects: [{ resolution: 'auto', result: [{ kind: 'condition', op: 'apply', value: 'cursed' }] }] } },
    };
    const c = { character, rng: () => 0.5, grantedEffects: granted } as unknown as Ctx;
    const after1 = executeAction(fresh(), curse, c).state;
    const after2 = executeAction(after1, curse, c).state;
    expect(after2.activeEffects.length).toBe(1); // условие с ключом cond:cursed перезаписывается
  });

  it('grant_effect без предзагрузки (slug не в ctx) — тихо, без NOT_IMPLEMENTED и без эффекта', () => {
    const spell: Dict = { name: 'X', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: 'EFFECT-XXX' }] }] };
    const { state, events } = executeAction(fresh(), spell, ctx);
    expect(events.some((e) => JSON.stringify(e).includes('NOT_IMPLEMENTED'))).toBe(false);
    expect(state.activeEffects.length).toBe(0);
  });

  it('variable → нарратив-заглушка, а не NOT_IMPLEMENTED', () => {
    const { events } = executeAction(fresh(), { name: 'V', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'variable', id: 'x', op: 'set', value: '1' }] }] }, ctx);
    expect(events.some((e) => JSON.stringify(e).includes('NOT_IMPLEMENTED'))).toBe(false);
    expect(events.some((e) => JSON.stringify(e).includes('рантайм-мутация переменных'))).toBe(true);
  });
});
