/**
 * Сбор ссылок на способности по уровню — ядро level-up: какие эффекты/действия
 * персонаж получает на данном уровне из level_progression вида/класса + related-*.
 */
import { describe, expect, it } from 'vitest';
import { collectEffectGrantRefs, expandEffectGrants, gatherFeatureRefs } from './assemble';
import type { OriginEffect } from './assemble';
import type { CharacterClass, Feat, PassiveEffect, Race } from '../types';
import { emptyDraft, type CharacterDraft } from './types';
import type { ChoiceOrigin } from '../mechanics/collectChoices';

const race = {
  id: 'dragonborn', name: 'Драконорождённый',
  related_effects: ['fx-draconic-ancestry'],
  related_actions: ['act-breath-weapon'],
  level_progression: { '1': { effects: ['fx-damage-resistance'] }, '5': { effects: ['fx-darkvision-boost'] } },
} as unknown as Race;

const klass = {
  id: 'fighter', name: 'Воин',
  level_progression: {
    '1': { effects: ['fx-fighting-style'], actions: ['act-second-wind'] },
    '2': { actions: ['act-action-surge'] },
    '3': { effects: ['fx-subclass'] },
  },
} as unknown as CharacterClass;

const feat = {
  id: 'alert', name: 'Внимательный',
  related_effects: ['fx-alert-init'], related_actions: [],
} as unknown as Feat;

const ids = (refs: { id: string }[]) => refs.map((r) => r.id).sort();

describe('gatherFeatureRefs — гейт по уровню', () => {
  it('L1: только способности 1 уровня + related, без 2+ уровней', () => {
    const { effectRefs, actionRefs } = gatherFeatureRefs(race, klass, [], 1);
    expect(ids(effectRefs)).toEqual(['fx-damage-resistance', 'fx-draconic-ancestry', 'fx-fighting-style'].sort());
    expect(ids(actionRefs)).toEqual(['act-breath-weapon', 'act-second-wind'].sort());
    expect(ids(effectRefs)).not.toContain('fx-subclass');
    expect(ids(actionRefs)).not.toContain('act-action-surge');
  });

  it('L2 открывает действие 2 уровня (Прилив действий)', () => {
    const { actionRefs } = gatherFeatureRefs(race, klass, [], 2);
    expect(ids(actionRefs)).toContain('act-action-surge');
  });

  it('L5 открывает видовую способность 5 уровня', () => {
    const { effectRefs } = gatherFeatureRefs(race, klass, [], 5);
    expect(ids(effectRefs)).toContain('fx-darkvision-boost');
    expect(ids(effectRefs)).toContain('fx-subclass');
  });

  it('черты добавляют related-эффекты независимо от уровня', () => {
    const { effectRefs } = gatherFeatureRefs(race, klass, [feat], 1);
    expect(ids(effectRefs)).toContain('fx-alert-init');
  });

  it('дедупликация: один id из related и level_progression учитывается однажды', () => {
    const dupRace = {
      id: 'r', name: 'R',
      related_effects: ['fx-shared'],
      level_progression: { '1': { effects: ['fx-shared'] } },
    } as unknown as Race;
    const { effectRefs } = gatherFeatureRefs(dupRace, null, [], 1);
    expect(effectRefs.filter((r) => r.id === 'fx-shared')).toHaveLength(1);
  });

  it('без вида и класса — пустые списки', () => {
    const { effectRefs, actionRefs } = gatherFeatureRefs(null, null, [], 1);
    expect(effectRefs).toHaveLength(0);
    expect(actionRefs).toHaveLength(0);
  });

  it('источник (origin) проставлен для каждой ссылки', () => {
    const { effectRefs } = gatherFeatureRefs(race, klass, [feat], 1);
    const byId = Object.fromEntries(effectRefs.map((r) => [r.id, r.origin.kind]));
    expect(byId['fx-draconic-ancestry']).toBe('race');
    expect(byId['fx-fighting-style']).toBe('class');
    expect(byId['fx-alert-init']).toBe('feat');
  });
});

// ─── Эффекты-«контейнеры»: ссылки на другие эффекты (бусины) ─────────────────

const ORIGIN: ChoiceOrigin = { kind: 'race', id: 'elf', name: 'Эльф' };
type Mech = Record<string, unknown>;

const mkEffect = (id: string, cardNumber: string, mechanics: Mech = {}): PassiveEffect =>
  ({ id, name: id, card_number: cardNumber, mechanics } as unknown as PassiveEffect);
const oe = (e: PassiveEffect, origin: ChoiceOrigin = ORIGIN): OriginEffect => ({ effect: e, origin });

function draftWith(resolvedChoices: Record<string, string[]> = {}): CharacterDraft {
  return { ...emptyDraft(), resolvedChoices };
}

/** Резолвер-заглушка по card_number. */
const resolverFrom = (store: Record<string, PassiveEffect>) =>
  async (slug: string): Promise<PassiveEffect | null> => store[slug] ?? null;

describe('collectEffectGrantRefs — извлечение ссылок на эффекты', () => {
  it('grant_effect values → список slug (режим «получить всё»)', () => {
    const mech = { effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', values: ['EFF-b', 'EFF-c'] }] }] };
    expect(collectEffectGrantRefs(mech, 'id-a', ORIGIN, draftWith())).toEqual(['EFF-b', 'EFF-c']);
  });

  it('grant_effect value (строка) тоже поддерживается', () => {
    const mech = { effects: [{ kind: 'grant_effect', value: 'EFF-b' }] };
    expect(collectEffectGrantRefs(mech, 'id-a', ORIGIN, draftWith())).toEqual(['EFF-b']);
  });

  it('choice source:effect → только выбранные (режим «выбрать X»)', () => {
    const mech = { effects: [{ kind: 'choice', id: 'ch1', options: { source: 'effect', items: [{ id: 'EFF-b' }, { id: 'EFF-c' }] } }] };
    const refs = collectEffectGrantRefs(mech, 'id-a', ORIGIN, draftWith({ ch1: ['EFF-c'] }));
    expect(refs).toEqual(['EFF-c']);
  });

  it('choice без выбора не даёт ссылок', () => {
    const mech = { effects: [{ kind: 'choice', id: 'ch1', options: { source: 'effect', items: [{ id: 'EFF-b' }] } }] };
    expect(collectEffectGrantRefs(mech, 'id-a', ORIGIN, draftWith())).toEqual([]);
  });
});

describe('expandEffectGrants — разворачивание бусин', () => {
  it('«получить всё»: добавляет набор эффектов с origin родителя', async () => {
    const store = { 'EFF-b': mkEffect('id-b', 'EFF-b'), 'EFF-c': mkEffect('id-c', 'EFF-c') };
    const a = oe(mkEffect('id-a', 'EFF-a', { effects: [{ kind: 'grant_effect', values: ['EFF-b', 'EFF-c'] }] }));
    const out = await expandEffectGrants([a], draftWith(), resolverFrom(store));
    expect(out.map((o) => o.effect.id)).toEqual(['id-a', 'id-b', 'id-c']);
    expect(out[1].origin).toEqual(ORIGIN); // бусина наследует источник контейнера
  });

  it('«выбрать X»: разворачивает только выбранные', async () => {
    const store = { 'EFF-b': mkEffect('id-b', 'EFF-b'), 'EFF-c': mkEffect('id-c', 'EFF-c') };
    const a = oe(mkEffect('id-a', 'EFF-a', {
      effects: [{ kind: 'choice', id: 'ch1', options: { source: 'effect', items: [{ id: 'EFF-b' }, { id: 'EFF-c' }] } }],
    }));
    const out = await expandEffectGrants([a], draftWith({ ch1: ['EFF-b'] }), resolverFrom(store));
    expect(out.map((o) => o.effect.id)).toEqual(['id-a', 'id-b']);
  });

  it('рекурсия: бусина ссылается на следующую бусину', async () => {
    const store = {
      'EFF-b': mkEffect('id-b', 'EFF-b', { effects: [{ kind: 'grant_effect', value: 'EFF-c' }] }),
      'EFF-c': mkEffect('id-c', 'EFF-c'),
    };
    const a = oe(mkEffect('id-a', 'EFF-a', { effects: [{ kind: 'grant_effect', value: 'EFF-b' }] }));
    const out = await expandEffectGrants([a], draftWith(), resolverFrom(store));
    expect(out.map((o) => o.effect.id).sort()).toEqual(['id-a', 'id-b', 'id-c']);
  });

  it('защита от цикла: A→B, B→A не зацикливается и не дублирует', async () => {
    const store = {
      'EFF-a': mkEffect('id-a', 'EFF-a', { effects: [{ kind: 'grant_effect', value: 'EFF-b' }] }),
      'EFF-b': mkEffect('id-b', 'EFF-b', { effects: [{ kind: 'grant_effect', value: 'EFF-a' }] }),
    };
    const a = oe(store['EFF-a']);
    const out = await expandEffectGrants([a], draftWith(), resolverFrom(store));
    expect(out.map((o) => o.effect.id)).toEqual(['id-a', 'id-b']);
  });

  it('битая ссылка не роняет разворачивание', async () => {
    const a = oe(mkEffect('id-a', 'EFF-a', { effects: [{ kind: 'grant_effect', value: 'EFF-missing' }] }));
    const out = await expandEffectGrants([a], draftWith(), resolverFrom({}));
    expect(out.map((o) => o.effect.id)).toEqual(['id-a']);
  });
});
