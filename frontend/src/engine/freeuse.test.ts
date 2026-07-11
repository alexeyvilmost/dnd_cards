import { describe, expect, it } from 'vitest';
import {
  parseFreeuse, freeuseKey, isFreeusePoolKey, FREEUSE_SHOWCASE_KEY,
  findFreeusePoolKey, applyFreeuseCost, collectFreeuseRecharge, type FreeuseSpec,
} from './freeuse';
import { canPay, pay } from './cost';
import { longRest, shortRest } from './turn';
import { freshFighterState, FIGHTER_CTX } from '../mvp/fixtures';

type Dict = Record<string, unknown>;

describe('freeuse — нормализация параметра', () => {
  it('true → 1 раз, долгий отдых', () => {
    expect(parseFreeuse(true)).toEqual({ count: 1, recharge: 'long_rest' });
  });
  it('число → столько раз, долгий отдых', () => {
    expect(parseFreeuse(3)).toEqual({ count: 3, recharge: 'long_rest' });
  });
  it('объект → count/recharge/level', () => {
    expect(parseFreeuse({ count: 2, recharge: 'short_rest', level: 2 }))
      .toEqual({ count: 2, recharge: 'short_rest', level: 2 });
  });
  it('дефолты объекта: count=1, recharge=long_rest', () => {
    expect(parseFreeuse({})).toEqual({ count: 1, recharge: 'long_rest' });
  });
  it('false/null → undefined (нет freeuse)', () => {
    expect(parseFreeuse(false)).toBeUndefined();
    expect(parseFreeuse(null)).toBeUndefined();
    expect(parseFreeuse(undefined)).toBeUndefined();
  });
});

describe('freeuse — ключи пула', () => {
  it('freeuseKey → freeuse-<spell>', () => {
    expect(freeuseKey('misty_step')).toBe('freeuse-misty_step');
  });
  it('isFreeusePoolKey: пул да, витрина нет, uses_ нет', () => {
    expect(isFreeusePoolKey('freeuse-misty_step')).toBe(true);
    expect(isFreeusePoolKey(FREEUSE_SHOWCASE_KEY)).toBe(false); // freeuse-spells — витрина
    expect(isFreeusePoolKey('uses_ACT-rage')).toBe(false);
    expect(isFreeusePoolKey('spell_slot_2')).toBe(false);
  });
  it('findFreeusePoolKey ищет по slug ИЛИ uuid (контент ссылается по-разному)', () => {
    const res = { 'freeuse-misty_step': 1 };
    expect(findFreeusePoolKey(res, { cardNumber: 'misty_step', id: 'uuid-1' })).toBe('freeuse-misty_step');
    const byId = { 'freeuse-uuid-1': 1 };
    expect(findFreeusePoolKey(byId, { cardNumber: 'misty_step', id: 'uuid-1' })).toBe('freeuse-uuid-1');
    expect(findFreeusePoolKey({}, { cardNumber: 'misty_step', id: 'uuid-1' })).toBeNull();
  });
});

describe('freeuse — подмена стоимости', () => {
  it('applyFreeuseCost убирает spell_slot, добавляет freeuse-пул, СОХРАНЯЕТ действие', () => {
    const mech: Dict = { activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'spell_slot', level: 2 }] } };
    const out = applyFreeuseCost(mech, 'freeuse-misty_step');
    const cost = ((out.activation as Dict).cost as Dict[]);
    expect(cost.some((c) => c.resource === 'spell_slot')).toBe(false);
    expect(cost.some((c) => c.resource === 'bonus_action')).toBe(true); // действие остаётся
    expect(cost.find((c) => c.resource === 'freeuse-misty_step')).toEqual({ resource: 'freeuse-misty_step', amount: 1 });
  });
});

describe('freeuse — оплата пулом (generic canPay/pay)', () => {
  it('трата пула decrement-ит; при нуле не платит', () => {
    const state = { ...freshFighterState(), resources: { 'freeuse-misty_step': 1 } } as ReturnType<typeof freshFighterState>;
    const cost = [{ resource: 'freeuse-misty_step', amount: 1 }];
    expect(canPay(state, cost).ok).toBe(true);
    const { state: after } = pay(state, cost);
    expect(after.resources['freeuse-misty_step']).toBe(0);
    expect(canPay(after, cost).ok).toBe(false); // пул исчерпан
  });
});

describe('freeuse — перезарядка', () => {
  const specs: FreeuseSpec[] = [{ spell: 'misty_step', count: 2, recharge: 'long_rest' }];

  it('collectFreeuseRecharge → freeuse-<spell> → per', () => {
    expect(collectFreeuseRecharge(specs)).toEqual({ 'freeuse-misty_step': 'long_rest' });
  });

  it('долгий отдых восстанавливает пул до max (даже без recharge-карты)', () => {
    const base = freshFighterState();
    const state = {
      ...base,
      resources: { ...base.resources, 'freeuse-misty_step': 0 },
      maxResources: { ...base.maxResources, 'freeuse-misty_step': 2 },
    };
    const { state: next } = longRest(state, FIGHTER_CTX);
    expect(next.resources['freeuse-misty_step']).toBe(2);
  });

  it('короткий отдых восстанавливает freeuse ТОЛЬКО при recharge:short_rest в карте', () => {
    const base = freshFighterState();
    const mk = () => ({
      ...base,
      resources: { ...base.resources, 'freeuse-misty_step': 0 },
      maxResources: { ...base.maxResources, 'freeuse-misty_step': 2 },
    });
    // long_rest-пул на коротком отдыхе НЕ восстанавливается
    const long = shortRest(mk(), { ...FIGHTER_CTX, resourceRecharge: { 'freeuse-misty_step': 'long_rest' } });
    expect(long.state.resources['freeuse-misty_step']).toBe(0);
    // short_rest-пул восстанавливается
    const short = shortRest(mk(), { ...FIGHTER_CTX, resourceRecharge: { 'freeuse-misty_step': 'short_rest' } });
    expect(short.state.resources['freeuse-misty_step']).toBe(2);
  });
});
