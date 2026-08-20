import { describe, expect, it } from 'vitest';
import { FIGHTER_CTX, freshFighterState } from '../mvp/fixtures';
import type { EngineEvent, ResourceRestRecovery, RuntimeState } from '../mvp/contracts';
import {
  actionUsesKey,
  bindActionUsesCost,
  restoreSelfUsesCost,
  declaresSelfUsesCost,
  resolveActionUsesRecovery,
} from './actionUses';
import {
  resourceAmountRestoredOnLongRest,
  resourceAmountRestoredOnShortRest,
} from './resources';
import { longRest, shortRest } from './turn';

const USES_KEY = actionUsesKey('arbitrary-action');
const LEGACY_KEY = actionUsesKey('legacy-action');
const INVALID_KEY = actionUsesKey('invalid-action');
const RECOVERY: ResourceRestRecovery = {
  short_rest: { mode: 'fixed', amount: 1 },
  long_rest: { mode: 'full' },
};

function stateWithUses(key: string, current: number, maximum = 2): RuntimeState {
  const state = freshFighterState();
  state.resources = { ...state.resources, [key]: current };
  state.maxResources = { ...state.maxResources, [key]: maximum };
  return state;
}

function restored(events: EngineEvent[], key: string) {
  return events.filter((event): event is Extract<EngineEvent, { type: 'resource_restored' }> => (
    event.type === 'resource_restored' && event.resource === key
  ));
}

describe('generic mechanics.uses.recovery policy', () => {
  it('binds only an explicitly declared self_uses cost', () => {
    const declared = {
      activation: {
        mode: 'active',
        cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }],
      },
      uses: { count: 2, per: 'short_rest' },
    };
    expect(declaresSelfUsesCost(declared)).toBe(true);
    expect(bindActionUsesCost(declared, USES_KEY)).toMatchObject({
      activation: {
        cost: [{ resource: 'bonus_action' }, { resource: USES_KEY }],
      },
    });
    expect(restoreSelfUsesCost(bindActionUsesCost(declared, USES_KEY), USES_KEY)).toEqual(declared);
  });

  it('does not reinterpret another resource as this action uses pool', () => {
    const mechanics = {
      uses: { count: 2, per: 'short_rest' },
      activation: { mode: 'active', cost: [{ resource: 'other_pool' }] },
    };
    expect(restoreSelfUsesCost(mechanics, USES_KEY)).toBe(mechanics);
  });

  it('does not invent a self-use price from mechanics.uses', () => {
    const poolOnly = {
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      uses: { count: 2, per: 'short_rest' },
    };
    expect(declaresSelfUsesCost(poolOnly)).toBe(false);
    expect(bindActionUsesCost(poolOnly, USES_KEY)).toBe(poolOnly);
  });

  it('rejects self_uses without a declared pool', () => {
    expect(() => bindActionUsesCost({
      activation: { mode: 'active', cost: [{ resource: 'self_uses' }] },
    }, USES_KEY)).toThrow(/requires mechanics\.uses/);
  });

  it('decodes bounded recovery without action ids, card numbers, or display names', () => {
    expect(resolveActionUsesRecovery({
      uses: { count: 2, per: 'short_rest', recovery: RECOVERY },
    })).toEqual({ status: 'configured', recovery: RECOVERY });
    expect(resolveActionUsesRecovery({
      uses: { count: 'prof_bonus', per: 'short_rest' },
    })).toEqual({ status: 'legacy' });
  });

  it.each([
    null,
    {},
    { short_rest: { mode: 'fixed', amount: 1 } },
    { short_rest: { mode: 'full' }, long_rest: { mode: 'full' } },
    { short_rest: { mode: 'fixed', amount: 0 }, long_rest: { mode: 'full' } },
    { short_rest: { mode: 'fixed', amount: 1 }, long_rest: { mode: 'fixed', amount: 1 } },
    { short_rest: { mode: 'fixed', amount: 1 }, long_rest: { mode: 'full' }, hidden: true },
  ])('rejects malformed explicit recovery fail-closed: %j', (recovery) => {
    expect(resolveActionUsesRecovery({ uses: { count: 2, recovery } })).toEqual({
      status: 'invalid',
    });
  });

  it('restores exactly one missing use per Short Rest and stops at maximum', () => {
    const context = {
      ...FIGHTER_CTX,
      resourceRecharge: { [USES_KEY]: 'short_rest' },
      resourceRecovery: { [USES_KEY]: RECOVERY },
    };
    const first = shortRest(stateWithUses(USES_KEY, 0), context);
    const second = shortRest(first.state, context);
    const third = shortRest(second.state, context);

    expect(first.state.resources[USES_KEY]).toBe(1);
    expect(second.state.resources[USES_KEY]).toBe(2);
    expect(third.state.resources[USES_KEY]).toBe(2);
    expect(restored(first.events, USES_KEY)).toEqual([{
      type: 'resource_restored', resource: USES_KEY, amount: 1, current: 1,
    }]);
    expect(restored(second.events, USES_KEY)).toHaveLength(1);
    expect(restored(third.events, USES_KEY)).toHaveLength(0);
  });

  it('restores the full configured pool on a Long Rest', () => {
    const result = longRest(stateWithUses(USES_KEY, 0), {
      ...FIGHTER_CTX,
      resourceRecharge: { [USES_KEY]: 'short_rest' },
      resourceRecovery: { [USES_KEY]: RECOVERY },
    });
    expect(result.state.resources[USES_KEY]).toBe(2);
  });

  it('keeps legacy uses.per full-pool recovery compatible', () => {
    const result = shortRest(stateWithUses(LEGACY_KEY, 0), {
      ...FIGHTER_CTX,
      resourceRecharge: { [LEGACY_KEY]: 'short_rest' },
      resourceRecovery: {},
    });
    expect(result.state.resources[LEGACY_KEY]).toBe(2);
    expect(restored(result.events, LEGACY_KEY)).toEqual([{
      type: 'resource_restored', resource: LEGACY_KEY, amount: 2, current: 2,
    }]);
  });

  it('never falls back to full recovery for explicit invalid data', () => {
    const context = {
      ...FIGHTER_CTX,
      resourceRecharge: { [INVALID_KEY]: 'never' },
      resourceRecovery: { [INVALID_KEY]: null },
    };
    const short = shortRest(stateWithUses(INVALID_KEY, 0), context);
    const long = longRest(stateWithUses(INVALID_KEY, 0), context);
    expect(short.state.resources[INVALID_KEY]).toBe(0);
    expect(long.state.resources[INVALID_KEY]).toBe(0);
    expect(restored(short.events, INVALID_KEY)).toEqual([]);
  });

  it('fails closed for invalid counters and invalid policy values', () => {
    const recovery = { [USES_KEY]: RECOVERY };
    expect(resourceAmountRestoredOnShortRest(USES_KEY, -1, 2, recovery)).toBe(0);
    expect(resourceAmountRestoredOnShortRest(USES_KEY, 0.5, 2, recovery)).toBe(0);
    expect(resourceAmountRestoredOnShortRest(USES_KEY, 0, Number.NaN, recovery)).toBe(0);
    expect(resourceAmountRestoredOnShortRest(USES_KEY, 0, 2, { [USES_KEY]: null })).toBe(0);
    expect(resourceAmountRestoredOnLongRest(USES_KEY, 0, 2, { [USES_KEY]: null })).toBe(0);
  });
});
