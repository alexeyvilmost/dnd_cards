import { describe, expect, it } from 'vitest';
import type { CharacterRuleState } from './rules/types';
import { collectModifiers } from '../engine/modifiers';
import { untrainedArmorCategories, untrainedArmorPenaltyMechanics } from './untrainedArmor';

function ruleState(untrained: boolean): CharacterRuleState {
  return {
    conflicts: untrained ? [{
      code: 'untrained_armor', severity: 'warning', kind: 'armor', value: 'heavy',
      source: { type: 'item', id: 'chain-mail', name: 'Кольчуга' }, message: 'warning',
    }] : [],
  } as CharacterRuleState;
}

describe('untrained armor 2024', () => {
  it('projects equipped untrained categories into runtime context', () => {
    expect(untrainedArmorCategories(ruleState(true))).toEqual(['heavy']);
    expect(untrainedArmorCategories(ruleState(false))).toEqual([]);
  });

  it('imposes disadvantage only on Strength and Dexterity d20 tests', () => {
    const passives = untrainedArmorPenaltyMechanics(ruleState(true));
    const runtime = {
      hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
      activeEffects: [], inventory: [], equipment: {},
    };
    expect(collectModifiers(runtime, passives, { roll: 'attack', filter: { ability: 'str' } }).advantage).toBe('disadvantage');
    expect(collectModifiers(runtime, passives, { roll: 'saving_throw', filter: { ability: 'dex' } }).advantage).toBe('disadvantage');
    expect(collectModifiers(runtime, passives, { roll: 'ability_check', filter: { ability: 'wis' } }).advantage).toBe('none');
  });
});
