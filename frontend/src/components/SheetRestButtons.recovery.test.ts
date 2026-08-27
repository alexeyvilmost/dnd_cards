import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from '../character/assemble';
import { actionUsesKey } from '../engine/actionUses';
import {
  clearCombatContinuationsForRest,
  collectSheetActionUseRestPolicies,
} from './SheetRestButtons';

function assembledWithAction(mechanics: Record<string, unknown>): AssembledCharacter {
  return {
    actions: [{
      action: {
        id: 'arbitrary-action-id',
        card_number: 'ACT-arbitrary',
        name: 'Arbitrary action',
        mechanics,
      },
      origin: { kind: 'class', id: 'class-id', name: 'Class' },
    }],
    effects: [],
  } as unknown as AssembledCharacter;
}

describe('real sheet action-use rest adapter', () => {
  const key = actionUsesKey('ACT-arbitrary');

  it('starts a rest from a combat-continuation-free turn state', () => {
    expect(clearCombatContinuationsForRest({
      canonical_pending_combat_v1: { pending: true },
      solo_combat_v1: { outcome: 'victory' },
      unrelated: { keep: true },
    })).toEqual({ unrelated: { keep: true } });
  });

  it('projects a bounded recovery policy directly from action mechanics', () => {
    const policies = collectSheetActionUseRestPolicies(assembledWithAction({
      activation: { mode: 'active' },
      uses: {
        count: 2,
        per: 'short_rest',
        recovery: {
          short_rest: { mode: 'fixed', amount: 1 },
          long_rest: { mode: 'full' },
        },
      },
    }));

    expect(policies).toEqual({
      recharge: { [key]: 'short_rest' },
      recovery: {
        [key]: {
          short_rest: { mode: 'fixed', amount: 1 },
          long_rest: { mode: 'full' },
        },
      },
    });
  });

  it('keeps legacy uses.per and marks malformed explicit recovery as never/null', () => {
    expect(collectSheetActionUseRestPolicies(assembledWithAction({
      activation: { mode: 'active' },
      uses: { count: 2, per: 'short_rest' },
    }))).toEqual({ recharge: { [key]: 'short_rest' }, recovery: {} });

    expect(collectSheetActionUseRestPolicies(assembledWithAction({
      activation: { mode: 'active' },
      uses: {
        count: 2,
        per: 'short_rest',
        recovery: {
          short_rest: { mode: 'fixed', amount: 0 },
          long_rest: { mode: 'full' },
        },
      },
    }))).toEqual({ recharge: { [key]: 'never' }, recovery: { [key]: null } });
  });
});
