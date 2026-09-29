import { describe, expect, it } from 'vitest';
import { FIGHTER_CTX, freshFighterState } from '../mvp/fixtures';
import { executeAction } from './execute';

const effects = (condition: string, count: number) => Array.from({ length: count }, (_, index) => ({
  id: `${condition}:${index}`, name: condition, source: 'test',
  mechanics: { kind: 'condition', value: condition },
}));

describe('bounded condition removal', () => {
  it.each([
    { condition: 'exhaustion', count: 3, maxRemovals: 1, remaining: 2 },
    { condition: 'poisoned', count: 2, maxRemovals: undefined, remaining: 0 },
  ])('removes $condition without affecting unrelated stacks', ({ condition, count, maxRemovals, remaining }) => {
    const state = freshFighterState();
    state.activeEffects = [...effects(condition, count), ...effects('blinded', 1)];
    const result = executeAction(state, {
      activation: { mode: 'active', cost: [] },
      targeting: { domain: 'actor', actor_targets: false, shape: 'self',
        min_targets: 0, max_targets: 1, range_ft: 0,
        requires_line_of_sight: false, allowed_relations: ['self'] },
      effects: [{ resolution: 'auto', who: 'self', result: [{ kind: 'condition', op: 'remove',
        value: condition, ...(maxRemovals ? { max_removals: maxRemovals } : {}) }] }],
    }, { character: FIGHTER_CTX, rng: () => 0.5 });
    expect(result.state.activeEffects.filter(effect => effect.mechanics.value === condition)).toHaveLength(remaining);
    expect(result.state.activeEffects.filter(effect => effect.mechanics.value === 'blinded')).toHaveLength(1);
  });
});
