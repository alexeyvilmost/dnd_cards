import { describe, expect, it } from 'vitest';
import { collectChoices, type ChoiceOrigin } from './collectChoices';
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
});
