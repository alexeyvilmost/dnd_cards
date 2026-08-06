import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction, readTargetSave } from './execute';

const character: CharacterContext = {
  abilityMods: { str: 0, dex: 1, con: 2, int: 0, wis: 0, cha: 3 },
  profBonus: 2,
  level: 1,
  classLevels: { sorcerer: 1 },
  spellcastingAbility: 'cha',
  spellcastingMod: 3,
};

const state: RuntimeState = {
  hp: { current: 8, max: 8, temp: 0 },
  resources: { action: 1, bonus_action: 1, reaction: 1 },
  maxResources: { action: 1, bonus_action: 1, reaction: 1 },
  equipment: {},
  inventory: [],
  activeEffects: [
    {
      id: 'innate:attack',
      name: 'Врождённое чародейство — атаки',
      source: 'feature.innate-sorcery',
      mechanics: {
        kind: 'modifier', op: 'advantage',
        applies_to: { roll: 'attack', filter: { spellClass: 'CLASS-sorcerer' } },
      },
    },
    {
      id: 'innate:dc',
      name: 'Врождённое чародейство — СЛ',
      source: 'feature.innate-sorcery',
      mechanics: {
        kind: 'modifier', op: 'add', value: '1',
        applies_to: { roll: 'spell_save_dc', filter: { spellClass: 'CLASS-sorcerer' } },
      },
    },
  ],
};

const attack = {
  name: 'Луч',
  effects: [{ resolution: 'attack_roll', ability: 'spellcasting', on_hit: [], on_miss: [] }],
};

const save = {
  name: 'Волна',
  effects: [{
    resolution: 'save', who: 'target', ability: 'dex', dc: '8 + prof + spellcasting',
    on_fail: [{ kind: 'damage', dice: '1', type: 'force' }], on_success: [],
  }],
};

function context(sourceClass: string, values: number[]): ExecuteContext & { calls: () => number } {
  let cursor = 0;
  return {
    character,
    selfRuntime: state,
    target: { ac: 15 },
    spell: { baseLevel: 0, castLevel: 0, sourceClass },
    rng: () => values[cursor++] ?? 0,
    calls: () => cursor,
  };
}

describe('class-scoped spell modifiers', () => {
  it('grants advantage only to Sorcerer spell attacks', () => {
    const sorcerer = context('CLASS-sorcerer', [0.1, 0.9]);
    const sorcererResult = executeAction(state, attack, sorcerer);
    const sorcererRoll = sorcererResult.events.find((event) => event.type === 'roll');
    expect(sorcererRoll?.type === 'roll' ? sorcererRoll.roll : null).toMatchObject({
      advantage: 'advantage', outcome: 'hit', dice: [{ result: 19 }, { result: 3, discarded: true }],
    });
    expect(sorcerer.calls()).toBe(2);

    const wizard = context('wizard', [0.1, 0.9]);
    const wizardResult = executeAction(state, attack, wizard);
    const wizardRoll = wizardResult.events.find((event) => event.type === 'roll');
    expect(wizardRoll?.type === 'roll' ? wizardRoll.roll : null).toMatchObject({
      advantage: 'none', outcome: 'miss', dice: [{ result: 3 }],
    });
    expect(wizard.calls()).toBe(1);
  });

  it('adds +1 only to the save DC of Sorcerer spells', () => {
    const sorcerer = context('CLASS-sorcerer', []);
    const wizard = context('wizard', []);
    expect(readTargetSave(save, sorcerer)?.dc).toBe(14);
    expect(readTargetSave(save, wizard)?.dc).toBe(13);
  });
});
