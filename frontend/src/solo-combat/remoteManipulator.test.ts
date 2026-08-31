import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { executeCombatRemoteManipulator } from './engine';
import type { SoloCombatState } from './types';

const runtime: RuntimeState = {
  hp: { current: 9, max: 9, temp: 0 },
  resources: { action: 1 }, maxResources: { action: 1 },
  equipment: {}, inventory: [], firedThisTurn: [], firedThisRest: [],
  activeEffects: [{
    id: 'mage-hand', name: 'Волшебная рука', source: 'Волшебная рука', roundsLeft: 10,
    mechanics: {
      kind: 'remote_manipulator', max_distance_ft: 30, move_per_action_ft: 30,
      max_load_lb: 10, allowed_operations: ['move_object'],
      forbidden_operations: ['attack'],
    },
  }],
};

function state(): SoloCombatState {
  return {
    characterId: 'wizard', outcome: 'active', log: [],
    world: {
      revision: 4, logicalClock: 8, processedCommandIds: [],
      scene: { mode: 'encounter', initiative: ['wizard', 'goblin'], activeIndex: 0, round: 1 },
      actors: { wizard: { id: 'wizard', name: 'Маг', runtime } },
    },
  } as unknown as SoloCombatState;
}

describe('dedicated combat remote manipulator adapter', () => {
  it('spends the active actor action and persists a readable structured scene entry', () => {
    const next = executeCombatRemoteManipulator({
      state: state(), actorId: 'wizard',
      command: {
        operation: 'move_object', distanceFt: 20, objectWeightLb: 8, moveDistanceFt: 15,
        parameters: { object_label: 'рычаг у двери' },
      },
    });
    expect(next.world.actors.wizard.runtime.resources.action).toBe(0);
    expect(next.world.revision).toBe(5);
    expect(next.world.logicalClock).toBe(9);
    expect(next.log.at(-1)?.text).toContain('переместить предмет: рычаг у двери');
    expect(next.log.at(-1)?.records?.at(-1)?.event).toMatchObject({
      type: 'world_interaction', operation: 'move_object',
      parameters: { object_label: 'рычаг у двери', distance_ft: 20, object_weight_lb: 8, move_distance_ft: 15 },
    });
  });
});
