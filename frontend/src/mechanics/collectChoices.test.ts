import { describe, expect, it } from 'vitest';
import {
  collectChoices,
  preparedSpellSelectionIssues,
  type ChoiceOrigin,
} from './collectChoices';
import { choiceKey, sourceKey } from './choiceKey';

const ORIGIN: ChoiceOrigin = { kind: 'feat', id: 'asi', name: 'Улучшение характеристик', featureId: 'asi_fx' };

const asiMechanics = {
  effects: [
    {
      kind: 'choice', id: 'asi_mode', prompt: 'Режим улучшения',
      options: {
        source: 'subfeature',
        items: [
          { id: 'plus2', name: '+2 к одной', grants: [
            { kind: 'choice', id: 'asi_p2', prompt: 'Какую характеристику +2', options: { source: 'ability' } },
          ] },
          { id: 'plus1x2', name: '+1 к двум', grants: [
            { kind: 'choice', id: 'asi_p1', prompt: 'Две характеристики +1', count: 2, options: { source: 'ability' } },
          ] },
        ],
      },
    },
  ],
};

describe('choiceKey — единый формат ключа выбора', () => {
  it('sourceKey/choiceKey строят канонический формат', () => {
    expect(sourceKey('feat', 'asi', 'asi_fx')).toBe('feat:asi:asi_fx');
    expect(sourceKey('race', 'elf')).toBe('race:elf:base'); // без featureId → base
    expect(choiceKey(ORIGIN, 'asi_mode')).toBe('feat:asi:asi_fx:asi_mode');
    expect(choiceKey({ kind: 'race', id: 'elf' }, undefined)).toBe('race:elf:base:choice');
  });
});

describe('collectChoices — всплытие вложенных выборов', () => {
  it('без resolvedChoices всплывает только внешний выбор', () => {
    const out = collectChoices(asiMechanics, ORIGIN);
    expect(out.map((c) => c.id)).toEqual(['feat:asi:asi_fx:asi_mode']);
    expect(out[0].items?.[0].grants).toEqual([
      expect.objectContaining({ kind: 'choice', id: 'asi_p2' }),
    ]);
  });

  it('preserves choice-level grant/apply templates for downstream legality', () => {
    const mechanics = {
      effects: [
        {
          kind: 'choice', id: 'skill', options: { source: 'skill' },
          grant: { kind: 'grant_proficiency', prof: 'skill' },
        },
        {
          kind: 'choice', id: 'damage', options: { source: 'damage_type' },
          apply: { kind: 'resistance', value_into: 'type' },
        },
      ],
    };
    const out = collectChoices(mechanics, ORIGIN);
    expect(out.find((choice) => choice.id.endsWith(':skill'))?.grant).toEqual({
      kind: 'grant_proficiency',
      prof: 'skill',
    });
    expect(out.find((choice) => choice.id.endsWith(':damage'))?.grant).toEqual({
      kind: 'resistance',
      value_into: 'type',
    });
  });

  it('после выбора режима «+2» всплывает вложенный выбор характеристики', () => {
    const out = collectChoices(asiMechanics, ORIGIN, { 'feat:asi:asi_fx:asi_mode': ['plus2'] });
    const ids = out.map((c) => c.id);
    expect(ids).toContain('feat:asi:asi_fx:asi_mode');
    expect(ids).toContain('feat:asi:asi_fx:asi_p2'); // ключ совпадает с тем, что читает резолвер
    expect(ids).not.toContain('feat:asi:asi_fx:asi_p1'); // ветка +1/+1 не выбрана
  });

  it('после выбора режима «+1/+1» всплывает выбор с count:2', () => {
    const out = collectChoices(asiMechanics, ORIGIN, { 'feat:asi:asi_fx:asi_mode': ['plus1x2'] });
    const p1 = out.find((c) => c.id === 'feat:asi:asi_fx:asi_p1');
    expect(p1).toBeDefined();
    expect(p1?.count).toBe(2);
  });

  it('overlays sidecar recommendations by raw choice id, including nested choices', () => {
    const out = collectChoices(
      {
        effects: [{
          kind: 'choice',
          id: 'outer',
          recommended: ['embedded'],
          options: {
            source: 'subfeature',
            items: [{
              id: 'branch',
              name: 'Ветка',
              grants: [{
                kind: 'choice',
                id: 'human_skill',
                recommended: ['embedded-skill'],
                options: { source: 'skill' },
              }],
            }],
          },
        }],
      },
      ORIGIN,
      { [choiceKey(ORIGIN, 'outer')]: ['branch'] },
      {
        outer: ['branch'],
        human_skill: ['perception'],
      },
    );

    expect(out.find((candidate) => candidate.id.endsWith(':outer'))?.recommended)
      .toEqual(['branch']);
    expect(out.find((candidate) => candidate.id.endsWith(':human_skill'))?.recommended)
      .toEqual(['perception']);
  });
});

describe('prepared_spell_choice', () => {
  const wizardOrigin: ChoiceOrigin = {
    kind: 'class',
    id: 'wizard-uuid',
    name: 'Волшебник',
    featureId: 'wizard-spellcasting-effect',
  };
  const mechanics = {
    effects: [
      {
        kind: 'choice',
        id: 'wizard_spellbook_level_1',
        prompt: 'Книга заклинаний',
        count: 6,
        options: { source: 'spell' },
      },
      {
        kind: 'prepared_spell_choice',
        id: 'wizard_prepared_spells_level_1',
        source_choice_id: 'wizard_spellbook_level_1',
        prompt: 'Подготовьте заклинания',
        count: 4,
        resolution: 'on_acquire',
      },
    ],
  };

  it('строит домен только из фактически сохранённой книги и использует scoped ids', () => {
    const sourceId = choiceKey(wizardOrigin, 'wizard_spellbook_level_1');
    const out = collectChoices(mechanics, wizardOrigin, {
      [sourceId]: ['shield', 'magic-missile', 'sleep', 'detect-magic', 'fog-cloud', 'mage-armor'],
    });
    const prepared = out.find((candidate) => candidate.source === 'prepared_spell');
    expect(prepared).toMatchObject({
      id: choiceKey(wizardOrigin, 'wizard_prepared_spells_level_1'),
      preparedSpellSourceChoiceId: sourceId,
      count: 4,
      allowedOptionIds: ['shield', 'magic-missile', 'sleep', 'detect-magic', 'fog-cloud', 'mage-armor'],
    });
  });

  it('fail-closed валидирует count, дубли и заклинание вне книги', () => {
    const sourceId = choiceKey(wizardOrigin, 'wizard_spellbook_level_1');
    const prepared = collectChoices(mechanics, wizardOrigin, {
      [sourceId]: ['shield', 'magic-missile', 'sleep', 'detect-magic', 'fog-cloud', 'mage-armor'],
    }).find((candidate) => candidate.source === 'prepared_spell')!;
    expect(preparedSpellSelectionIssues(prepared, ['shield', 'shield', 'sleep', 'outside']))
      .toEqual([
        'подготовленные заклинания должны быть различны',
        'заклинания вне выбранной книги: outside',
      ]);
    expect(preparedSpellSelectionIssues(prepared, ['shield'])).toEqual([
      'требуется выбрать ровно 4',
    ]);
  });
});

describe('class-level choice capacity', () => {
  it('retains a data-owned count_by_level table for Forge level-up choices', () => {
    const [choice] = collectChoices({
      effects: [{
        kind: 'choice', id: 'invocations', count: 1,
        count_by_level: { 1: 1, 2: 3 },
        options: { source: 'effect', items: [] },
      }],
    }, { kind: 'class', id: 'warlock', name: 'Warlock', featureId: 'invocations' });
    expect(choice).toMatchObject({ count: 1, countByLevel: { 1: 1, 2: 3 } });
  });
});
