import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { collectRollModifiers } from './modifiers';
import { consumeNextRollEffects } from './execute';
import { rollD20 } from './roll';
import { armBoonForNextRoll, consumeBoonAfterFailure, runtimeBoonSpec } from './boons';

const state = (): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
  equipment: {}, inventory: [], activeEffects: [{
    id: 'boon:1', name: 'Вдохновение барда', source: 'Вдохновение барда',
    mechanics: {
      kind: 'boon', die: '1d6',
      applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
      timing: ['before_roll', 'after_failure'],
    },
    entityRef: { kind: 'effect', id: 'effect:bardic' },
  }],
});

describe('data-driven runtime boons', () => {
  it('arms the declared roll only and is consumed by the shared modifier path', () => {
    const armed = armBoonForNextRoll(state(), 'boon:1', 'attack_roll');
    expect(armed.activeEffects[0].entityRef).toEqual({ kind: 'effect', id: 'effect:bardic' });
    expect(collectRollModifiers(armed, [], { roll: 'attack' }).rules)
      .toContainEqual(expect.objectContaining({ op: 'bonus_die', faces: 6, consume: 'next' }));
    expect(collectRollModifiers(armed, [], { roll: 'saving_throw' }).rules).toEqual([]);
    expect(consumeNextRollEffects(armed, 'attack', []).activeEffects).toHaveLength(0);
  });

  it('validates and consumes an after-failure boon without generated-name matching', () => {
    expect(runtimeBoonSpec(state().activeEffects[0])).toMatchObject({ faces: 6 });
    expect(consumeBoonAfterFailure(state(), 'boon:1', 'saving_throw').state.activeEffects).toHaveLength(0);
    expect(() => consumeBoonAfterFailure(state(), 'boon:1', 'ability_check')).not.toThrow();
  });

  it('rolls and consumes a conditional boon only when the base d20 test fails', () => {
    const armed = armBoonForNextRoll(state(), 'boon:1', 'attack_roll', 'after_failure');
    const rules = collectRollModifiers(armed, [], { roll: 'attack' }).rules;
    expect(rules).toContainEqual(expect.objectContaining({
      op: 'bonus_die_on_failure', faces: 6, consume: 'next_on_failure',
    }));
    const values = [0.375, 0.99]; // d20=8, then d6=6
    const roll = rollD20({
      target: { type: 'ac', value: 13 },
      rules,
      rng: () => values.shift() ?? 0,
    });
    expect(roll).toMatchObject({ total: 14, outcome: 'hit', usedFailureBonus: true });
    expect(consumeNextRollEffects(armed, 'attack', [], {
      failed: roll.usedFailureBonus === true,
      onlyConditional: true,
    }).activeEffects).toHaveLength(0);
  });

  it('refunds Tactical Mind only when its bonus still leaves the check failed', () => {
    const tactical = state();
    tactical.resources['uses_ACT-second-wind'] = 0;
    tactical.maxResources['uses_ACT-second-wind'] = 1;
    tactical.activeEffects[0].mechanics = {
      kind: 'boon', die: '1d10', applies_to: ['ability_check'], timing: ['after_failure'],
      refund_on_failure: { resource: 'uses_ACT-second-wind', amount: 1 },
    };
    const armed = armBoonForNextRoll(tactical, 'boon:1', 'ability_check', 'after_failure');
    const events: import('../mvp/contracts').EngineEvent[] = [];
    const failed = consumeNextRollEffects(armed, 'ability_check', events, {
      failed: true, onlyConditional: true, finalFailed: true,
    });
    expect(failed.resources['uses_ACT-second-wind']).toBe(1);
    expect(events).toContainEqual({
      type: 'resource_restored', resource: 'uses_ACT-second-wind', amount: 1, current: 1,
    });

    const succeededEvents: import('../mvp/contracts').EngineEvent[] = [];
    const succeeded = consumeNextRollEffects(armed, 'ability_check', succeededEvents, {
      failed: true, onlyConditional: true, finalFailed: false,
    });
    expect(succeeded.resources['uses_ACT-second-wind']).toBe(0);
    expect(succeededEvents.some((event) => event.type === 'resource_restored')).toBe(false);
  });
});
