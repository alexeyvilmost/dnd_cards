import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from '../character/assemble';
import type { GrantedAction } from '../character/actionSheet';
import type { Action } from '../types';
import { longRest, startTurn } from '../engine/turn';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
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

  it('includes the rest policy of a library action granted by a feature', () => {
    const granted: GrantedAction[] = [{
      action: {
        id: 'granted-id',
        card_number: 'ACT-granted-rest',
        name: 'Granted rest action',
        mechanics: {
          activation: { mode: 'active', cost: [{ resource: 'self_uses' }] },
          uses: { count: 1, per: 'long_rest' },
          effects: [],
        },
      } as unknown as Action,
      sourceLabel: 'Feature',
      group: 'class',
    }];

    const policies = collectSheetActionUseRestPolicies(
      { actions: [], effects: [] } as unknown as AssembledCharacter,
      [],
      granted,
    );
    expect(policies).toEqual({
      recharge: { 'uses_ACT-granted-rest': 'long_rest' },
      recovery: {},
    });

    const rested = longRest({
      hp: { current: 7, max: 10, temp: 0 },
      resources: { 'uses_ACT-granted-rest': 0 },
      maxResources: { 'uses_ACT-granted-rest': 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    } as RuntimeState, {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 5,
      resourceRecharge: policies.recharge,
      resourceRecovery: policies.recovery,
    } as CharacterContext);
    expect(rested.state.resources['uses_ACT-granted-rest']).toBe(1);
  });

  it('restores a granted per-turn action pool at the turn boundary', () => {
    const key = 'uses_ACT-monk-stunning-strike';
    const started = startTurn({
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 0, [key]: 0 },
      maxResources: { action: 1, [key]: 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    } as RuntimeState, {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 3,
      level: 5,
      resourceRecharge: { [key]: 'turn' },
    });

    expect(started.state.resources).toMatchObject({ action: 1, [key]: 1 });
  });
});
