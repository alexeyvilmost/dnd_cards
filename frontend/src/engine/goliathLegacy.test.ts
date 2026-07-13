import { describe, expect, it } from 'vitest';
import { initResources } from './resources';
import { canPay, pay } from './cost';
import { shortRest, longRest } from './turn';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

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
