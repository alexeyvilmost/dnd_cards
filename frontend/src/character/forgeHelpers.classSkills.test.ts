import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from './assemble';
import { recommendedOptionSelection } from './components';
import {
  classSkillChoice,
  featOwnedChoicesForSelections,
  levelUpChoicesToShow,
  requiredChoiceIssues,
} from './forgeHelpers';
import type { Feat } from '../types';
import { emptyDraft } from './types';
import { requiresInitialCharacterChoice, type PendingChoice } from '../mechanics/collectChoices';

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

  it('requires the initial Weapon Mastery selection even when later changes happen in play', () => {
    const choice: PendingChoice = {
      id: 'class:fighter:weapon-mastery',
      prompt: 'Искусность: выберите 3 вида оружия',
      count: 3,
      source: 'weapon',
      origin: { kind: 'class', id: 'fighter', name: 'Воин' },
      context: 'in_play',
      grantKind: 'weapon_mastery',
    };
    expect(requiresInitialCharacterChoice(choice)).toBe(true);
    expect(requiresInitialCharacterChoice({ context: 'in_play', grantKind: 'temporary_choice' })).toBe(false);

    const bundle = assembled({ count: 0, options: [] });
    bundle.pendingChoices = [choice];
    const draft = emptyDraft();
    expect(requiredChoiceIssues(draft, bundle)).toEqual([
      '«Искусность: выберите 3 вида оружия»: выберите 3 (выбрано 0)',
    ]);
    draft.resolvedChoices[choice.id] = ['longsword', 'longbow', 'shortsword'];
    expect(requiredChoiceIssues(draft, bundle)).toEqual([]);
  });

  it('rejects a persisted choice above the owning class level', () => {
    const choice: PendingChoice = {
      id: 'class:warlock:invocations', prompt: 'Воззвания', count: 1,
      source: 'effect',
      origin: { kind: 'class', id: 'warlock', name: 'Колдун', owningClassLevel: 2 },
      items: [{ id: 'thirsting-blade', name: 'Жаждущий клинок', minimumClassLevel: 5 }],
    };
    const bundle = assembled({ count: 0, options: [] });
    bundle.pendingChoices = [choice];
    const draft = emptyDraft();
    draft.resolvedChoices[choice.id] = ['thirsting-blade'];

    expect(requiredChoiceIssues(draft, bundle)).toEqual([
      '«Воззвания»: вариант «Жаждущий клинок» требует 5-й уровень класса',
    ]);
  });
});

describe('Forge level-up feat choices', () => {
  const feat = {
    id: 'feat-asi',
    card_number: 'FEAT-0049',
    name: 'Увеличение характеристик',
  } as Feat;
  const featSlot: PendingChoice = {
    id: 'class:fighter:feat-slot',
    prompt: 'Получение черты',
    count: 1,
    source: 'feat',
    origin: {
      kind: 'class', id: 'fighter', name: 'Воин', featureId: 'effect-feat-slot',
    },
  };
  const asiMode: PendingChoice = {
    id: 'feat:feat-asi:asi:asi-mode',
    prompt: 'Улучшение характеристик',
    count: 1,
    source: 'explicit',
    origin: {
      kind: 'feat', id: feat.id, name: feat.name, instanceKey: 'effect-feat-slot',
    },
  };
  const asiAbility: PendingChoice = {
    ...asiMode,
    id: 'feat:feat-asi:asi:asi-one',
    prompt: 'Характеристика (+2)',
    source: 'ability',
  };

  it('keeps newly introduced resolved controls editable until confirmation', () => {
    const oldResolved = { ...asiMode, id: 'class:fighter:old-choice' };
    const oldIncomplete = { ...asiMode, id: 'class:fighter:legacy-incomplete' };
    const resolved = {
      [oldResolved.id]: ['done'],
      [oldIncomplete.id]: [],
      [featSlot.id]: [feat.id],
      [asiMode.id]: ['plus2'],
      [asiAbility.id]: ['str'],
    };

    expect(levelUpChoicesToShow(
      [oldResolved, oldIncomplete, featSlot, asiMode, asiAbility],
      new Set([oldResolved.id, oldIncomplete.id]),
      resolved,
    ).map((choice) => choice.id)).toEqual([
      oldIncomplete.id,
      featSlot.id,
      asiMode.id,
      asiAbility.id,
    ]);
  });

  it('routes a selected class feat own controls back beside its picker', () => {
    const unrelated = {
      ...asiMode,
      id: 'feat:other:choice',
      origin: { kind: 'feat' as const, id: 'feat-other', name: 'Другая черта' },
    };
    expect(featOwnedChoicesForSelections(
      [asiMode, asiAbility, unrelated],
      [featSlot],
      { [featSlot.id]: [feat.card_number] },
      [feat],
    ).map((choice) => choice.id)).toEqual([asiMode.id, asiAbility.id]);
  });
});
