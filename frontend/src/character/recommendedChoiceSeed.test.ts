import { describe, expect, it } from 'vitest';
import {
  choiceOptionIdByReference,
  optionsForChoice,
  recommendedChoiceSeed,
} from './components';
import { unavailableChoiceOptions } from './choiceAvailability';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { Feat } from '../types';

const origin = { kind: 'class' as const, id: 'c1', name: 'Тест' };
function choice(p: Partial<PendingChoice> & { id: string }): PendingChoice {
  return { prompt: 'Выбор', count: 1, source: 'spell', origin, ...p };
}

describe('recommendedChoiceSeed — авто-выбор рекомендованного', () => {
  it('предзаполняет рекомендованные для невыбранного choice', () => {
    const choices = [choice({ id: 'x', count: 2, recommended: ['a', 'b'] })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({ x: ['a', 'b'] });
  });

  it('обрезает рекомендованные по count', () => {
    const choices = [choice({ id: 'x', count: 1, recommended: ['a', 'b', 'c'] })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({ x: ['a'] });
  });

  it('не перетирает уже сделанный выбор', () => {
    const choices = [choice({ id: 'x', count: 2, recommended: ['a', 'b'] })];
    expect(recommendedChoiceSeed(choices, { x: ['z'] }, new Set())).toEqual({});
  });

  it('не перетирает явно очищенный выбор', () => {
    const choices = [choice({ id: 'x', recommended: ['a'] })];
    expect(recommendedChoiceSeed(choices, { x: [] }, new Set())).toEqual({});
  });

  it('игнорирует выбор без recommended', () => {
    const choices = [choice({ id: 'x', count: 2 })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({});
  });

  it('пропускает уже обработанные (applied) — очистка не триггерит повтор', () => {
    const choices = [choice({ id: 'x', recommended: ['a'] })];
    expect(recommendedChoiceSeed(choices, {}, new Set(['x']))).toEqual({});
  });

  it('не трогает выборы контекста in_play (диалог в момент действия)', () => {
    const choices = [choice({ id: 'x', recommended: ['a'], context: 'in_play' })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({});
  });

  it('обрабатывает несколько выборов независимо', () => {
    const choices = [
      choice({ id: 'a', recommended: ['a1'] }),
      choice({ id: 'b', count: 2, recommended: ['b1', 'b2'] }),
      choice({ id: 'c' }),                      // без recommended
      choice({ id: 'd', recommended: ['d1'] }), // уже выбран
    ];
    expect(recommendedChoiceSeed(choices, { d: ['dx'] }, new Set())).toEqual({
      a: ['a1'],
      b: ['b1', 'b2'],
    });
  });

  it('skips an already granted Human/Elf recommendation and fills every slot from legal fallbacks', () => {
    const skillChoice = choice({
      id: 'human_skill',
      source: 'skill',
      count: 2,
      recommended: ['perception'],
      grant: { kind: 'grant_proficiency', prof: 'skill' },
    });
    const state = {
      appliedGrants: [{
        id: 'class:perception',
        source: { type: 'class' as const, id: 'ranger', name: 'Следопыт' },
        kind: 'skill' as const,
        value: 'perception',
        mode: 'proficiency' as const,
      }],
      proficiencies: {
        skills: ['perception'], savingThrows: [], tools: [], languages: [], weapons: [], armor: [],
      },
      expertise: { skills: [], tools: [] },
      spells: { known: [], cantrips: [], leveled: [] },
    };
    expect(recommendedChoiceSeed([skillChoice], {}, new Set(), {
      optionIds: () => ['perception', 'insight', 'survival'],
      unavailableOptions: ({ choice: pending, optionIds, selectedOptionIds }) => (
        unavailableChoiceOptions(pending, state, optionIds, selectedOptionIds)
      ),
    })).toEqual({ human_skill: ['insight', 'survival'] });
  });

  it('projects earlier seeds before resolving a conflicting later recommendation', () => {
    const choices = [
      choice({ id: 'species', recommended: ['perception'] }),
      choice({ id: 'class', recommended: ['perception'] }),
    ];
    expect(recommendedChoiceSeed(choices, {}, new Set(), {
      optionIds: (pending) => pending.id === 'species'
        ? ['perception', 'insight']
        : ['perception', 'stealth'],
      unavailableOptions: ({ selectedOptionIds, resolvedChoices }) => {
        const reserved = new Set([
          ...Object.values(resolvedChoices).flat(),
          ...selectedOptionIds,
        ]);
        return Object.fromEntries([...reserved].map((id) => [id, 'Уже выбрано']));
      },
    })).toEqual({
      species: ['perception'],
      class: ['stealth'],
    });
  });

  it('canonicalizes a stable feat recommendation to the live option id', () => {
    const featChoice = choice({
      id: 'human_feat',
      source: 'feat',
      recommended: ['skilled'],
      filter: 'origin_feats',
    });
    const skilled = {
      id: 'feat-skilled-uuid',
      card_number: 'FEAT-0008',
      name: 'Одарённый',
      name_en: null,
      category: 'origin',
    } as unknown as Feat;
    const options = optionsForChoice(featChoice, [skilled]);

    expect(choiceOptionIdByReference(options, 'skilled')).toBe(skilled.id);
    expect(recommendedChoiceSeed([featChoice], {}, new Set(), {
      optionIds: () => options.map((option) => option.id),
      canonicalOptionId: (_pending, reference) => (
        choiceOptionIdByReference(options, reference)
      ),
    })).toEqual({ human_feat: [skilled.id] });
  });
});
