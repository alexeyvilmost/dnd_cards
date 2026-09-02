import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import { FIGHTER_CTX, freshFighterState } from '../mvp/fixtures';

describe('Healer Kit runtime contract', () => {
  it('stabilizes the selected living target at 0 HP', () => {
    const actor = {
      ...freshFighterState(),
      resources: { ...freshFighterState().resources, action: 1, 'uses_CARD-0491': 10 },
      maxResources: { ...freshFighterState().maxResources, action: 1, 'uses_CARD-0491': 10 },
    };
    const target = {
      ...freshFighterState(),
      hp: { current: 0, max: 12, temp: 0 },
      deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    };
    const result = executeAction(actor, {
      name: 'Комплект целителя',
      activation: {
        mode: 'active', while: 'carried',
        cost: [{ resource: 'action' }, { resource: 'uses_CARD-0491' }],
      },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single',
        min_targets: 1, max_targets: 1, range_ft: 5,
        requires_line_of_sight: true, allowed_relations: ['ally'],
      },
      effects: [{
        resolution: 'auto', who: 'target',
        result: [
          { kind: 'stabilize', who: 'target' },
          { kind: 'narrative', description: 'Использован один заряд.' },
        ],
      }],
    }, {
      character: FIGHTER_CTX,
      target: { id: 'ally', runtimeState: target, characterContext: FIGHTER_CTX },
      rng: () => 0.5,
    });

    expect(result.targetState?.deathSaves).toEqual({
      successes: 0, failures: 0, stable: true, dead: false,
    });
    expect(result.state.resources['uses_CARD-0491']).toBe(9);
  });
});
