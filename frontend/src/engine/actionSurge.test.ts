import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { ACTION_SURGE_ACTION_RESOURCE, projectActionSurgeCost } from './actionSurge';
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
});
