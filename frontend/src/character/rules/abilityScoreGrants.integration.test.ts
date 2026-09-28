import {describe, expect, it} from 'vitest';
import {resolveCharacterRules} from './resolveCharacterRules';
import {emptyDraft} from '../types';
import type {AssembledCharacter, OriginEffect} from '../assemble';

function projection(effects: Array<{id: string; amount: number; cap: number}>, base: number) {
  const draft = {...emptyDraft(), level: 19, abilities: {str: 10, dex: 10, con: base, int: 10, wis: 10, cha: 10}};
  const assembled = {
    race: {id: 'test-species', name: 'Test species', speed: 30},
    klass: {id: 'test-class', name: 'Test class', hit_die: 'd10', saving_throws: ['con']},
    feats: [], actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {},
    effects: effects.map(({id, amount, cap}) => ({
      effect: {id, name: id, mechanics: {activation: {mode: 'passive'}, effects: [{resolution: 'auto', result: [{kind: 'grant_ability_score', ability: 'con', amount, cap}]}]}},
      origin: {kind: 'feat', id: `owner-${id}`, name: `Owner ${id}`},
    })) as unknown as OriginEffect[],
  } as unknown as AssembledCharacter;
  return resolveCharacterRules({draft, assembled});
}

describe('ability ceilings reach the canonical character projection', () => {
  it('applies a boon-scale increase to score, modifier, saving throw and explained total', () => {
    const result = projection([{id: 'first-entity', amount: 1, cap: 30}], 21);
    expect(result.abilities.con).toBe(22);
    expect(result.abilityMods.con).toBe(6);
    expect(result.savingThrowBonuses.con).toBe(12);
    expect(result.abilitySources?.con?.reduce((sum, part) => sum + part.value, 0)).toBe(22);
  });

  it('supports another declaration with a different amount and maximum without borrowing its ceiling', () => {
    const second = {id: 'unrelated-second-entity', amount: 3, cap: 24};
    const ordinary = {id: 'ordinary-increase', amount: 2, cap: 20};
    const a = projection([ordinary, second], 20);
    const b = projection([second, ordinary], 20);
    expect(a.abilities.con).toBe(23);
    expect(b.abilities.con).toBe(23);
    expect(a.abilitySources?.con?.reduce((sum, part) => sum + part.value, 0)).toBe(23);
    expect(projection([second], 23).abilities.con).toBe(24);
  });
});
