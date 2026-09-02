import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import {
  ACTION_SURGE_ACTION_RESOURCE,
  QUICKENED_SPELL_ACTION_RESOURCE,
  projectActionSurgeCost,
  projectQuickenedSpellCost,
} from './actionSurge';
import { startTurn } from './turn';

const state = (surge: number): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 },
  resources: { action: 1, [ACTION_SURGE_ACTION_RESOURCE]: surge },
  maxResources: { action: 1, [ACTION_SURGE_ACTION_RESOURCE]: 1 },
  equipment: {},
  inventory: [],
  activeEffects: [],
});
const action = { activation: { mode: 'active', cost: [{ resource: 'action' }] }, effects: [] };

describe('Action Surge restricted action economy', () => {
  it('spends the restricted pool first for a non-spell action', () => {
    const projected = projectActionSurgeCost(action, state(1), 'nonspell');
    expect(projected.activation).toEqual({
      mode: 'active', cost: [{ resource: ACTION_SURGE_ACTION_RESOURCE }],
    });
  });

  it('never makes the restricted pool available to a spell', () => {
    expect(projectActionSurgeCost(action, state(1), 'spell')).toBe(action);
  });

  it('expires an unused restricted action at the next turn boundary', () => {
    expect(startTurn(state(1)).state.resources[ACTION_SURGE_ACTION_RESOURCE]).toBe(0);
  });

  it('reserves a Quickened token for a spell and replaces only its Action cost', () => {
    const ready = state(0);
    ready.resources[QUICKENED_SPELL_ACTION_RESOURCE] = 1;
    ready.maxResources[QUICKENED_SPELL_ACTION_RESOURCE] = 1;
    expect(projectQuickenedSpellCost(action, ready, 'spell').activation).toEqual({
      mode: 'active', cost: [{ resource: QUICKENED_SPELL_ACTION_RESOURCE }],
    });
    expect(projectQuickenedSpellCost(action, ready, 'nonspell')).toBe(action);
  });

  it('expires an unused Quickened token at the next turn boundary', () => {
    const ready = state(0);
    ready.resources[QUICKENED_SPELL_ACTION_RESOURCE] = 1;
    ready.maxResources[QUICKENED_SPELL_ACTION_RESOURCE] = 1;
    expect(startTurn(ready).state.resources[QUICKENED_SPELL_ACTION_RESOURCE]).toBe(0);
  });
});
