import { describe, expect, it } from 'vitest';
import { freshFighterState, FIGHTER_CTX } from '../mvp/fixtures';
import { resourcesRestoredOnShortRest } from './resources';
import { shortRest } from './turn';

describe('resource recharge (R4)', () => {
  it('second_wind на short_rest, rage_charge только на long_rest', () => {
    const recharge = { second_wind: 'short_rest', rage_charge: 'long_rest' };
    expect(resourcesRestoredOnShortRest({ second_wind: 2, rage_charge: 2 }, recharge))
      .toEqual(['second_wind']);

    const state = freshFighterState();
    state.resources = { ...state.resources, second_wind: 0, rage_charge: 0 };
    state.maxResources = { ...state.maxResources, rage_charge: 2 };
    const { state: next } = shortRest(state, { ...FIGHTER_CTX, resourceRecharge: recharge });
    expect(next.resources.second_wind).toBe(2);
    expect(next.resources.rage_charge).toBe(0);
  });
});
