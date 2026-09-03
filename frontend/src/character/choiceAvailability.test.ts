import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { CharacterRuleState } from './rules/types';
import {
  unavailableChoiceItemOptions,
  unavailableChoiceOptions,
  validateChoiceSelection,
} from './choiceAvailability';

function state(): Pick<
  CharacterRuleState,
  'appliedGrants' | 'expertise' | 'proficiencies' | 'spells'
> {
  return {
    proficiencies: {
      skills: ['acrobatics'],
      savingThrows: [],
      tools: ['smith'],
      languages: [],
      weapons: [],
      armor: [],
    },
    expertise: { skills: [], tools: [] },
    spells: { known: [], cantrips: [], leveled: [] },
    appliedGrants: [{
      id: 'background:acrobatics',
      source: { type: 'background', id: 'background:test', name: 'Предыстория' },
      kind: 'skill',
      value: 'acrobatics',
      mode: 'proficiency',
    }],
  };
}

const choice: PendingChoice = {
  id: 'feat:test:feat_skilled',
  prompt: 'Выберите три владения',
  count: 3,
  source: 'explicit',
  origin: { kind: 'feat', id: 'feat:test', name: 'Тестовая черта' },
  items: [
    {
      id: 'skill:acrobatics', name: 'Акробатика',
      grants: [{ kind: 'grant_proficiency', prof: 'skill', value: 'acrobatics' }],
    },
    {
      id: 'skill:arcana', name: 'Магия',
      grants: [{ kind: 'grant_proficiency', prof: 'skill', value: 'arcana' }],
    },
    {
      id: 'tool:smith', name: 'Кузнец',
      grants: [{ kind: 'grant_proficiency', prof: 'tool', value: 'smith' }],
    },
  ],
};

describe('adaptive proficiency-or-expertise choices', () => {
  it('keeps an already proficient skill available for expertise and blocks existing expertise', () => {
    const adaptive: PendingChoice = {
      id: 'observant_skill', prompt: 'Навык', count: 1, source: 'skill', origin: choice.origin,
      grant: { kind: 'grant_proficiency_or_expertise', prof: 'skill' },
    };
    expect(unavailableChoiceOptions(adaptive, state(), ['acrobatics'])).toEqual({});
    const expert = state(); expert.expertise.skills.push('acrobatics');
    expect(unavailableChoiceOptions(adaptive, expert, ['acrobatics']).acrobatics).toContain('Экспертность');
  });
});

describe('declarative choice option availability', () => {
  it('disables existing proficiency grants without branching on entity identity', () => {
    expect(unavailableChoiceItemOptions(choice, state())).toEqual({
      'skill:acrobatics': 'Уже получено из «Предыстория»',
      'tool:smith': 'Владение уже получено',
    });
  });

  it('keeps current selections removable while reserving their declared grants', () => {
    const duplicated: PendingChoice = {
      ...choice,
      items: [
        ...choice.items!,
        {
          id: 'skill:arcana-alias', name: 'Магия (дубликат)',
          grants: [{ kind: 'grant_proficiency', prof: 'skill', value: 'arcana' }],
        },
      ],
    };
    const unavailable = unavailableChoiceItemOptions(duplicated, state(), ['skill:arcana']);
    expect(unavailable).toMatchObject({
      'skill:arcana-alias': 'Такой результат уже выбран в этом выборе',
    });
    expect(unavailable).not.toHaveProperty('skill:arcana');
  });

  it('materializes a choice-level grant template for registry options', () => {
    const registryChoice: PendingChoice = {
      id: 'class:test:skills',
      prompt: 'Навык',
      count: 1,
      source: 'skill',
      grant: { kind: 'grant_proficiency', prof: 'skill' },
      origin: { kind: 'class', id: 'class:test', name: 'Класс' },
    };
    expect(unavailableChoiceOptions(
      registryChoice,
      state(),
      ['acrobatics', 'arcana'],
    )).toEqual({ acrobatics: 'Уже получено из «Предыстория»' });
  });

  it('does not depend on a choice id or prompt', () => {
    const renamed = {
      ...choice,
      id: 'feat:test:renamed-without-known-suffix',
      prompt: 'Любое новое название',
    };
    expect(unavailableChoiceItemOptions(renamed, state()))
      .toEqual(unavailableChoiceItemOptions(choice, state()));
  });

  it('blocks an option reserved by another repeatable feat instance', () => {
    const repeatable: PendingChoice = {
      ...choice,
      count: 1,
      reservedOptionIds: ['skill:arcana'],
    };
    expect(unavailableChoiceItemOptions(repeatable, state())).toMatchObject({
      'skill:arcana': 'Уже выбрано другим экземпляром этой черты',
    });
  });

  it('uses the same expertise aliases as the resolver', () => {
    const expertise: PendingChoice = {
      id: 'class:test:expertise',
      prompt: 'Экспертиза',
      count: 1,
      source: 'skill',
      grant: { kind: 'grant_proficiency', prof: 'skill', expertise: true },
      origin: { kind: 'class', id: 'class:test', name: 'Класс' },
    };
    expect(unavailableChoiceOptions(
      expertise,
      state(),
      ['acrobatics', 'arcana'],
    )).toEqual({ arcana: 'Сначала требуется владение' });
  });

  it('blocks a canonical non-repeatable feat but permits a repeatable alias', () => {
    const featChoice: PendingChoice = {
      id: 'race:human:feat',
      prompt: 'Черта',
      count: 1,
      source: 'feat',
      grant: { kind: 'grant_feat' },
      origin: { kind: 'race', id: 'human', name: 'Человек' },
    };
    const canonical = (reference: string) => ({
      'FEAT-TOUGH': 'feat-tough',
      'FEAT-SKILLED': 'feat-skilled',
    }[reference] ?? reference);
    expect(unavailableChoiceOptions(
      featChoice,
      state(),
      ['FEAT-TOUGH', 'FEAT-SKILLED'],
      [],
      {
        activeFeatIds: new Set(['feat-tough', 'feat-skilled']),
        repeatableFeatIds: new Set(['feat-skilled']),
        canonicalFeatId: canonical,
      },
    )).toEqual({ 'FEAT-TOUGH': 'Уже получена — черта не повторяется' });
  });

  it('normalizes UUID/card-number spell aliases and repeated validation is stable', () => {
    const spellChoice: PendingChoice = {
      id: 'feat:test:spell',
      prompt: 'Заклинание',
      count: 1,
      source: 'spell',
      grant: { kind: 'grant_spell' },
      origin: { kind: 'feat', id: 'feat:test', name: 'Черта' },
    };
    const withSpell = state();
    withSpell.spells.known = ['spell-shield'];
    const canonical = (reference: string) => (
      reference === 'SPELL-SHIELD' ? 'spell-shield' : reference
    );
    expect(unavailableChoiceOptions(
      spellChoice,
      withSpell,
      ['SPELL-SHIELD'],
      [],
      { canonicalSpellId: canonical },
    )).toEqual({ 'SPELL-SHIELD': 'Заклинание уже получено' });

    const baseline = state();
    const first = validateChoiceSelection(
      spellChoice,
      baseline,
      ['SPELL-SHIELD'],
      ['SPELL-SHIELD'],
      { canonicalSpellId: canonical },
    );
    const repeated = validateChoiceSelection(
      spellChoice,
      baseline,
      ['SPELL-SHIELD'],
      ['SPELL-SHIELD'],
      { canonicalSpellId: canonical },
    );
    expect(first).toEqual([]);
    expect(repeated).toEqual(first);
  });

  it('validates atomic replacement against state without its old result', () => {
    const replacementChoice: PendingChoice = {
      ...choice,
      items: [
        ...choice.items!,
        {
          id: 'tool:brewer', name: 'Пивовар',
          grants: [{ kind: 'grant_proficiency', prof: 'tool', value: 'brewer' }],
        },
        {
          id: 'tool:calligrapher', name: 'Каллиграф',
          grants: [{ kind: 'grant_proficiency', prof: 'tool', value: 'calligrapher' }],
        },
      ],
    };
    const baseline = state();
    const replacement = validateChoiceSelection(
      replacementChoice,
      baseline,
      ['skill:arcana', 'tool:brewer', 'tool:calligrapher'],
      replacementChoice.items!.map((item) => item.id),
    );
    expect(replacement).toEqual([]);
    expect(validateChoiceSelection(
      replacementChoice,
      baseline,
      ['skill:acrobatics', 'skill:arcana', 'tool:brewer'],
      replacementChoice.items!.map((item) => item.id),
    )).toEqual([
      expect.objectContaining({ optionId: 'skill:acrobatics' }),
    ]);
  });
});
