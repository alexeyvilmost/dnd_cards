import { describe, expect, it } from 'vitest';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';

const character: CharacterContext = {
  abilityScores: { str: 10, dex: 10, con: 16, int: 10, wis: 10, cha: 10 },
  abilityMods: { str: 0, dex: 0, con: 3, int: 0, wis: 0, cha: 0 },
  profBonus: 2, level: 4, classLevels: { fighter: 4 }, hitDie: 'd10',
};

const state = (): RuntimeState => ({
  hp: { current: 1, max: 30, temp: 0 },
  resources: { bonus_action: 1, hit_dice_d10: 2 },
  maxResources: { bonus_action: 1, hit_dices_d10: 2 },
  activeEffects: [], firedThisTurn: [], inventory: [], equipment: {},
});

const durable = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'hit_die' }] },
  effects: [{ resolution: 'auto', result: [{
    kind: 'healing', hit_die: 'target', hit_die_modifier: 'con',
  }] }],
};

describe('Durable Hit Die healing', () => {
  it('uses the self Hit Die without a duplicate target and adds Constitution, not PB', () => {
    const result = executeAction(state(), durable, { character, rng: () => 0 });
    expect(result.state.resources).toMatchObject({ bonus_action: 0, hit_dice_d10: 1 });
    expect(result.state.hp.current).toBe(5); // natural 1 + CON 3
    expect(result.events.find((event) => event.type === 'healing')).toMatchObject({
      type: 'healing', amount: 4,
    });
  });
});
