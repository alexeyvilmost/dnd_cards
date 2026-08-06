/**
 * S4 «предмет=эффект»: стоимость-предмет ({resource:'item', card_id}) тратит предмет из инвентаря
 * (canPay/pay полиморфны). Relative self_item is explicit in activation.cost
 * and the entity adapter binds it to the owning card id.
 */
import { describe, expect, it } from 'vitest';
import { bindSelfItemCost, canPay, pay, costAmount } from './cost';
import { executeAction } from './execute';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

function state(inv: { cardId: string; qty: number }[], resources: Record<string, number> = {}): RuntimeState {
  return { hp: { current: 10, max: 10, temp: 0 }, resources, maxResources: {}, equipment: {}, inventory: inv, activeEffects: [] } as unknown as RuntimeState;
}

describe('S4 — стоимость-предмет (canPay/pay)', () => {
  it('canPay: предмет есть в инвентаре → ok', () => {
    expect(canPay(state([{ cardId: 'potion', qty: 2 }]), [{ resource: 'item', card_id: 'potion' }]).ok).toBe(true);
  });

  it('canPay: предмета нет → missing item:<id>', () => {
    const r = canPay(state([]), [{ resource: 'item', card_id: 'potion' }]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('item:potion');
  });

  it('pay: тратит предмет + событие item_consumed с остатком', () => {
    const { state: next, events } = pay(state([{ cardId: 'potion', qty: 2 }]), [{ resource: 'item', card_id: 'potion' }]);
    expect(next.inventory.find((r) => r.cardId === 'potion')?.qty).toBe(1);
    expect(events.some((e) => e.type === 'item_consumed' && e.remaining === 1)).toBe(true);
  });

  it('pay: последний предмет исчезает из инвентаря (qty 0 → нет строки)', () => {
    const { state: next } = pay(state([{ cardId: 'arrow', qty: 1 }]), [{ resource: 'item', card_id: 'arrow' }]);
    expect(next.inventory.find((r) => r.cardId === 'arrow')).toBeUndefined();
  });

  it('смешанная стоимость: ресурс + предмет тратятся оба', () => {
    const { state: next } = pay(state([{ cardId: 'arrow', qty: 5 }], { action: 1 }), [{ resource: 'action' }, { resource: 'item', card_id: 'arrow' }]);
    expect(next.resources.action).toBe(0);
    expect(next.inventory.find((r) => r.cardId === 'arrow')?.qty).toBe(4);
  });

  it('pay при нехватке предмета — no-op (state неизменен, нет событий)', () => {
    const s = state([]);
    const { state: next, events } = pay(s, [{ resource: 'item', card_id: 'x' }]);
    expect(next).toBe(s);
    expect(events).toEqual([]);
  });
});

describe('стоимость костью хитов', () => {
  it('разрешает абстрактный hit_die через фактический пул класса', () => {
    const current = state([], { hit_dice_d10: 2 });
    const result = pay(current, [{ resource: 'hit_die' }]);

    expect(canPay(current, [{ resource: 'hit_die' }]).ok).toBe(true);
    expect(result.state.resources.hit_dice_d10).toBe(1);
    expect(result.events).toContainEqual({
      type: 'resource_spent', resource: 'hit_dice_d10', amount: 1, remaining: 1,
    });
  });
});

describe('S4 — bindSelfItemCost (явный саморасход зелья)', () => {
  it('связывает явно объявленный self_item с card id', () => {
    const out = bindSelfItemCost({ activation: { mode: 'active', cost: [{ resource: 'self_item' }] }, effects: [] }, 'potion');
    expect((out.activation as { cost: unknown }).cost).toEqual([{ resource: 'item', card_id: 'potion', amount: 1 }]);
  });

  it('не создаёт цену из legacy consumes_self', () => {
    const mech = { activation: { mode: 'active', consumes_self: true }, effects: [] };
    expect(bindSelfItemCost(mech, 'potion')).toBe(mech);
  });

  it('без self_item — механика без изменений (та же ссылка)', () => {
    const mech = { activation: { mode: 'active' }, effects: [] };
    expect(bindSelfItemCost(mech, 'potion')).toBe(mech);
  });

  it('сохраняет существующую стоимость действия (бонусное действие + расход)', () => {
    const mech = { activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'self_item' }] }, effects: [] };
    expect((bindSelfItemCost(mech, 'potion').activation as { cost: unknown }).cost)
      .toEqual([{ resource: 'bonus_action' }, { resource: 'item', card_id: 'potion', amount: 1 }]);
  });

  it('отклоняет card_id у относительного self_item', () => {
    expect(() => bindSelfItemCost({
      activation: { mode: 'active', cost: [{ resource: 'self_item', card_id: 'other' }] },
    }, 'potion')).toThrow(/must not declare card_id/);
  });
});

describe('S4 — устойчивость стоимости (правки ревью)', () => {
  it('агрегация: две записи на один card_id — canPay суммирует потребность (не смотрит каждую отдельно)', () => {
    const s = state([{ cardId: 'arrow', qty: 3 }]);
    expect(canPay(s, [{ resource: 'item', card_id: 'arrow', amount: 2 }, { resource: 'item', card_id: 'arrow', amount: 2 }]).ok).toBe(false); // 4 > 3
    expect(canPay(s, [{ resource: 'item', card_id: 'arrow', amount: 2 }, { resource: 'item', card_id: 'arrow', amount: 1 }]).ok).toBe(true); // 3 ≤ 3
  });

  it('отрицательная стоимость-предмет НЕ наращивает инвентарь (clamp ≥0)', () => {
    const { state: next } = pay(state([{ cardId: 'potion', qty: 2 }]), [{ resource: 'item', card_id: 'potion', amount: -3 }]);
    expect(next.inventory.find((r) => r.cardId === 'potion')?.qty).toBe(2);
  });

  it('costAmount: неотрицательное целое; null→1, 0/"0"/отриц.→0 (единый источник для гейта и причины)', () => {
    expect(costAmount({})).toBe(1);
    expect(costAmount({ amount: 0 })).toBe(0);
    expect(costAmount({ amount: '0' })).toBe(0);
    expect(costAmount({ amount: -3 })).toBe(0);
    expect(costAmount({ amount: 2 })).toBe(2);
  });

  it('событие item_consumed несёт имя предмета (из bindSelfItemCost)', () => {
    const mech = bindSelfItemCost({ name: 'Зелье', activation: { mode: 'active', cost: [{ resource: 'self_item' }] }, effects: [] }, 'potion');
    const cost = (mech.activation as { cost: Record<string, unknown>[] }).cost;
    const { events } = pay(state([{ cardId: 'potion', qty: 1 }]), cost);
    const ev = events.find((e) => e.type === 'item_consumed');
    expect(ev && 'name' in ev && ev.name).toBe('Зелье');
  });
});

describe('S4 — интеграция: зелье лечения (видение №4)', () => {
  const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
  const ctx = { character, rng: () => 0.5 } as unknown as ExecuteContext;

  it('зелье лечит и расходуется из инвентаря (атомарно, + событие)', () => {
    const potion = bindSelfItemCost({
      name: 'Зелье лечения', activation: { mode: 'active', cost: [{ resource: 'self_item' }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '2d4+4' }] }],
    }, 'potion') as Record<string, unknown>;
    const s: RuntimeState = { hp: { current: 5, max: 30, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [{ cardId: 'potion', qty: 2 }], activeEffects: [] } as unknown as RuntimeState;
    const res = executeAction(s, potion, ctx);
    expect(res.state.hp.current).toBeGreaterThan(5); // полечило
    expect(res.state.inventory.find((r) => r.cardId === 'potion')?.qty).toBe(1); // израсходовано 1
    expect(res.events.some((e) => e.type === 'item_consumed')).toBe(true);
  });

  it('зелья нет в инвентаре → действие невозможно (canPay гейтит)', () => {
    const potion = bindSelfItemCost({
      name: 'Зелье лечения', activation: { mode: 'active', cost: [{ resource: 'self_item' }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '2d4+4' }] }],
    }, 'potion') as Record<string, unknown>;
    const s: RuntimeState = { hp: { current: 5, max: 30, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] } as unknown as RuntimeState;
    expect(() => executeAction(s, potion, ctx)).toThrow();
  });
});
