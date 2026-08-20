import { describe, expect, it } from 'vitest';
import { emptyDraft } from './types';
import { bundleDependencyKey, type EntityBundle } from './assemble';
import { collectChoices, type ChoiceOrigin } from '../mechanics/collectChoices';
import type { PassiveEffect } from '../types';

const origin: ChoiceOrigin = { kind: 'class', id: 'class-1', name: 'Класс' };

function effect(mechanics: Record<string, unknown>): PassiveEffect {
  return {
    id: 'effect-1',
    name: 'Выборы',
    description: '',
    rarity: 'common',
    card_number: 'TEST-choice-bundle',
    effect_type: 'class_ability',
    mechanics,
    created_at: '',
    updated_at: '',
  } as PassiveEffect;
}

function bundle(mechanics: Record<string, unknown>): EntityBundle {
  return {
    race: null,
    klass: null,
    background: null,
    feats: [],
    effects: [{ effect: effect(mechanics), origin }],
    actions: [],
    spells: [],
  };
}

describe('bundleDependencyKey', () => {
  it('ignores ordinary resolved choices but tracks entity-expanding choices', () => {
    const mechanics = {
      effects: [{
        resolution: 'auto',
        result: [
          { kind: 'choice', id: 'skill', options: { source: 'skill', filter: 'all' } },
          {
            kind: 'choice',
            id: 'style',
            options: { source: 'feat', items: [{ id: 'feat-a', name: 'A' }] },
          },
        ],
      }],
    };
    const currentBundle = bundle(mechanics);
    const draft = emptyDraft();
    const choices = collectChoices(
      mechanics,
      { ...origin, featureId: 'effect-1', featureName: 'Выборы' },
      draft.resolvedChoices,
    );
    const skillId = choices.find((choice) => choice.source === 'skill')!.id;
    const featId = choices.find((choice) => choice.source === 'feat')!.id;
    const initial = bundleDependencyKey(draft, currentBundle);

    expect(bundleDependencyKey({
      ...draft,
      resolvedChoices: { [skillId]: ['perception'] },
    }, currentBundle)).toBe(initial);

    expect(bundleDependencyKey({
      ...draft,
      resolvedChoices: { [featId]: ['feat-a'] },
    }, currentBundle)).not.toBe(initial);
  });

  it('tracks every direct entity reference consumed by loadBundle', () => {
    const draft = emptyDraft();
    const initial = bundleDependencyKey(draft, null);
    expect(bundleDependencyKey({ ...draft, effectIds: ['effect-a'] }, null)).not.toBe(initial);
    expect(bundleDependencyKey({ ...draft, actionIds: ['action-a'] }, null)).not.toBe(initial);
    expect(bundleDependencyKey({ ...draft, resourceIds: ['resource-a'] }, null)).not.toBe(initial);
    expect(bundleDependencyKey({ ...draft, swapFeat: true }, null)).not.toBe(initial);
  });
});
