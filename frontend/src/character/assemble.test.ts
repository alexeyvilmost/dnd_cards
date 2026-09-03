/**
 * Сбор ссылок на способности по уровню — ядро level-up: какие эффекты/действия
 * персонаж получает на данном уровне из level_progression вида/класса + related-*.
 */
import { describe, expect, it } from 'vitest';
import {
  assemble,
  collectEffectGrantRefs,
  collectFeatChoiceRefs,
  expandEffectGrants,
  gatherFeatureRefs,
  multiclassSpellSlotCounts,
} from './assemble';
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

  it('помнит исторический круг ячеек для каждого шага классовой прогрессии', () => {
    const caster = {
      id: 'wizard', name: 'Wizard',
      resources: {
        spell_slot_1: { by_level: { 1: 2, 2: 3 }, per: 'long_rest' },
        spell_slot_2: { by_level: { 3: 2 }, per: 'long_rest' },
        spell_slot_3: { by_level: { 5: 2 }, per: 'long_rest' },
      },
      level_progression: {
        '2': { effects: ['spell-growth'] },
        '3': { effects: ['spell-growth'] },
        '5': { effects: ['spell-growth'] },
      },
    } as unknown as CharacterClass;
    const refs = gatherFeatureRefs(null, caster, [], 5).effectRefs;

    expect(refs.map(({ origin }) => ({
      level: origin.progressionLevel,
      cap: origin.spellSlotLevelCap,
    }))).toEqual([
      { level: 2, cap: 1 },
      { level: 3, cap: 2 },
      { level: 5, cap: 3 },
    ]);
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

  it('кратность сохраняется в gatherFeatureRefs (дедуп неповторяемых — после загрузки тел)', () => {
    // Повторяемые эффекты должны сохранить кратность; т.к. флаг repeatable известен лишь после
    // загрузки тела эффекта, сам gatherFeatureRefs больше НЕ схлопывает по id — это делает assemble
    // после загрузки (неповторяемый → 1 раз, повторяемый → по бусине на прикрепление).
    const dupRace = {
      id: 'r', name: 'R',
      related_effects: ['fx-shared'],
      level_progression: { '1': { effects: ['fx-shared'] } },
    } as unknown as Race;
    const { effectRefs } = gatherFeatureRefs(dupRace, null, [], 1);
    expect(effectRefs.filter((r) => r.id === 'fx-shared')).toHaveLength(2);
  });

  it('без вида и класса — пустые списки', () => {
    const { effectRefs, actionRefs } = gatherFeatureRefs(null, null, [], 1);
    expect(effectRefs).toHaveLength(0);
    expect(actionRefs).toHaveLength(0);
  });

  it('гейтит прогрессию подкласса уровнем его класса, а не общим уровнем', () => {
    const subclass = {
      id: 'evoker', name: 'Воплотитель',
      level_progression: { '3': { effects: ['fx-l3'] }, '5': { effects: ['fx-l5'] } },
    } as unknown as CharacterClass;
    expect(ids(gatherFeatureRefs(null, null, [], 3, null, subclass).effectRefs)).toEqual(['fx-l3']);
    expect(ids(gatherFeatureRefs(null, null, [], 5, null, subclass).effectRefs)).toEqual(['fx-l3', 'fx-l5']);
  });

  it('источник (origin) проставлен для каждой ссылки', () => {
    const { effectRefs } = gatherFeatureRefs(race, klass, [feat], 1);
    const byId = Object.fromEntries(effectRefs.map((r) => [r.id, r.origin.kind]));
    expect(byId['fx-draconic-ancestry']).toBe('race');
    expect(byId['fx-fighting-style']).toBe('class');
    expect(byId['fx-alert-init']).toBe('feat');
  });

  it('подвид добавляет свои эффекты/действия с race-источником', () => {
    const subrace = {
      id: 'high-elf', name: 'Высший эльф',
      related_effects: ['fx-cantrip'], related_actions: ['act-elf-weapon'],
      level_progression: { '3': { effects: ['fx-elf-l3'] } },
    } as unknown as Race;
    const { effectRefs, actionRefs } = gatherFeatureRefs(race, null, [], 3, subrace);
    const byId = Object.fromEntries(effectRefs.map((r) => [r.id, r.origin]));
    expect(byId['fx-cantrip']).toEqual({ kind: 'race', id: 'high-elf', name: 'Высший эльф' });
    expect(byId['fx-elf-l3']).toBeTruthy(); // способность подвида по уровню
    expect(actionRefs.map((r) => r.id)).toContain('act-elf-weapon');
  });

  it('подвид без уровня не тянет способности будущих уровней', () => {
    const subrace = { id: 's', name: 'S', level_progression: { '3': { effects: ['fx-later'] } } } as unknown as Race;
    const { effectRefs } = gatherFeatureRefs(race, null, [], 1, subrace);
    expect(effectRefs.map((r) => r.id)).not.toContain('fx-later');
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

  it('не подключает воззвание выше уровня класса или вне домена', () => {
    const mech = { effects: [{
      kind: 'choice', id: 'invocations',
      options: { source: 'effect', items: [
        { id: 'EFF-level-2', minimum_class_level: 2 },
        { id: 'EFF-level-5', minimum_class_level: 5 },
      ] },
    }] };
    const lowOrigin = { ...ORIGIN, kind: 'class' as const, owningClassLevel: 2 };
    expect(collectEffectGrantRefs(
      mech,
      'id-a',
      lowOrigin,
      draftWith({ invocations: ['EFF-level-5', 'EFF-not-declared'] }),
    )).toEqual([]);
    expect(collectEffectGrantRefs(
      mech,
      'id-a',
      { ...lowOrigin, owningClassLevel: 5 },
      draftWith({ invocations: ['EFF-level-5'] }),
    )).toEqual(['EFF-level-5']);
  });
});

describe('multiclass spell slots', () => {
  const caster = (id: string, cardNumber: string) => ({
    id, card_number: cardNumber, name: id,
  } as unknown as CharacterClass);

  it('combines full and half caster levels while excluding Pact Magic', () => {
    const wizard = caster('wizard', 'CLASS-wizard');
    const paladin = caster('paladin', 'CLASS-paladin');
    const warlock = caster('warlock', 'CLASS-warlock');
    expect(multiclassSpellSlotCounts(
      [wizard, paladin, warlock],
      { wizard: 2, paladin: 2, warlock: 1 },
    )).toEqual([4, 2]);
  });

  it('uses the level-five half-caster row and gives martials no ordinary slots', () => {
    const ranger = caster('ranger', 'CLASS-ranger');
    const fighter = caster('fighter', 'CLASS-warrior');
    expect(multiclassSpellSlotCounts([ranger], { ranger: 5 })).toEqual([4, 2]);
    expect(multiclassSpellSlotCounts([fighter], { fighter: 5 })).toEqual([]);
  });
});

describe('collectFeatChoiceRefs — идентичность повторяемых экземпляров', () => {
  it('keeps the parent instance key in both the choice lookup and returned feat pick', () => {
    const mechanics = {
      effects: [{
        kind: 'choice',
        id: 'human_feat',
        options: { source: 'feat' },
      }],
    };
    const firstOrigin: ChoiceOrigin = {
      kind: 'feat', id: 'human', name: 'Человек', instanceKey: 'slot-a',
    };
    const secondOrigin: ChoiceOrigin = {
      kind: 'feat', id: 'human', name: 'Человек', instanceKey: 'slot-b',
    };
    const firstChoice = 'feat:human:picker#slot-a:human_feat';
    const secondChoice = 'feat:human:picker#slot-b:human_feat';
    const draft = draftWith({
      [firstChoice]: ['feat-skilled'],
      [secondChoice]: ['feat-skilled'],
    });

    expect(collectFeatChoiceRefs(mechanics, 'picker', firstOrigin, draft)).toEqual([{
      featId: 'feat-skilled',
      instanceKey: 'picker#slot-a',
    }]);
    expect(collectFeatChoiceRefs(mechanics, 'picker', secondOrigin, draft)).toEqual([{
      featId: 'feat-skilled',
      instanceKey: 'picker#slot-b',
    }]);
  });
});

describe('assemble — recommendation sidecars', () => {
  it('projects effect choice recommendations without mutating certified mechanics', () => {
    const effect = mkEffect('human-versatile', 'EFF-human-versatile', {
      effects: [{
        kind: 'choice',
        id: 'human_skill',
        options: { source: 'skill' },
        recommended: ['embedded-value'],
      }],
    });
    effect.choice_recommendations = { human_skill: ['perception'] };
    const assembled = assemble({
      race: null,
      klass: null,
      background: null,
      feats: [],
      effects: [oe(effect)],
      actions: [],
      spells: [],
      resources: [],
    }, draftWith());

    expect(assembled.pendingChoices[0]?.recommended).toEqual(['perception']);
    expect(((effect.mechanics?.effects as Array<Record<string, unknown>>)[0]).recommended)
      .toEqual(['embedded-value']);
  });
});

describe('assemble — level-up spellbook preparation', () => {
  it('unions repeated spellbook additions and scales preparation by class level', () => {
    const wizard = { id: 'wizard', name: 'Wizard', hit_die: 'd6' } as unknown as CharacterClass;
    const spellcasting = mkEffect('spellcasting', 'EFF-wizard-spellcasting', {
      effects: [
        { kind: 'choice', id: 'wizard_book', count: 6, options: { source: 'spell' }, grant: { kind: 'grant_spell', label: 'spellbook' } },
        { kind: 'prepared_spell_choice', id: 'wizard_prepared', source_choice_id: 'wizard_book', prompt: 'Prepare', count: 4, count_by_level: { 1: 4, 2: 5 }, resolution: 'on_acquire' },
      ],
    });
    const levelTwoBooks = mkEffect('book-growth', 'wizard_spells_2', {
      effects: [
        { kind: 'choice', id: 'wizard_book', count: 2, options: { source: 'spell' }, grant: { kind: 'grant_spell', label: 'spellbook' } },
      ],
    });
    const bundle = {
      race: null,
      klass: wizard,
      classes: [wizard],
      background: null,
      feats: [],
      effects: [
        oe(spellcasting, { kind: 'class', id: wizard.id, name: wizard.name }),
        oe(levelTwoBooks, { kind: 'class', id: wizard.id, name: wizard.name, instanceKey: 'level-2' }),
      ],
      actions: [], spells: [], resources: [],
    };
    const baseDraft = { ...emptyDraft(), classId: wizard.id, level: 2, classLevels: { [wizard.id]: 2 } };
    const initial = assemble(bundle, baseDraft);
    const bookChoices = initial.pendingChoices.filter((choice) => choice.rawId === 'wizard_book');
    const preparedChoice = initial.pendingChoices.find((choice) => choice.source === 'prepared_spell')!;
    const resolvedChoices = {
      [bookChoices[0].id]: ['spell-1', 'spell-2', 'spell-3', 'spell-4', 'spell-5', 'spell-6'],
      [bookChoices[1].id]: ['spell-7', 'spell-8'],
      [preparedChoice.id]: ['spell-1', 'spell-2', 'spell-3', 'spell-4', 'spell-7'],
    };
    const assembled = assemble(bundle, { ...baseDraft, resolvedChoices });
    const prepared = assembled.pendingChoices.find((choice) => choice.source === 'prepared_spell')!;

    expect(prepared.count).toBe(5);
    expect(prepared.allowedOptionIds).toEqual([
      'spell-1', 'spell-2', 'spell-3', 'spell-4', 'spell-5', 'spell-6', 'spell-7', 'spell-8',
    ]);
  });
});

describe('assemble — class-level choice capacity', () => {
  it('uses the selected class level for an existing expanding choice', () => {
    const warlock = { id: 'warlock', name: 'Warlock', hit_die: 'd8' } as unknown as CharacterClass;
    const invocations = mkEffect('invocations', 'EFF-eldritch-invocations', {
      effects: [{
        kind: 'choice',
        id: 'warlock_invocation_l1',
        count: 1,
        count_by_level: { 1: 1, 2: 3 },
        options: { source: 'effect', items: [
          { id: 'inv-a', name: 'A' }, { id: 'inv-b', name: 'B' },
          { id: 'inv-c', name: 'C', minimum_class_level: 5 },
        ] },
      }],
    });
    const origin = { kind: 'class' as const, id: warlock.id, name: warlock.name };
    const choiceId = 'class:warlock:invocations:warlock_invocation_l1';
    const assembled = assemble({
      race: null, klass: warlock, classes: [warlock], background: null, feats: [],
      effects: [oe(invocations, origin)], actions: [], spells: [], resources: [],
    }, {
      ...emptyDraft(),
      classId: warlock.id,
      level: 2,
      classLevels: { [warlock.id]: 2 },
      resolvedChoices: { [choiceId]: ['inv-a'] },
    });
    const choice = assembled.pendingChoices.find((candidate) => candidate.rawId === 'warlock_invocation_l1');
    expect(choice?.count).toBe(3);
    expect(choice?.origin.owningClassLevel).toBe(2);
    expect(choice?.items?.find((item) => item.id === 'inv-c')?.minimumClassLevel).toBe(5);
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
