import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';

const character: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 3 },
  profBonus: 2,
  level: 2,
  spellcastingMod: 3,
};

const state = (): RuntimeState => ({
  hp: { current: 12, max: 12, temp: 0 },
  resources: { action: 1, spell_slot_1: 3, sorcery_points: 1 },
  maxResources: { action: 1, spell_slot_1: 3, sorcery_points: 2 },
  equipment: {},
  inventory: [],
  activeEffects: [{
    id: 'transmuted-fire',
    name: 'Преобразованное заклинание: огонь',
    source: 'Метамагия',
    mechanics: {
      metamagic_option: 'transmuted',
      damage_type: 'fire',
      end_triggers: ['actor_casts_spell'],
    },
    entityRef: { kind: 'effect', id: 'effect-fire', cardNumber: 'EFFECT-metamagic-transmuted-fire' },
  }],
});

describe('level-two Metamagic runtime', () => {
  it('Transmuted Spell changes eligible spell damage and expires after that cast', () => {
    const target = state();
    target.activeEffects = [];
    const result = executeAction(state(), {
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', amount: 4, type: 'cold' }] }],
    }, {
      character,
      selfId: 'sorcerer',
      target: { id: 'target', runtimeState: target },
      rng: () => 0.5,
      spell: { baseLevel: 1, castLevel: 1 },
    } as ExecuteContext);

    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage', damageType: 'fire' }));
    expect(result.state.activeEffects).toEqual([]);
    expect(result.events).toContainEqual({ type: 'effect_expired', name: 'Преобразованное заклинание: огонь' });
  });

  it('Transmuted Spell leaves ineligible force damage unchanged', () => {
    const target = state();
    target.activeEffects = [];
    const result = executeAction(state(), {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', amount: 4, type: 'force' }] }],
    }, {
      character,
      selfId: 'sorcerer',
      target: { id: 'target', runtimeState: target },
      rng: () => 0.5,
      spell: { baseLevel: 0, castLevel: 0 },
    } as ExecuteContext);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage', damageType: 'force' }));
  });
});
