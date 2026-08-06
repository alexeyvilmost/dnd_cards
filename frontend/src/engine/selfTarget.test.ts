import { describe, expect, it } from 'vitest';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';

type Dict = Record<string, unknown>;

const CHARACTER: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

function runtime(hp: number): RuntimeState {
  return {
    hp: { current: hp, max: 20, temp: 0 },
    resources: { action: 1 },
    maxResources: { action: 1 },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

function selfContext(state: RuntimeState): ExecuteContext {
  let nextId = 0;
  return {
    character: CHARACTER,
    selfRuntime: state,
    selfId: 'self',
    target: {
      id: 'self',
      characterContext: CHARACTER,
      runtimeState: state,
    },
    rng: () => 0,
    nextId: () => `self-target:${++nextId}`,
  };
}

function action(result: Dict[]): Dict {
  return {
    name: 'Self-target regression',
    activation: { cost: [{ resource: 'action' }] },
    effects: [{ resolution: 'auto', who: 'target', result }],
  };
}

function eventsOfType<T extends EngineEvent['type']>(events: EngineEvent[], type: T) {
  return events.filter((event): event is Extract<EngineEvent, { type: T }> => event.type === type);
}

describe("legacy executeAction who:'target' self-target routing", () => {
  it('applies damage to the paid source state exactly once', () => {
    const initial = runtime(20);
    const result = executeAction(
      initial,
      action([{ kind: 'damage', amount: '4', type: 'force' }]),
      selfContext(initial),
    );

    expect(result.state.hp.current).toBe(16);
    expect(result.state.resources.action).toBe(0);
    expect(result.targetState).toBeUndefined();
    expect(eventsOfType(result.events, 'damage')).toEqual([
      expect.objectContaining({ amount: 4, damageType: 'force' }),
    ]);
    expect(eventsOfType(result.events, 'resource_spent')).toHaveLength(1);
    expect(initial.hp.current).toBe(20);
    expect(initial.resources.action).toBe(1);
  });

  it('applies healing to the paid source state exactly once', () => {
    const initial = runtime(10);
    const result = executeAction(
      initial,
      action([{ kind: 'healing', amount: '4' }]),
      selfContext(initial),
    );

    expect(result.state.hp.current).toBe(14);
    expect(result.state.resources.action).toBe(0);
    expect(result.targetState).toBeUndefined();
    expect(eventsOfType(result.events, 'healing')).toEqual([
      expect.objectContaining({ amount: 4 }),
    ]);
    expect(eventsOfType(result.events, 'resource_spent')).toHaveLength(1);
    expect(initial.hp.current).toBe(10);
    expect(initial.resources.action).toBe(1);
  });

  it('applies a condition to the paid source state without duplicating the effect', () => {
    const initial = runtime(20);
    const result = executeAction(
      initial,
      action([{ kind: 'condition', value: 'poisoned', op: 'apply' }]),
      selfContext(initial),
    );

    expect(result.state.resources.action).toBe(0);
    expect(result.targetState).toBeUndefined();
    expect(result.state.activeEffects).toEqual([
      expect.objectContaining({
        id: 'self-target:1',
        mechanics: { kind: 'condition', value: 'poisoned', op: 'apply' },
        sourceId: 'self',
      }),
    ]);
    expect(eventsOfType(result.events, 'condition_applied')).toEqual([
      { type: 'condition_applied', condition: 'poisoned' },
    ]);
    expect(eventsOfType(result.events, 'resource_spent')).toHaveLength(1);
    expect(initial.activeEffects).toEqual([]);
    expect(initial.resources.action).toBe(1);
  });
});
