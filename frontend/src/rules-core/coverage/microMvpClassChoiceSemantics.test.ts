import { beforeAll, describe, expect, it } from 'vitest';
import {
  collectActionUsesRecharge,
  collectActionUsesRecovery,
} from '../../character/actionSheet';
import { resolveCharacterRules } from '../../character/rules/resolveCharacterRules';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
} from '../../canon/microMvpL1Overlay';
import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from '../../canon/prodSnapshotL1Fixtures';
import { materializeMicroMvpL1ContentPatch } from '../../canon/declarativeMechanicsPatch';
import { actionUsesKey } from '../../engine/actionUses';
import { collectModifiers } from '../../engine/modifiers';
import { activeMastery } from '../../engine/mastery';
import { parseWeaponProfile } from '../../engine/weaponProfile';
import { buildResourceRecharge } from '../../engine/resources';
import { longRest, shortRest } from '../../engine/turn';
import type { ExecuteContext } from '../../mvp/contracts';
import type { Card, Spell } from '../../types';
import {
  replacePreparedSpells,
  resolveSpellAccess,
  type SpellcastingAccessState,
} from '../spellcastingAccess';

type JsonObject = Record<string, unknown>;

const SPECIES_CARD = 'RACE-0003';
const BACKGROUND_CARD = 'BG-0012';
const ORIGIN_FEAT_CARD = 'FEAT-0005';

const CLASS_CARDS = {
  fighter: 'CLASS-warrior',
  wizard: 'CLASS-wizard',
  rogue: 'CLASS-rogue',
  cleric: 'CLASS-cleric',
  sorcerer: 'CLASS-sorcerer',
  warlock: 'CLASS-warlock',
  druid: 'CLASS-druid',
} as const;

const FIGHTING_STYLE_CARDS = [
  'FEAT-0063',
  'FEAT-0056',
  'FEAT-0061',
  'FEAT-0055',
] as const;

const WARLOCK_INVOCATION_CARDS = [
  'EFF-invoc-armor_of_shadows',
  'EFF-invoc-eldritch_mind',
  'EFF-pact-blade',
  'EFF-pact-chain',
  'EFF-pact-tome',
] as const;

const WEAPON_MASTERY_BINDINGS: Readonly<Record<string, string>> = {
  dagger: 'c00b501c-2e9a-4f32-89e7-1c5ed898d7b2',
  shortbow: '2877d5fd-f912-4186-867d-53d353570ded',
  greatsword: '651f4b6a-74c1-4ecf-a787-d98580bc9495',
  longsword: '4cfe0660-ba1c-415b-b1ed-15e3c708a8e3',
  longbow: 'c7d07a67-374c-49f6-b34b-40e85c26674e',
};

const ROGUE_ADDITIONAL_LANGUAGE_IDS = new Set([
  'common', 'common_sign_language', 'elvish', 'dwarvish', 'giant', 'gnomish',
  'goblin', 'halfling', 'orc', 'abyssal', 'celestial', 'deep_speech', 'druidic',
  'draconic', 'infernal', 'primordial', 'sylvan', 'undercommon',
]);

interface VariantRequest {
  key: string;
  stableKey: string;
  overrides: Readonly<Record<string, readonly string[]>>;
}

type ActorWithSpellcastingAccess = CompiledMicroMvpL1Root['actor'] & {
  /** Expected canonical projection; absent until compiler integration is complete. */
  spellcastingAccess?: SpellcastingAccessState;
};

let provider: CompiledMicroMvpL1Provider;
let catalogs: SnapshotCatalogs;
let roots: Readonly<Record<keyof typeof CLASS_CARDS, CompiledMicroMvpL1Root>>;
let variants: ReadonlyMap<string, CompiledMicroMvpL1Root>;

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing class semantic fixture: ${description}`);
  return value;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rootsByClass(cardNumber: string): CompiledMicroMvpL1Root[] {
  return provider.roots.filter((root) => root.matrixCase.klass.card_number === cardNumber);
}

function rootForClass(cardNumber: string): CompiledMicroMvpL1Root {
  return required(provider.roots.find((root) => (
    root.matrixCase.klass.card_number === cardNumber
      && root.matrixCase.species.card_number === SPECIES_CARD
      && root.matrixCase.background.card_number === BACKGROUND_CARD
      && root.matrixCase.originFeat.card_number === ORIGIN_FEAT_CARD
  )), `${cardNumber}/${SPECIES_CARD}/${BACKGROUND_CARD}/${ORIGIN_FEAT_CARD}`);
}

function pendingChoice(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.assembled.pendingChoices.find((choice) => choice.id.endsWith(`:${suffix}`)),
    `${root.stableKey} choice ${suffix}`,
  );
}

function choiceDecision(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.decisions.find((decision) => decision.choiceId.endsWith(`:${suffix}`)),
    `${root.stableKey} decision ${suffix}`,
  );
}

function effectFor(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return required(
    root.assembled.effects.find(({ effect }) => effect.card_number === cardNumber),
    `${root.stableKey} effect ${cardNumber}`,
  );
}

function actionFor(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return required(
    root.assembled.actions.find(({ action }) => action.card_number === cardNumber),
    `${root.stableKey} action ${cardNumber}`,
  );
}

function payloadsOf(value: unknown): JsonObject[] {
  const result: JsonObject[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as JsonObject;
    if (typeof record.kind === 'string') result.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return result;
}

function selectedSpells(root: CompiledMicroMvpL1Root, suffix: string): Spell[] {
  const byId = new Map(catalogs.spells.flatMap((spell) => [
    [spell.id, spell] as const,
    [spell.card_number, spell] as const,
  ]));
  return choiceDecision(root, suffix).optionIds.map((id) => required(
    byId.get(id),
    `${root.stableKey} selected spell ${id}`,
  ));
}

function expectClassSpellChoice(
  root: CompiledMicroMvpL1Root,
  input: {
    suffix: string;
    count: number;
    level: 0 | 1;
    className: string;
    classCard: string;
    stage?: 'creation' | 'rest';
    requireClassActionProvenance?: boolean;
  },
): Spell[] {
  const choice = pendingChoice(root, input.suffix);
  const decision = choiceDecision(root, input.suffix);
  const spells = selectedSpells(root, input.suffix);

  expect(choice).toMatchObject({
    count: input.count,
    source: 'spell',
    grantKind: 'grant_spell',
    options: {
      source: 'spell',
      filter: { classes: [input.className], levels: [input.level] },
    },
  });
  expect(decision).toEqual({
    choiceId: choice.id,
    optionIds: expect.any(Array),
    stage: input.stage ?? 'creation',
    provenance: 'overlay-policy',
  });
  expect(decision.optionIds).toHaveLength(input.count);
  expect(new Set(decision.optionIds).size).toBe(input.count);
  expect(spells).toHaveLength(input.count);

  for (const spell of spells) {
    expect(spell.level, spell.card_number).toBe(input.level);
    expect(spell.classes, spell.card_number).toContain(input.className);
    expect(root.assembled.spells.map((candidate) => candidate.id)).toContain(spell.id);
    if (input.requireClassActionProvenance === false) continue;
    const action = required(root.rulesActions.find((candidate) => (
      candidate.kind === 'spell'
        && candidate.sourceEntityIds.includes(spell.id)
        && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
    )), `${root.stableKey} class spell action ${spell.card_number}`);
    expect(action.kind).toBe('spell');
    if (action.kind === 'spell') expect(action.spell.sourceClass).toBe(input.classCard);
  }

  return spells;
}

function expectNoL2Cards(
  root: CompiledMicroMvpL1Root,
  input: { effects?: readonly string[]; actions?: readonly string[] },
): void {
  const effects = new Set(root.assembled.effects.map(({ effect }) => effect.card_number));
  const actions = new Set(root.assembled.actions.map(({ action }) => action.card_number));
  for (const cardNumber of input.effects ?? []) expect(effects, cardNumber).not.toContain(cardNumber);
  for (const cardNumber of input.actions ?? []) expect(actions, cardNumber).not.toContain(cardNumber);
}

function variant(key: string): CompiledMicroMvpL1Root {
  return required(variants.get(key), `choice variant ${key}`);
}

function spellActionId(root: CompiledMicroMvpL1Root, spell: Spell): string {
  return required(root.rulesActions.find((action) => (
    action.kind === 'spell'
      && action.sourceEntityIds.includes(spell.id)
      && action.sourceEntityIds.includes(root.matrixCase.klass.id)
  )), `${root.stableKey} action for ${spell.card_number}`).id;
}

function skillRuleBonus(root: CompiledMicroMvpL1Root, skill: string): number {
  return collectModifiers(root.actor.runtime, root.actor.passives ?? [], {
    roll: 'ability_check',
    filter: { skill },
    formulaCtx: {
      abilityMods: root.actor.character.abilityMods,
      profBonus: root.actor.character.profBonus,
      selfLevel: root.actor.character.level,
      classLevels: root.actor.character.classLevels,
      variables: root.actor.character.variables,
    },
  }).modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}

describe('micro-MVP PHB 2024 class and class-choice semantics', () => {
  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for pinned class semantics');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
      catalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
      roots = {
        fighter: rootForClass(CLASS_CARDS.fighter),
        wizard: rootForClass(CLASS_CARDS.wizard),
        rogue: rootForClass(CLASS_CARDS.rogue),
        cleric: rootForClass(CLASS_CARDS.cleric),
        sorcerer: rootForClass(CLASS_CARDS.sorcerer),
        warlock: rootForClass(CLASS_CARDS.warlock),
        druid: rootForClass(CLASS_CARDS.druid),
      };

      const styleIds = new Map(FIGHTING_STYLE_CARDS.map((cardNumber) => [
        cardNumber,
        required(
          catalogs.feats.find((feat) => feat.card_number === cardNumber),
          `Fighting Style ${cardNumber}`,
        ).id,
      ]));
      const wizardBookCards = [
        'detect_magic',
        'SPELL-0174',
        'SPELL-0242',
        'SPELL-0317',
        'SPELL-0190',
        'SPELL-0171',
      ] as const;
      const wizardBookIds = wizardBookCards.map((cardNumber) => required(
        catalogs.spells.find((spell) => spell.card_number === cardNumber),
        `Wizard spellbook spell ${cardNumber}`,
      ).id);
      const requests: VariantRequest[] = [
        ...FIGHTING_STYLE_CARDS.map((cardNumber) => ({
          key: `fighter-style:${cardNumber}`,
          stableKey: roots.fighter.stableKey,
          overrides: { fighter_fighting_style: [required(styleIds.get(cardNumber), cardNumber)] },
        })),
        ...(['protector', 'thaumaturge'] as const).map((option) => ({
          key: `cleric-order:${option}`,
          stableKey: roots.cleric.stableKey,
          overrides: { cleric_divine_order: [option] },
        })),
        ...(['magician', 'warden'] as const).map((option) => ({
          key: `druid-order:${option}`,
          stableKey: roots.druid.stableKey,
          overrides: { druid_primal_order: [option] },
        })),
        ...WARLOCK_INVOCATION_CARDS.map((option) => ({
          key: `warlock-invocation:${option}`,
          stableKey: roots.warlock.stableKey,
          overrides: { warlock_invocation_l1: [option] },
        })),
        {
          key: 'wizard-book:with-ritual',
          stableKey: roots.wizard.stableKey,
          overrides: { wizard_spellbook_level_1: wizardBookIds },
        },
      ];
      const compiled = await compileMicroMvpL1ChoiceVariants(requests);
      variants = new Map(requests.map((request, index) => [request.key, compiled[index]]));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('compiles every Fighter L1 with one of four legal Fighting Styles, Second Wind, and three distinct legal mastery choices without L2 features', () => {
    const legalStyles = new Set(FIGHTING_STYLE_CARDS);
    const expectedMasteries = new Set(['greatsword', 'longbow', 'longsword']);

    for (const root of rootsByClass(CLASS_CARDS.fighter)) {
      expect(root.assembled.klass?.card_number).toBe(CLASS_CARDS.fighter);
      const styleChoice = pendingChoice(root, 'fighter_fighting_style');
      const styleDecision = choiceDecision(root, 'fighter_fighting_style');
      expect(styleChoice).toMatchObject({
        count: 1,
        source: 'feat',
        filter: 'fighting_style',
        grantKind: 'grant_feat',
      });
      expect(styleDecision).toMatchObject({
        choiceId: styleChoice.id,
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(styleDecision.optionIds).toHaveLength(1);
      const style = required(
        catalogs.feats.find((feat) => feat.id === styleDecision.optionIds[0]),
        `${root.stableKey} Fighting Style`,
      );
      expect(style.category).toBe('fighting_style');
      expect(legalStyles).toContain(style.card_number);
      expect(root.assembled.feats).toContainEqual(style);

      const secondWind = actionFor(root, 'ACT-second-wind');
      expect(secondWind.origin).toMatchObject({
        kind: 'class',
        id: root.matrixCase.klass.id,
      });
      expect(secondWind.action.mechanics).toMatchObject({
        activation: {
          mode: 'active',
          cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }],
        },
        effects: [{
          resolution: 'auto',
          result: [{ kind: 'healing', amount: '1d10 + self_level' }],
        }],
        uses: { count: 2, per: 'short_rest' },
      });
      expect(root.actor.runtime.maxResources[actionUsesKey('ACT-second-wind')]).toBe(2);

      const masteryChoice = pendingChoice(root, 'weapon-mastery');
      const masteryDecision = choiceDecision(root, 'weapon-mastery');
      expect(masteryChoice).toMatchObject({
        count: 3,
        source: 'weapon',
        context: 'in_play',
        grantKind: 'weapon_mastery',
      });
      expect(masteryDecision).toMatchObject({ stage: 'rest', provenance: 'overlay-policy' });
      expect(new Set(masteryDecision.optionIds)).toEqual(expectedMasteries);
      expect(new Set(root.actor.character.weaponMasteries ?? [])).toEqual(expectedMasteries);
      expect(effectFor(root, 'EFF-fighting-style').origin).toMatchObject({ kind: 'class' });
      expect(effectFor(root, 'EFF-weapon-mastery-3').origin).toMatchObject({ kind: 'class' });
      expectNoL2Cards(root, {
        effects: ['EFF-tactical-mind'],
        actions: ['ACT-action-surge'],
      });
    }

    for (const cardNumber of FIGHTING_STYLE_CARDS) {
      const root = variant(`fighter-style:${cardNumber}`);
      const selectedId = choiceDecision(root, 'fighter_fighting_style').optionIds[0];
      const selected = required(catalogs.feats.find((feat) => feat.id === selectedId), cardNumber);
      expect(selected.card_number).toBe(cardNumber);
      expect(root.assembled.feats.filter((feat) => feat.category === 'fighting_style'))
        .toEqual([selected]);
    }
  });

  it('restores exactly one expended Second Wind use on a Short Rest and all uses only on a Long Rest', () => {
    const root = roots.fighter;
    const usesKey = actionUsesKey('ACT-second-wind');
    const recharge = collectActionUsesRecharge(root.assembled);
    const recovery = collectActionUsesRecovery(root.assembled);
    const depleted = copy(root.actor.runtime);
    depleted.resources[usesKey] = 0;

    expect(recharge[usesKey]).toBe('short_rest');
    expect(recovery[usesKey]).toEqual({
      short_rest: { mode: 'fixed', amount: 1 },
      long_rest: { mode: 'full' },
    });
    expect(depleted.maxResources[usesKey]).toBe(2);
    expect(shortRest(depleted, {
      ...root.actor.character,
      resourceRecharge: recharge,
      resourceRecovery: recovery,
    })
      .state.resources[usesKey]).toBe(1);
    expect(longRest(depleted, {
      ...root.actor.character,
      resourceRecharge: recharge,
      resourceRecovery: recovery,
    })
      .state.resources[usesKey]).toBe(2);
  });

  it('binds every selected Fighter and Rogue Weapon Mastery to its executable mastery effect', () => {
    for (const classCard of [CLASS_CARDS.fighter, CLASS_CARDS.rogue]) {
      const expectedWeapons = classCard === CLASS_CARDS.fighter
        ? ['greatsword', 'longbow', 'longsword']
        : ['dagger', 'shortbow'];
      for (const root of rootsByClass(classCard)) {
        const selectedWeapons = choiceDecision(root, 'weapon-mastery').optionIds;
        expect(selectedWeapons).toHaveLength(expectedWeapons.length);
        expect(new Set(selectedWeapons)).toEqual(new Set(expectedWeapons));
        const selectedMasteryIds = new Set<string>();
        for (const weaponType of selectedWeapons) {
          const masteryId = required(
            WEAPON_MASTERY_BINDINGS[weaponType],
            `${weaponType} PHB 2024 mastery binding`,
          );
          selectedMasteryIds.add(masteryId);
          const canonical = required(
            catalogs.effects.find((effect) => effect.id === masteryId),
            `${weaponType} mastery effect ${masteryId}`,
          );
          const runtimeMastery = required(
            root.actor.masteryEffects?.[masteryId],
            `${root.stableKey}:${weaponType} runtime mastery`,
          );
          expect(runtimeMastery, `${root.stableKey}:${weaponType}`).toMatchObject({
            name: canonical.name,
            mechanics: canonical.mechanics,
            weaponTypes: [weaponType],
          });
          expect(runtimeMastery.sourceEntityIds, `${root.stableKey}:${weaponType} provenance`)
            .toEqual(expect.arrayContaining([
              root.matrixCase.klass.id,
              root.matrixCase.klass.card_number,
              required(pendingChoice(root, 'weapon-mastery').origin.featureId, 'mastery feature id'),
              canonical.id,
              canonical.card_number,
            ]));
        }
        expect(new Set(Object.keys(root.actor.masteryEffects ?? {})), root.stableKey)
          .toEqual(selectedMasteryIds);

        const executableWeaponType = required(selectedWeapons.find((weaponType) => {
          const mastery = root.actor.masteryEffects?.[WEAPON_MASTERY_BINDINGS[weaponType]];
          const hasProfiledCard = catalogs.cards.some((card) => (
            card.type === 'weapon'
              && card.weapon_type === weaponType
              && card.mastery === WEAPON_MASTERY_BINDINGS[weaponType]
              && parseWeaponProfile(card).valid
          ));
          return hasProfiledCard
            && (mastery?.mechanics as JsonObject | undefined)?.activation
            && ((mastery!.mechanics as JsonObject).activation as JsonObject).mode !== 'passive';
        }), `${root.stableKey} triggered mastery weapon`);
        const equippedWeapon = required(catalogs.cards.find((card) => (
          card.type === 'weapon'
            && card.weapon_type === executableWeaponType
            && card.mastery === WEAPON_MASTERY_BINDINGS[executableWeaponType]
            && parseWeaponProfile(card).valid
        )), `${root.stableKey} canonical ${executableWeaponType}`) as Card;
        const runtime = copy(root.actor.runtime);
        runtime.equipment = { main_hand: equippedWeapon.id };
        const executeContext = {
          character: { ...root.actor.character, knownCards: [equippedWeapon] },
          masteryEffects: root.actor.masteryEffects,
        } as ExecuteContext;
        expect(activeMastery(executeContext, runtime, 'main')).toMatchObject({
          id: WEAPON_MASTERY_BINDINGS[executableWeaponType],
          name: root.actor.masteryEffects?.[WEAPON_MASTERY_BINDINGS[executableWeaponType]]?.name,
        });

        const unselectedWeaponType = classCard === CLASS_CARDS.fighter ? 'shortbow' : 'greatsword';
        const unselectedWeapon = required(catalogs.cards.find((card) => (
          card.type === 'weapon'
            && card.weapon_type === unselectedWeaponType
            && card.mastery === WEAPON_MASTERY_BINDINGS[unselectedWeaponType]
            && parseWeaponProfile(card).valid
        )), `${root.stableKey} unselected ${unselectedWeaponType}`) as Card;
        const unselectedRuntime = copy(root.actor.runtime);
        unselectedRuntime.equipment = { main_hand: unselectedWeapon.id };
        expect(activeMastery({
          ...executeContext,
          character: { ...root.actor.character, knownCards: [unselectedWeapon] },
        }, unselectedRuntime, 'main')).toBeNull();
      }
    }
  });

  it('compiles every Wizard L1 with exactly three cantrips, a six-spell book, Arcane Recovery, and no L2 Scholar feature', () => {
    for (const root of rootsByClass(CLASS_CARDS.wizard)) {
      expectClassSpellChoice(root, {
        suffix: 'wizard_cantrips',
        count: 3,
        level: 0,
        className: 'волшебник',
        classCard: CLASS_CARDS.wizard,
      });
      const spellbook = expectClassSpellChoice(root, {
        suffix: 'wizard_spellbook_level_1',
        count: 6,
        level: 1,
        className: 'волшебник',
        classCard: CLASS_CARDS.wizard,
      });
      expect(new Set(spellbook.map((spell) => spell.id)).size).toBe(6);

      const recovery = actionFor(root, 'ACTION-0001');
      expect(recovery.origin).toMatchObject({ kind: 'class', id: root.matrixCase.klass.id });
      expect(recovery.action.mechanics).toMatchObject({
        activation: { mode: 'rest_decision', cost: [{ resource: 'magic_recovery_charge' }] },
        effects: [],
        rest_decision: {
          kind: 'slot_recovery',
          decision_type: 'arcane_recovery',
          level_source: { kind: 'class_level', class_id: 'wizard' },
          budget: { mode: 'ceil_divide_level', divisor: 2 },
          slot_resource: { prefix: 'spell_slot_', minimum_level: 1, maximum_level: 5 },
        },
      });
      expect(recovery.action.mechanics).not.toHaveProperty('uses');
      expect(root.actor.runtime.maxResources.magic_recovery_charge).toBe(1);
      expect(root.actor.runtime.maxResources.spell_slot_1).toBe(2);
      expectNoL2Cards(root, { effects: ['EFF-wizard-scholar'] });
    }
  });

  it('keeps the Wizard six-spell book separate from an exact four-spell prepared subset', () => {
    const root = roots.wizard;
    const spellbook = selectedSpells(root, 'wizard_spellbook_level_1');
    const actionIds = spellbook.map((spell) => spellActionId(root, spell)).sort();
    const access = (root.actor as ActorWithSpellcastingAccess).spellcastingAccess;

    expect(access, 'compiled Wizard actor must own source-scoped spellcasting access').toBeDefined();
    if (!access) return;
    const prepared = access.preparedSources[CLASS_CARDS.wizard];
    expect(prepared).toEqual({
      sourceId: CLASS_CARDS.wizard,
      capacity: 4,
      availableActionIds: actionIds,
      preparedActionIds: expect.any(Array),
    });
    expect(prepared?.preparedActionIds).toHaveLength(4);
    expect(new Set(prepared?.preparedActionIds).size).toBe(4);
    expect(prepared?.preparedActionIds.every((id) => actionIds.includes(id))).toBe(true);
    expect(access.grants.filter((grant) => (
      grant.sourceId === CLASS_CARDS.wizard && grant.access === 'spellbook'
    ))).toHaveLength(6);
  });

  it('lets Ritual Adept cast an unprepared ritual from the Wizard spellbook without spending a slot', () => {
    const root = variant('wizard-book:with-ritual');
    const ritual = required(
      selectedSpells(root, 'wizard_spellbook_level_1').find((spell) => spell.card_number === 'detect_magic'),
      'Detect Magic in focused Wizard spellbook',
    );
    expect(ritual).toMatchObject({ level: 1, ritual: true });
    const ritualActionId = spellActionId(root, ritual);
    const access = (root.actor as ActorWithSpellcastingAccess).spellcastingAccess;

    expect(access, 'compiled Wizard actor must expose Ritual Adept access').toBeDefined();
    if (!access) return;
    const preparedSource = required(
      access.preparedSources[CLASS_CARDS.wizard],
      'Wizard prepared source',
    );
    const withoutRitual = preparedSource.availableActionIds
      .filter((actionId) => actionId !== ritualActionId)
      .slice(0, preparedSource.capacity);
    const unprepared = replacePreparedSpells(access, CLASS_CARDS.wizard, withoutRitual);
    expect('status' in unprepared).toBe(false);
    if ('status' in unprepared) throw new Error(unprepared.message);
    expect(resolveSpellAccess({
      state: unprepared,
      actionId: ritualActionId,
      mode: 'ritual',
      resources: { spell_slot_1: 0 },
    })).toMatchObject({
      status: 'allowed',
      grant: {
        actionId: ritualActionId,
        sourceId: CLASS_CARDS.wizard,
        access: 'spellbook',
        ritual: true,
      },
      payment: { kind: 'none' },
    });
  });

  it('does not expose Arcane Recovery as an ordinary action before its Short-Rest decision window', () => {
    const root = roots.wizard;
    const recovery = actionFor(root, 'ACTION-0001');
    const compiled = required(root.rulesActions.find((action) => (
      action.kind === 'nonSpell' && action.sourceEntityIds.includes(recovery.action.id)
    )), 'compiled Arcane Recovery capability');

    expect(root.actor.capabilities.actionIds).not.toContain(compiled.id);
    expect((compiled.mechanics.activation as JsonObject | undefined)?.cost)
      .not.toEqual(expect.arrayContaining([{ resource: 'action' }]));
  });

  it('compiles every Rogue L1 with exact Expertise, 1d6 Sneak Attack, two legal masteries, and no L2 Cunning Action', () => {
    const expectedMasteries = ['dagger', 'shortbow'];
    for (const root of rootsByClass(CLASS_CARDS.rogue)) {
      const expertiseChoice = pendingChoice(root, 'rogue_expertise_l1');
      const expertiseDecision = choiceDecision(root, 'rogue_expertise_l1');
      expect(expertiseChoice).toMatchObject({
        count: 2,
        source: 'skill',
        filter: 'proficient',
        grantKind: 'grant_proficiency',
      });
      expect(expertiseDecision.optionIds).toHaveLength(2);
      expect(new Set(expertiseDecision.optionIds).size).toBe(2);
      const rules = resolveCharacterRules({ draft: root.draft, assembled: root.assembled });
      expect(rules.expertise.skills).toEqual(expect.arrayContaining(expertiseDecision.optionIds));
      expect(expertiseDecision.optionIds.every((skill) => (
        rules.proficiencies.skills.includes(skill)
      ))).toBe(true);

      const sneakAttack = effectFor(root, 'EFF-sneak-attack');
      expect(sneakAttack.origin).toMatchObject({ kind: 'class', id: root.matrixCase.klass.id });
      expect(sneakAttack.effect.mechanics).toMatchObject({
        activation: {
          mode: 'triggered',
          trigger: {
            event: 'hit',
            timing: 'during',
            circumstances: [{
              kind: 'all_of',
              of: [
                {
                  kind: 'any_of',
                  of: [
                    { kind: 'attack_weapon_property', value: 'finesse' },
                    { kind: 'attack_range', value: 'ranged' },
                  ],
                },
                {
                  kind: 'any_of',
                  of: [
                    { kind: 'attack_advantage_state', value: 'advantage' },
                    {
                      kind: 'all_of',
                      of: [
                        { kind: 'nearby_eligible_ally_to_target' },
                        {
                          kind: 'not',
                          of: { kind: 'attack_advantage_state', value: 'disadvantage' },
                        },
                      ],
                    },
                  ],
                },
              ],
            }],
          },
        },
        uses: { count: 1, per: 'turn' },
      });
      expect(payloadsOf(sneakAttack.effect.mechanics)).toContainEqual(expect.objectContaining({
        kind: 'damage',
        dice: '1d6',
        type: 'weapon',
        ability: 'none',
      }));

      const mastery = pendingChoice(root, 'weapon-mastery');
      const masteryDecision = choiceDecision(root, 'weapon-mastery');
      expect(mastery).toMatchObject({
        count: 2,
        source: 'weapon',
        context: 'in_play',
        grantKind: 'weapon_mastery',
      });
      expect(masteryDecision).toMatchObject({
        optionIds: expectedMasteries,
        stage: 'rest',
        provenance: 'overlay-policy',
      });
      expect(root.actor.character.weaponMasteries).toEqual(expectedMasteries);
      expectNoL2Cards(root, { effects: ['EFF-cunning-action'] });
    }
  });

  it('grants every Rogue Thieves’ Cant and one additional language at level 1', () => {
    for (const root of rootsByClass(CLASS_CARDS.rogue)) {
      const rules = resolveCharacterRules({ draft: root.draft, assembled: root.assembled });
      const feature = effectFor(root, 'EFF-rogue-thieves-cant');
      const languageChoice = pendingChoice(root, 'rogue_additional_language');
      const decision = choiceDecision(root, 'rogue_additional_language');
      expect(feature.origin).toMatchObject({
        kind: 'class',
        id: root.matrixCase.klass.id,
      });
      expect(languageChoice).toMatchObject({
        count: 1,
        source: 'language',
        grantKind: 'grant_proficiency',
        filter: [...ROGUE_ADDITIONAL_LANGUAGE_IDS],
        origin: {
          kind: 'class',
          id: root.matrixCase.klass.id,
          featureId: feature.effect.id,
        },
      });
      expect(decision).toEqual({
        choiceId: languageChoice.id,
        optionIds: expect.any(Array),
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(decision.optionIds).toHaveLength(1);
      expect(ROGUE_ADDITIONAL_LANGUAGE_IDS).toContain(decision.optionIds[0]);
      expect(languageChoice.filter).not.toContain('thieves_cant');
      expect(rules.proficiencies.languages, root.stableKey).toEqual(expect.arrayContaining([
        'thieves_cant',
        decision.optionIds[0],
      ]));
      expect(root.ruleState).toEqual(rules);

      const languageGrants = rules.appliedGrants.filter((grant) => (
        grant.kind === 'language'
          && grant.source.id === `class:${root.matrixCase.klass.id}:${feature.effect.id}`
      ));
      expect(languageGrants).toHaveLength(2);
      expect(languageGrants.map((grant) => grant.value))
        .toEqual(['thieves_cant', decision.optionIds[0]]);
      for (const grant of languageGrants) {
        expect(grant.source).toMatchObject({
          type: 'class',
          id: `class:${root.matrixCase.klass.id}:${feature.effect.id}`,
        });
      }
      expect(languageGrants.find((grant) => grant.value === 'thieves_cant')?.choiceId)
        .toBeUndefined();
      expect(languageGrants.find((grant) => grant.value === decision.optionIds[0])?.choiceId)
        .toBe(languageChoice.id);
    }

    for (const root of provider.roots.filter((candidate) => (
      candidate.matrixCase.klass.card_number !== CLASS_CARDS.rogue
    ))) {
      expect(root.ruleState.proficiencies.languages, root.stableKey).not.toContain('thieves_cant');
      expect(root.assembled.effects.map(({ effect }) => effect.card_number), root.stableKey)
        .not.toContain('EFF-rogue-thieves-cant');
    }
  });

  it('rejects Thieves’ Cant as the Rogue additional-language choice', async () => {
    await expect(compileMicroMvpL1ChoiceVariants([{
      stableKey: roots.rogue.stableKey,
      overrides: { rogue_additional_language: ['thieves_cant'] },
    }])).rejects.toThrow(/rogue_additional_language:thieves_cant:/);
  });

  it('compiles every Cleric L1 with exactly three class cantrips, four prepared spells, and no L2 Channel Divinity', () => {
    for (const root of rootsByClass(CLASS_CARDS.cleric)) {
      expectClassSpellChoice(root, {
        suffix: 'cleric_cantrips',
        count: 3,
        level: 0,
        className: 'жрец',
        classCard: CLASS_CARDS.cleric,
      });
      expectClassSpellChoice(root, {
        suffix: 'cleric_spells_l1',
        count: 4,
        level: 1,
        className: 'жрец',
        classCard: CLASS_CARDS.cleric,
      });
      expect(root.actor.runtime.maxResources.spell_slot_1).toBe(2);
      expect(root.actor.runtime.maxResources).not.toHaveProperty('channel_divinity');
      expectNoL2Cards(root, { effects: ['EFF-channel-divinity', 'caster-cleric-spells'] });
    }
  });

  it('materializes both structured Divine Order branches with their exact level-1 grants', () => {
    const protector = variant('cleric-order:protector');
    const thaumaturge = variant('cleric-order:thaumaturge');
    expect(choiceDecision(protector, 'cleric_divine_order')).toMatchObject({
      optionIds: ['protector'],
      stage: 'creation',
    });
    expect(choiceDecision(thaumaturge, 'cleric_divine_order')).toMatchObject({
      optionIds: ['thaumaturge'],
      stage: 'creation',
    });

    const protectorRules = resolveCharacterRules({
      draft: protector.draft,
      assembled: protector.assembled,
    });
    expect(protectorRules.proficiencies.armor).toContain('heavy');
    expect(protectorRules.proficiencies.weapons).toContain('martial');

    const extraCantrip = expectClassSpellChoice(thaumaturge, {
      suffix: 'cleric_thaumaturge_cantrip',
      count: 1,
      level: 0,
      className: 'жрец',
      classCard: CLASS_CARDS.cleric,
      requireClassActionProvenance: false,
    });
    const thaumaturgeRules = resolveCharacterRules({
      draft: thaumaturge.draft,
      assembled: thaumaturge.assembled,
    });
    expect(thaumaturgeRules.spells.cantrips).toContain(extraCantrip[0].id);
    const wisdomBonus = Math.max(1, thaumaturgeRules.abilityMods.wis);
    expect(skillRuleBonus(thaumaturge, 'arcana') - skillRuleBonus(protector, 'arcana'))
      .toBe(wisdomBonus);
    expect(skillRuleBonus(thaumaturge, 'religion') - skillRuleBonus(protector, 'religion'))
      .toBe(wisdomBonus);
  });

  it('compiles every Sorcerer L1 with four cantrips, two prepared spells, class-scoped Innate Sorcery, and no L2 Sorcery Points or Metamagic', () => {
    for (const root of rootsByClass(CLASS_CARDS.sorcerer)) {
      expectClassSpellChoice(root, {
        suffix: 'sorcerer_cantrips',
        count: 4,
        level: 0,
        className: 'чародей',
        classCard: CLASS_CARDS.sorcerer,
      });
      expectClassSpellChoice(root, {
        suffix: 'sorcerer_spells_known',
        count: 2,
        level: 1,
        className: 'чародей',
        classCard: CLASS_CARDS.sorcerer,
      });

      const innate = effectFor(root, 'EFF-innate-sorcery');
      expect(innate.origin).toMatchObject({ kind: 'class', id: root.matrixCase.klass.id });
      expect(innate.effect.mechanics).toMatchObject({
        activation: {
          mode: 'active',
          cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }],
        },
        uses: { count: 2, per: 'long_rest' },
      });
      expect(payloadsOf(innate.effect.mechanics)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'modifier',
          op: 'add',
          value: '1',
          applies_to: {
            roll: 'spell_save_dc',
            filter: { spellClass: CLASS_CARDS.sorcerer },
          },
          duration: { type: 'rounds', amount: 10 },
        }),
        expect.objectContaining({
          kind: 'modifier',
          op: 'advantage',
          applies_to: {
            roll: 'attack',
            filter: { spellClass: CLASS_CARDS.sorcerer },
          },
          duration: { type: 'rounds', amount: 10 },
        }),
      ]));
      expect(root.rulesActions).toContainEqual(expect.objectContaining({
        kind: 'nonSpell',
        sourceEntityIds: expect.arrayContaining([innate.effect.id, root.matrixCase.klass.id]),
      }));
      expect(root.actor.passives?.some((passive) => passive.id === 'EFF-innate-sorcery'))
        .toBe(false);
      expect(root.actor.runtime.maxResources).not.toHaveProperty('sorcery_points');
      expectNoL2Cards(root, { effects: ['EFF-font-of-magic', 'EFF-metamagic'] });
    }
  });

  it('compiles every Warlock L1 with two cantrips, two prepared spells, one pact slot carrying Short-Rest recharge metadata, and no L2 feature', () => {
    for (const root of rootsByClass(CLASS_CARDS.warlock)) {
      expectClassSpellChoice(root, {
        suffix: 'warlock_cantrips',
        count: 2,
        level: 0,
        className: 'колдун',
        classCard: CLASS_CARDS.warlock,
      });
      expectClassSpellChoice(root, {
        suffix: 'warlock_spells_known',
        count: 2,
        level: 1,
        className: 'колдун',
        classCard: CLASS_CARDS.warlock,
      });
      const classResources = root.assembled.klass?.resources as JsonObject | null;
      expect(classResources?.spell_slot_1).toEqual({
        by_level: { '1': 1, '2': 2, '3': 0 },
        per: 'short_rest',
      });
      expect(root.actor.runtime.maxResources.spell_slot_1).toBe(1);
      expect(root.actor.runtime.maxResources).not.toHaveProperty('spell_slot_2');
      const recharge = buildResourceRecharge(classResources);
      expect(recharge.spell_slot_1).toBe('short_rest');
      const spent = copy(root.actor.runtime);
      spent.resources.spell_slot_1 = 0;
      expect(shortRest(spent, { ...root.actor.character, resourceRecharge: recharge })
        .state.resources.spell_slot_1).toBe(1);
      expectNoL2Cards(root, { effects: ['caster-warlock-spells'] });
    }
  });

  it('offers exactly the five eligible level-1 Warlock invocations and materializes exactly one selected branch', () => {
    const expected = [...WARLOCK_INVOCATION_CARDS];
    for (const root of rootsByClass(CLASS_CARDS.warlock)) {
      const choice = pendingChoice(root, 'warlock_invocation_l1');
      const decision = choiceDecision(root, 'warlock_invocation_l1');
      expect(choice).toMatchObject({ count: 1, source: 'effect' });
      expect(choice.items?.map((item) => item.id)).toEqual(expected);
      expect(decision).toMatchObject({
        optionIds: [expect.stringMatching(/^EFF-/)],
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(expected).toContain(decision.optionIds[0]);
      expect(root.selectedInvocationEffectIds).toHaveLength(1);
      expect(root.assembled.effects.some(({ effect }) => effect.card_number === 'EFF-pact-boon'))
        .toBe(false);
    }

    for (const option of WARLOCK_INVOCATION_CARDS) {
      const root = variant(`warlock-invocation:${option}`);
      expect(choiceDecision(root, 'warlock_invocation_l1').optionIds).toEqual([option]);
      expect(root.assembled.effects
        .filter(({ effect }) => WARLOCK_INVOCATION_CARDS.some((card) => card === effect.card_number))
        .map(({ effect }) => effect.card_number)).toEqual([option]);
      expect(root.selectedInvocationEffectIds).toEqual([
        effectFor(root, option).effect.id,
      ]);
    }
  });

  it('compiles every Druid L1 with exactly two class cantrips, four prepared spells, and no Wild Shape or other L2 feature', () => {
    for (const root of rootsByClass(CLASS_CARDS.druid)) {
      expectClassSpellChoice(root, {
        suffix: 'druid_cantrips',
        count: 2,
        level: 0,
        className: 'друид',
        classCard: CLASS_CARDS.druid,
      });
      expectClassSpellChoice(root, {
        suffix: 'druid_spells_l1',
        count: 4,
        level: 1,
        className: 'друид',
        classCard: CLASS_CARDS.druid,
      });
      expect(root.actor.runtime.maxResources.spell_slot_1).toBe(2);
      expect(root.actor.runtime.maxResources).not.toHaveProperty('wild_shape');
      expectNoL2Cards(root, {
        effects: ['EFF-wild-companion', 'caster-druid-spells'],
        actions: ['ACT-wild-shape'],
      });
    }
  });

  it('materializes both structured Primal Order branches with their exact level-1 grants', () => {
    const magician = variant('druid-order:magician');
    const warden = variant('druid-order:warden');
    expect(choiceDecision(magician, 'druid_primal_order')).toMatchObject({
      optionIds: ['magician'],
      stage: 'creation',
    });
    expect(choiceDecision(warden, 'druid_primal_order')).toMatchObject({
      optionIds: ['warden'],
      stage: 'creation',
    });

    const wardenRules = resolveCharacterRules({ draft: warden.draft, assembled: warden.assembled });
    expect(wardenRules.proficiencies.armor).toContain('medium');
    expect(wardenRules.proficiencies.weapons).toContain('martial');

    const extraCantrip = expectClassSpellChoice(magician, {
      suffix: 'druid_magician_cantrip',
      count: 1,
      level: 0,
      className: 'друид',
      classCard: CLASS_CARDS.druid,
      requireClassActionProvenance: false,
    });
    const magicianRules = resolveCharacterRules({
      draft: magician.draft,
      assembled: magician.assembled,
    });
    expect(magicianRules.spells.cantrips).toContain(extraCantrip[0].id);
    const wisdomBonus = Math.max(1, magicianRules.abilityMods.wis);
    expect(skillRuleBonus(magician, 'arcana') - skillRuleBonus(warden, 'arcana'))
      .toBe(wisdomBonus);
    expect(skillRuleBonus(magician, 'nature') - skillRuleBonus(warden, 'nature'))
      .toBe(wisdomBonus);
  });
});
