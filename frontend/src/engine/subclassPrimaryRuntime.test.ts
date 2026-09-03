import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import {
  equippedFighterState,
  FIGHTER_CTX_EQUIPPED,
  freshFighterState,
} from '../mvp/fixtures';
import { executeAction } from './execute';

const face = (value: number, sides = 20) => (value - 0.5) / sides;
const sequence = (values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0.5;
};

const frenzy = {
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{
    kind: 'damage_rider', trigger: 'hit_by_attack_roll', dice: '2d6', type: 'weapon',
    scope: 'self', filter: { attackKind: 'weapon', ability: 'str' },
    once_per_turn: 'berserker:frenzy', duration: { type: 'manual' },
    when: [
      { kind: 'you_have_effect_stack', value: 'class:barbarian:rage:damage' },
      { kind: 'attack_advantage_state', value: 'advantage' },
    ],
  }] }],
};

const weaponAttack = {
  activation: { mode: 'active', cost: [] },
  effects: [{
    resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'auto', vs: 'ac',
    on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
  }],
};

function target(): RuntimeState {
  const state = freshFighterState();
  state.hp = { current: 50, max: 50, temp: 0 };
  return state;
}

describe('selected level-three subclass primary mechanics', () => {
  it('applies Frenzy once while both the exact Rage stack and Reckless Advantage are present', () => {
    const state = equippedFighterState();
    state.activeEffects.push(
      {
        id: 'rage', name: 'Ярость', source: 'Ярость',
        mechanics: { kind: 'modifier', stack_id: 'class:barbarian:rage:damage' },
      },
      {
        id: 'reckless', name: 'Безрассудная атака', source: 'Безрассудная атака',
        mechanics: {
          kind: 'modifier', op: 'advantage', applies_to: { roll: 'attack', filter: { ability: 'str' } },
          duration: { type: 'until_start_of_next_turn' },
        },
      },
    );
    const first = executeAction(state, weaponAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'berserker',
      passives: [frenzy],
      target: { id: 'target', ac: 10, runtimeState: target() },
      rng: sequence([face(12), face(18), face(5, 8), face(3, 6), face(4, 6)]),
    });

    expect(first.events.filter((event) => event.type === 'damage')).toHaveLength(2);
    expect(first.state.firedThisTurn).toContain('damage-rider:berserker:frenzy');

    const second = executeAction(first.state, weaponAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'berserker',
      passives: [frenzy],
      target: { id: 'target', ac: 10, runtimeState: first.targetState },
      rng: sequence([face(12), face(18), face(5, 8)]),
    });
    expect(second.events.filter((event) => event.type === 'damage')).toHaveLength(1);
  });

  it('arms Tides of Chaos as a visible next-d20 Advantage and consumes both use and modifier', () => {
    const state = freshFighterState();
    state.resources.uses_tides = 1;
    state.maxResources.uses_tides = 1;
    const tides = {
      activation: { mode: 'active', cost: [{ resource: 'uses_tides' }] },
      effects: [{ resolution: 'auto', result: [{
        kind: 'modifier', op: 'advantage', applies_to: { roll: 'd20' }, consume: 'next',
        duration: { type: 'until_long_rest' }, stack_id: 'wild-magic:tides-of-chaos',
      }] }],
    };
    const armed = executeAction(state, tides, {
      character: FIGHTER_CTX_EQUIPPED, selfId: 'sorcerer', rng: () => 0.5,
    });
    expect(armed.state.resources.uses_tides).toBe(0);
    expect(armed.state.activeEffects).toHaveLength(1);

    const check = executeAction(armed.state, {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'ability_check', ability: 'str', dc: 10, on_success: [] }],
    }, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'sorcerer',
      rng: sequence([face(2), face(15)]),
    });
    const roll = check.events.find((event) => event.type === 'roll');
    expect(roll?.type === 'roll' ? roll.roll.advantage : null).toBe('advantage');
    expect(check.state.activeEffects).toHaveLength(0);
  });
});
