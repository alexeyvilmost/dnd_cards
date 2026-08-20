import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from './assemble';
import { recommendedOptionSelection } from './components';
import { classSkillChoice } from './forgeHelpers';

function assembled(
  skillChoices: Record<string, unknown>,
  choiceRecommendations?: Record<string, string[]>,
): AssembledCharacter {
  return {
    race: null,
    klass: {
      id: 'class-1',
      name: 'Класс',
      skill_choices: skillChoices,
      choice_recommendations: choiceRecommendations,
    },
    background: null,
    feats: [],
    effects: [],
    actions: [],
    spells: [],
    resources: [],
    pendingChoices: [],
    featAbilityIncreases: [],
    variables: {},
    derived: {
      proficiencyBonus: 2,
      maxHP: 8,
      initiative: 0,
      ac: 10,
      speed: 30,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      spellcasting: { ability: null, attack: 0, saveDC: 8 },
    },
  } as unknown as AssembledCharacter;
}

describe('classSkillChoice recommendations', () => {
  it('preserves normalized recommendations inside the declared option domain', () => {
    expect(classSkillChoice(assembled({
      count: 2,
      options: ['athletics', 'Восприятие', 'arcana'],
    }, {
      class_skills: ['Восприятие', 'not-a-class-option', 'athletics', 'athletics'],
    }))).toEqual({
      count: 2,
      options: ['athletics', 'perception', 'arcana'],
      recommended: ['perception', 'athletics'],
    });
  });

  it('caps recommendations to count and rejects invalid counts', () => {
    expect(classSkillChoice(assembled({
      count: 1,
      options: ['athletics', 'perception'],
    }, { class_skills: ['athletics', 'perception'] }))?.recommended).toEqual(['athletics']);
    expect(classSkillChoice(assembled({ count: 0, options: ['athletics'] }))).toBeNull();
  });

  it('reads only the certification-safe recommendation sidecar', () => {
    expect(classSkillChoice(assembled({
      count: 1,
      options: ['athletics', 'perception'],
      recommended: ['athletics'],
    }, { class_skills: ['perception'] }))?.recommended).toEqual(['perception']);
    expect(classSkillChoice(assembled({
      count: 1,
      options: ['athletics'],
      recommended: ['athletics'],
    }))?.recommended).toEqual([]);
  });

  it('fills a class recommendation after an earlier species grant makes one preferred skill unavailable', () => {
    expect(recommendedOptionSelection({
      count: 3,
      recommended: ['perception', 'stealth', 'survival'],
      optionIds: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
      unavailable: (skill) => skill === 'perception',
    })).toEqual(['stealth', 'survival', 'animal_handling']);
  });
});
