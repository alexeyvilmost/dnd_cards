import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';

const state = (owner: string): RuntimeState => ({ hp: { current: 10, max: 10, temp: 0 },
  resources: { action: 1 }, maxResources: { action: 1 }, equipment: {}, inventory: [], activeEffects: [
    { id: `${owner}:a`, name: 'A', source: 'test', mechanics: { stack_id: 'temporary-a' },
      entityRef: { kind: 'effect', id: 'effect-a', cardNumber: 'EFFECT-a' } },
    { id: `${owner}:b`, name: 'B', source: 'test', mechanics: { stack_id: 'temporary-b' },
      entityRef: { kind: 'effect', id: 'effect-b', cardNumber: 'EFFECT-b' } },
  ] });
const character = { level: 1, profBonus: 2, abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 } };

describe('data-owned effect removal routing', () => {
  it.each([{ card_number: 'EFFECT-a' }, { stack_id: 'temporary-a' }])('removes %j from the selected target and retains caster effects', selector => {
    const caster = state('caster'); const target = state('target');
    const action = { activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'remove_effect', ...selector }] }] };
    const result = executeAction(caster, action, { character, selfId: 'caster', rng: () => 0.5,
      target: { id: 'target', runtimeState: target } });
    expect(result.state.activeEffects).toHaveLength(2);
    expect(result.targetState?.activeEffects.map(effect => effect.id)).toEqual(['target:b']);
    expect(result.state.resources.action).toBe(0);
    expect(caster.resources.action).toBe(1);
    expect(target.activeEffects).toHaveLength(2);
    expect(result.events.filter(event => event.type === 'effect_expired')).toEqual([{ type: 'effect_expired', name: 'A' }]);
  });

  it('routes a self-target through the paid caster state exactly once', () => {
    const caster = state('caster');
    const result = executeAction(caster, { activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'remove_effect', card_number: 'EFFECT-b' }] }],
    }, { character, selfId: 'caster', rng: () => 0.5, target: { id: 'caster', runtimeState: caster } });
    expect(result.state.resources.action).toBe(0);
    expect(result.state.activeEffects.map(effect => effect.id)).toEqual(['caster:a']);
  });
});
