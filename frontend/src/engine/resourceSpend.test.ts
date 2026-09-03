import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction, InsufficientResourcesError } from './execute';

const character: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 5,
};

function runtime(resources: Record<string, number>): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: { ...resources },
    maxResources: { ...resources },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

const sourceSpend = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'resource', op: 'spend', id: 'channel_divinity', amount: 1 }],
  }],
};

describe('result-level resource spend', () => {
  it('spends the source pool and emits the same transparent event as activation costs', () => {
    const result = executeAction(runtime({ action: 1, channel_divinity: 2 }), sourceSpend, {
      character, rng: () => 0.5,
    });

    expect(result.state.resources).toMatchObject({ action: 0, channel_divinity: 1 });
    expect(result.events.filter((event) => event.type === 'resource_spent')).toEqual([
      { type: 'resource_spent', resource: 'action', amount: 1, remaining: 0 },
      { type: 'resource_spent', resource: 'channel_divinity', amount: 1, remaining: 1 },
    ]);
  });

  it('routes a target-owned spend to the target without mutating the source pool', () => {
    const target = runtime({ focus: 3 });
    const targetCharacter: CharacterContext = {
      ...character,
      abilityMods: { ...character.abilityMods, wis: 2 },
    };
    const context: ExecuteContext = {
      character,
      rng: () => 0.5,
      target: { id: 'target', characterContext: targetCharacter, runtimeState: target },
    };
    const mechanics = {
      activation: { mode: 'active', cost: [] },
      targeting: { domain: 'actor', actor_targets: true, shape: 'single' },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'resource', op: 'spend', id: 'focus', amount: 'max(1,wis)' }],
      }],
    };
    const result = executeAction(runtime({ focus: 7 }), mechanics, context);

    expect(result.state.resources.focus).toBe(7);
    expect(result.targetState?.resources.focus).toBe(1);
    expect(result.events).toContainEqual({
      type: 'resource_spent', resource: 'focus', amount: 2, remaining: 1,
    });
  });

  it('fails atomically when a result spend cannot be paid', () => {
    const before = runtime({ action: 1, channel_divinity: 0 });

    expect(() => executeAction(before, sourceSpend, { character, rng: () => 0.5 }))
      .toThrowError(new InsufficientResourcesError(['channel_divinity']));
    expect(before.resources).toEqual({ action: 1, channel_divinity: 0 });
  });
});
