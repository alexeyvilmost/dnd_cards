import { describe, expect, it } from 'vitest';
import { initResources } from './resources';
import { canPay, pay } from './cost';
import { shortRest, longRest } from './turn';
import { executeAction, applyIncomingDamage } from './execute';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

// Голиаф уровня 5 → бонус мастерства 3.
const ctx: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 2, int: 0, wis: 0, cha: 0 }, profBonus: 3, level: 5 };
const GRANT = { kind: 'resource', op: 'grant', id: 'giant_legacy', amount: 'prof_bonus' };

function stateWith(resources: Record<string, number>, maxResources: Record<string, number>): RuntimeState {
  return { hp: { current: 20, max: 20, temp: 0 }, resources: { ...resources }, maxResources: { ...maxResources }, equipment: {}, inventory: [], activeEffects: [] };
}

describe('Наследие великанов — ресурс giant_legacy (prof_bonus / долгий отдых)', () => {
  it('инициализируется в бонус мастерства', () => {
    const { resources, maxResources } = initResources(ctx, null, [GRANT]);
    expect(maxResources.giant_legacy).toBe(3);
    expect(resources.giant_legacy).toBe(3);
  });

  it('действие тратит один заряд (canPay/pay generic-ресурса)', () => {
    const { resources, maxResources } = initResources(ctx, null, [GRANT]);
    const st = stateWith(resources, maxResources);
    const cost = [{ resource: 'giant_legacy' }];
    expect(canPay(st, cost).ok).toBe(true);
    expect(pay(st, cost).state.resources.giant_legacy).toBe(2);
  });

  it('нельзя использовать при 0 зарядах', () => {
    const st = stateWith({ giant_legacy: 0 }, { giant_legacy: 3 });
    expect(canPay(st, [{ resource: 'giant_legacy' }]).ok).toBe(false);
  });

  it('короткий отдых НЕ восстанавливает giant_legacy', () => {
    const st = stateWith({ giant_legacy: 1, action: 1, bonus_action: 1, reaction: 1 }, { giant_legacy: 3, action: 1, bonus_action: 1, reaction: 1 });
    // recharge-карта (как строит лист) без giant_legacy → не short_rest.
    const res = shortRest(st, { ...ctx, resourceRecharge: {} } as CharacterContext);
    expect(res.state.resources.giant_legacy).toBe(1);
  });

  it('длинный отдых восстанавливает giant_legacy до максимума', () => {
    const st = stateWith({ giant_legacy: 0 }, { giant_legacy: 3 });
    expect(longRest(st, ctx).state.resources.giant_legacy).toBe(3);
  });
});

const STONE = {
  activation: { mode: 'reaction', trigger: { event: 'damage_taken' }, cost: [] },
  effects: [{ resolution: 'auto', result: [{ kind: 'reduce_damage', amount: '1d12+con' }] }],
};
function hurt(current: number): RuntimeState {
  const s = stateWith({}, {});
  s.hp = { current, max: 20, temp: 0 };
  return s;
}
const ectx = (rng = () => 0.5) => ({ character: ctx, rng, passives: [] } as ExecuteContext);
const redEvent = (events: EngineEvent[]) => events.find((e): e is Extract<EngineEvent, { type: 'damage_reduction' }> => e.type === 'damage_reduction');

describe('Каменная стойкость — снижение урона (не лечение, до списания хитов)', () => {
  it('payload reduce_damage эмитит damage_reduction и НЕ трогает хиты', () => {
    const r = executeAction(hurt(10), STONE, ectx(() => 0.999)); // 1к12=12
    expect(r.state.hp.current).toBe(10); // хиты не изменились — это НЕ исцеление
    expect(redEvent(r.events)?.amount).toBe(14); // 12 + 2 ТЕЛ
  });

  it('applyIncomingDamage вычитает снижение ДО хитов — HP не проседает', () => {
    const res = applyIncomingDamage(hurt(8), 10, ectx(), { damageReduction: 10 });
    expect(res.state.hp.current).toBe(8); // 10 урона − 10 = 0, хиты нетронуты
  });

  it('частичное снижение работает; сверх-снижение не уводит урон в минус', () => {
    expect(applyIncomingDamage(hurt(8), 5, ectx(), { damageReduction: 3 }).state.hp.current).toBe(6); // 5−3=2
    expect(applyIncomingDamage(hurt(8), 5, ectx(), { damageReduction: 100 }).state.hp.current).toBe(8); // урон 0
  });

  it('снижение предотвращает падение до 0 (без него — упал бы)', () => {
    expect(applyIncomingDamage(hurt(5), 5, ectx(), { damageReduction: 5 }).state.hp.current).toBe(5);
    expect(applyIncomingDamage(hurt(5), 5, ectx(), {}).state.hp.current).toBe(0);
  });
});
