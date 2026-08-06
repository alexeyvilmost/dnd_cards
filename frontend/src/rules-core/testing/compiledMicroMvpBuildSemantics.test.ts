import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from '../../canon/prodSnapshotL1Fixtures';
import { projectStartingEquipmentPatch } from '../../character/startingEquipment';
import { actionUsesKey } from '../../engine/actionUses';
import { payloadsOf } from '../../engine/mechanicsView';
import { collectModifiers } from '../../engine/modifiers';
import type { Background, Feat, Spell } from '../../types';
import {
  MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  PROTECTION_REACTION_CAPABILITY,
} from './fightingStyleFixtures';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import {
  COMPILED_MICRO_MVP_BUILD_SEMANTIC_EVIDENCE,
  executeCompiledMicroMvpSemanticCase,
} from './compiledMicroMvpBuildSemantics';

type JsonRecord = Record<string, unknown>;

const CLASS_CARDS = {
  fighter: 'CLASS-warrior',
  wizard: 'CLASS-wizard',
  rogue: 'CLASS-rogue',
  cleric: 'CLASS-cleric',
  sorcerer: 'CLASS-sorcerer',
  warlock: 'CLASS-warlock',
  druid: 'CLASS-druid',
} as const;

const SPECIES_CARDS = {
  human: 'RACE-0002',
  dwarf: 'RACE-0003',
  elf: 'RACE-0004',
  dragonborn: 'RACE-0008',
} as const;

const BACKGROUND_EXPECTATIONS = [
  {
    entityId: 'background.soldier', cardNumber: 'BG-0012', officialFeatCard: 'FEAT-0004',
    abilityScores: ['str', 'dex', 'con'], abilityAssignments: { str: 2, dex: 1 },
    skills: ['athletics', 'intimidation'], tool: 'Выберите один вид Игрового набора', gold: 14,
    items: [
      ['12b175a4-cbc3-42bd-9d8d-50193a112389', 1],
      ['3d68bd64-50ca-4f7a-b5a9-c79a911b2475', 1],
      ['59b10a1e-8669-4bf6-88a5-69d0abfc76a6', 20],
      ['148bffd3-d797-47a5-b66c-c7d3d04e9c00', 1],
      ['c70618ac-be64-42fe-b338-b6669d1ecf2a', 1],
      ['6112aaef-39b3-4b91-a0fa-96f56987ebb2', 1],
      ['bbc804a1-3a7e-4b09-88c7-21d863ea2d85', 1],
    ],
  },
  {
    entityId: 'background.sage', cardNumber: 'BG-0005', officialFeatCard: 'FEAT-0009',
    abilityScores: ['con', 'int', 'wis'], abilityAssignments: { con: 2, int: 1 },
    skills: ['history', 'arcana'], tool: 'Инструменты каллиграфа', gold: 8,
    items: [
      ['416ce3b6-193e-4186-a481-09375444c090', 1],
      ['69e3364b-e5e9-4a28-92fe-f419d88648bd', 1],
      ['67a7e163-8723-4296-a8cd-67f3e7c4f852', 1],
      ['c10d9a5f-f5b3-44d3-9c62-6bdc4ef90dc4', 8],
      ['40fc2ff7-f2d9-424b-a2c6-7819ddd7b3a5', 1],
    ],
  },
  {
    entityId: 'background.criminal', cardNumber: 'BG-0008', officialFeatCard: 'FEAT-0001',
    abilityScores: ['dex', 'con', 'int'], abilityAssignments: { dex: 2, con: 1 },
    skills: ['sleight_of_hand', 'stealth'], tool: 'Воровские инструменты', gold: 16,
    items: [
      ['db5d576b-3ae1-4402-b4dc-8f7ec7d88b29', 2],
      ['2be96522-100a-46f4-ba35-6e98cb10186c', 1],
      ['75873843-f449-4f2f-8237-3d8dac21ec85', 1],
      ['fdd3770f-0eda-446d-bd78-5944f4d95d9d', 2],
      ['bbc804a1-3a7e-4b09-88c7-21d863ea2d85', 1],
    ],
  },
  {
    entityId: 'background.acolyte', cardNumber: 'BG-0009', officialFeatCard: 'FEAT-0077',
    abilityScores: ['int', 'wis', 'cha'], abilityAssignments: { int: 2, wis: 1 },
    skills: ['insight', 'religion'], tool: 'Инструменты каллиграфа', gold: 8,
    items: [
      ['69e3364b-e5e9-4a28-92fe-f419d88648bd', 1],
      ['c569802e-b19b-4a50-be1d-63bc9718d95e', 1],
      ['dfca725c-d14b-4f6f-afa7-4d778e764aa0', 1],
      ['c10d9a5f-f5b3-44d3-9c62-6bdc4ef90dc4', 10],
      ['40fc2ff7-f2d9-424b-a2c6-7819ddd7b3a5', 1],
    ],
  },
] as const;

const ORIGIN_FEATS = [
  ['feat.alert', 'FEAT-0001'],
  ['feat.magic-initiate', 'FEAT-0009'],
  ['feat.skilled', 'FEAT-0008'],
  ['feat.tough', 'FEAT-0005'],
] as const;

const FIGHTING_STYLE_CARDS = [
  'FEAT-0063', 'FEAT-0056', 'FEAT-0061', 'FEAT-0055',
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

const DRAGONBORN_LINEAGES = {
  black: { card: 'sub-black', damage: 'acid' },
  blue: { card: 'sub-blue', damage: 'lightning' },
  brass: { card: 'sub-brass', damage: 'fire' },
  bronze: { card: 'sub-bronze', damage: 'lightning' },
  copper: { card: 'sub-copper', damage: 'acid' },
  gold: { card: 'sub-gold', damage: 'fire' },
  green: { card: 'sub-green', damage: 'poison' },
  red: { card: 'sub-red', damage: 'fire' },
  silver: { card: 'sub-silver', damage: 'cold' },
  white: { card: 'sub-white', damage: 'cold' },
} as const;

const ELF_LINEAGES = {
  drow: {
    card: 'sub-drow', l1: 'dancing_lights', higher: ['darkness', 'faerie_fire'],
  },
  'high-elf': {
    card: 'sub-high_elf', l1: 'prestidigitation', higher: ['detect_magic', 'misty_step'],
  },
  'wood-elf': {
    card: 'sub-wood_elf', l1: 'druidcraft', higher: ['longstrider', 'pass_without_trace'],
  },
} as const;

interface VariantRequest {
  key: string;
  stableKey: string;
  overrides: Readonly<Record<string, readonly string[]>>;
}

let corpus: CompiledMicroMvpAcceptanceCorpus;
let catalogs: SnapshotCatalogs;
let variants: ReadonlyMap<string, CompiledMicroMvpL1Root>;
let scenarioIndex = 0;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled semantic fixture: ${label}`);
  return value;
}

function rootFor(input: {
  classCard?: string;
  speciesCard?: string;
  backgroundCard?: string;
  originFeatCard?: string;
  lineageCard?: string;
}): CompiledMicroMvpL1Root {
  return required(corpus.compiled.roots.find((root) => (
    (!input.classCard || root.matrixCase.klass.card_number === input.classCard)
      && (!input.speciesCard || root.matrixCase.species.card_number === input.speciesCard)
      && (!input.backgroundCard || root.matrixCase.background.card_number === input.backgroundCard)
      && (!input.originFeatCard || root.matrixCase.originFeat.card_number === input.originFeatCard)
      && (!input.lineageCard || root.speciesAudit.lineageCardNumber === input.lineageCard)
  )), JSON.stringify(input));
}

function choice(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.assembled.pendingChoices.find((candidate) => candidate.id.endsWith(`:${suffix}`)),
    `${root.stableKey}:${suffix}:choice`,
  );
}

function decision(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.decisions.find((candidate) => candidate.choiceId.endsWith(`:${suffix}`)),
    `${root.stableKey}:${suffix}:decision`,
  );
}

function effectByCard(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return required(
    root.assembled.effects.find(({ effect }) => effect.card_number === cardNumber),
    `${root.stableKey}:${cardNumber}:effect`,
  );
}

function executeRoot(root: CompiledMicroMvpL1Root, label: string) {
  const executed = executeCompiledMicroMvpSemanticCase({
    corpus,
    root,
    index: scenarioIndex,
    idPrefix: `compiled-build-${label}`,
  });
  scenarioIndex += 1;
  expect(executed.finalSubject.choices).toEqual(root.decisions);
  expect(executed.finalSubject.ruleState).toEqual(root.ruleState);
  expect(executed.finalSubject.compiledSource.entities).toMatchObject({
    species: { id: root.matrixCase.species.id },
    class: { id: root.matrixCase.klass.id },
    background: { id: root.matrixCase.background.id },
    originFeat: { id: root.matrixCase.originFeat.id },
  });
  return executed;
}

function selectedSpells(root: CompiledMicroMvpL1Root, suffix: string): Spell[] {
  const byReference = new Map(catalogs.spells.flatMap((spell) => [
    [spell.id, spell] as const,
    [spell.card_number, spell] as const,
  ]));
  return decision(root, suffix).optionIds.map((id) => required(
    byReference.get(id), `${root.stableKey}:${suffix}:${id}`,
  ));
}

function rawRecord(value: unknown): JsonRecord {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as JsonRecord;
}

function skillRuntimeBonus(root: CompiledMicroMvpL1Root, skill: string): number {
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

describe('compiled micro-MVP build semantic scenarios', () => {
  beforeAll(async () => {
    corpus = await compileMicroMvpAcceptanceCorpus();
    catalogs = readProdSnapshotCatalogs();
    const classRoot = (classCard: string) => rootFor({
      classCard,
      speciesCard: SPECIES_CARDS.dwarf,
      backgroundCard: 'BG-0012',
      originFeatCard: 'FEAT-0005',
    });
    const styleIds = new Map(FIGHTING_STYLE_CARDS.map((cardNumber) => [
      cardNumber,
      required(catalogs.feats.find((feat) => feat.card_number === cardNumber), cardNumber).id,
    ]));
    const requests: VariantRequest[] = [
      ...(['protector', 'thaumaturge'] as const).map((option) => ({
        key: `cleric-order:${option}`,
        stableKey: classRoot(CLASS_CARDS.cleric).stableKey,
        overrides: { cleric_divine_order: [option] },
      })),
      ...(['magician', 'warden'] as const).map((option) => ({
        key: `druid-order:${option}`,
        stableKey: classRoot(CLASS_CARDS.druid).stableKey,
        overrides: { druid_primal_order: [option] },
      })),
      ...FIGHTING_STYLE_CARDS.map((cardNumber) => ({
        key: `fighter-style:${cardNumber}`,
        stableKey: classRoot(CLASS_CARDS.fighter).stableKey,
        overrides: { fighter_fighting_style: [required(styleIds.get(cardNumber), cardNumber)] },
      })),
    ];
    const compiled = await compileMicroMvpL1ChoiceVariants(requests);
    variants = new Map(requests.map((request, index) => [request.key, compiled[index]]));
  }, 60_000);

  it('exports exactly the independently asserted build-only evidence links without duplicate claims', () => {
    const links = COMPILED_MICRO_MVP_BUILD_SEMANTIC_EVIDENCE.flatMap((item) => item.links);
    expect(links).toHaveLength(44);
    expect(new Set(links.map((link) => `${link.entityId}:${link.obligationId}`)).size).toBe(44);
    expect(COMPILED_MICRO_MVP_BUILD_SEMANTIC_EVIDENCE).toHaveLength(8);
  });

  it('runs each background through the common two-PC protocol and proves stable grants, equipment, and feat replacement', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-BACKGROUNDS-01' },
  }, () => {
    const selectedFeat = required(
      catalogs.feats.find((feat) => feat.card_number === 'FEAT-0005'),
      'Tough product feat',
    );
    for (const expectation of BACKGROUND_EXPECTATIONS) {
      const root = rootFor({
        classCard: CLASS_CARDS.fighter,
        speciesCard: SPECIES_CARDS.dwarf,
        backgroundCard: expectation.cardNumber,
        originFeatCard: selectedFeat.card_number,
      });
      const { finalSubject } = executeRoot(root, `background-${expectation.cardNumber}`);
      const background = root.matrixCase.background as Background;
      const officialFeat = required(
        catalogs.feats.find((feat) => feat.card_number === expectation.officialFeatCard),
        expectation.officialFeatCard,
      );
      const source = required(
        corpus.compiled.source.getFixture(root.sourceFixtureId), root.sourceFixtureId,
      );
      const items = expectation.items.map(([card_id, quantity]) => ({ card_id, quantity }));
      expect(background).toMatchObject({
        card_number: expectation.cardNumber,
        ability_scores: expectation.abilityScores,
        skill_proficiencies: expectation.skills,
        tool_proficiency: expectation.tool,
      });
      expect(root.draft.abilityBonuses).toEqual({
        mode: 'two_one', assignments: expectation.abilityAssignments, anyAbilities: false,
      });
      expect(root.ruleState.proficiencies.skills).toEqual(
        expect.arrayContaining([...expectation.skills]),
      );
      expect(root.ruleState.proficiencies.tools).toContain(expectation.tool);
      expect(root.ruleState.appliedGrants.filter((grant) => (
        grant.source.type === 'background'
      )).map((grant) => ({
        sourceId: grant.source.id, kind: grant.kind, value: grant.value, mode: grant.mode,
      }))).toEqual([
        ...expectation.skills.map((value) => ({
          sourceId: background.id, kind: 'skill', value, mode: 'proficiency',
        })),
        {
          sourceId: background.id, kind: 'tool', value: expectation.tool, mode: 'proficiency',
        },
      ]);
      expect(background.equipment_options?.option_a).toEqual({ items, gold: expectation.gold });
      expect(root.draft.equipmentOption).toBe('a');
      expect(projectStartingEquipmentPatch({}, background.equipment_options?.option_a)).toEqual({
        inventory_items: items.map(({ card_id, quantity: qty }) => ({ card_id, qty })),
        currency: { gold: expectation.gold },
      });
      expect(source.originFeatAudit).toEqual({
        productRuleId: 'free_origin_feat_choice_v1',
        selectedOriginFeatId: selectedFeat.id,
        suppressedOfficialBackgroundFeatId: officialFeat.id,
        grants: [{
          entityId: selectedFeat.id,
          sourceType: 'product_rule',
          sourceId: 'free_origin_feat_choice_v1',
        }],
      });
      expect(root.draft).toMatchObject({ swapFeat: true, featIds: [selectedFeat.id] });
      expect(root.assembled.feats.filter((feat) => feat.category === 'origin').map((feat) => feat.id))
        .toEqual([selectedFeat.id]);
      expect(root.assembled.feats.some((feat) => feat.id === officialFeat.id)).toBe(false);
      expect(finalSubject.ruleState.proficiencies).toMatchObject({
        skills: expect.arrayContaining([...expectation.skills]),
        tools: expect.arrayContaining([expectation.tool]),
      });
    }
  });

  it('runs every product Origin feat on a Human and proves independent background, product, and species grants', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-HUMAN-ORIGIN-01' },
  }, () => {
    const allowedOriginIds = new Set(ORIGIN_FEATS.map(([, cardNumber]) => required(
      catalogs.feats.find((feat) => feat.card_number === cardNumber), cardNumber,
    ).id));
    const background = required(
      catalogs.backgrounds.find((candidate) => candidate.card_number === 'BG-0012'),
      'Soldier background',
    );
    const officialFeat = required(
      catalogs.feats.find((feat) => feat.card_number === 'FEAT-0004'),
      'Soldier official feat',
    );

    for (const [, productCard] of ORIGIN_FEATS) {
      const root = rootFor({
        classCard: CLASS_CARDS.fighter,
        speciesCard: SPECIES_CARDS.human,
        backgroundCard: background.card_number,
        originFeatCard: productCard,
      });
      const { finalSubject } = executeRoot(root, `human-product-${productCard}`);
      const productFeat = root.matrixCase.originFeat as Feat;
      const source = required(
        corpus.compiled.source.getFixture(root.sourceFixtureId), root.sourceFixtureId,
      );
      const featChoice = choice(root, 'human_feat');
      const featDecision = decision(root, 'human_feat');
      const skillChoice = choice(root, 'human_skill');
      const skillDecision = decision(root, 'human_skill');
      const humanFeat = required(
        catalogs.feats.find((feat) => feat.id === featDecision.optionIds[0]),
        `${root.stableKey}:Human Versatile`,
      );

      expect(source.originFeatAudit).toEqual({
        productRuleId: 'free_origin_feat_choice_v1',
        selectedOriginFeatId: productFeat.id,
        suppressedOfficialBackgroundFeatId: officialFeat.id,
        grants: [{
          entityId: productFeat.id,
          sourceType: 'product_rule',
          sourceId: 'free_origin_feat_choice_v1',
        }],
      });
      expect(root.draft).toMatchObject({ swapFeat: true, featIds: [productFeat.id] });
      expect(featChoice).toMatchObject({
        count: 1, source: 'feat', grantKind: 'grant_feat',
      });
      expect(featDecision).toEqual({
        choiceId: featChoice.id,
        optionIds: [humanFeat.id],
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(humanFeat.category).toBe('origin');
      expect(allowedOriginIds).toContain(humanFeat.id);
      expect(humanFeat.id).not.toBe(productFeat.id);
      expect(root.assembled.feats.filter((feat) => feat.category === 'origin').map((feat) => feat.id))
        .toEqual(expect.arrayContaining([productFeat.id, humanFeat.id]));
      expect(root.assembled.feats.filter((feat) => feat.id === productFeat.id)).toHaveLength(1);
      expect(root.assembled.feats.some((feat) => feat.id === officialFeat.id)).toBe(false);

      expect(skillChoice).toMatchObject({
        count: 1, source: 'skill', grantKind: 'grant_proficiency',
      });
      expect(skillDecision).toMatchObject({
        choiceId: skillChoice.id,
        optionIds: [expect.any(String)],
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(root.ruleState.proficiencies.skills).toContain(skillDecision.optionIds[0]);
      expect(root.ruleState.appliedGrants).toContainEqual(expect.objectContaining({
        choiceId: skillChoice.id,
        kind: 'skill',
        value: skillDecision.optionIds[0],
        mode: 'proficiency',
        source: expect.objectContaining({ type: 'species' }),
      }));
      expect(finalSubject.choices).toEqual(expect.arrayContaining([
        featDecision, skillDecision,
      ]));
      expect(finalSubject.ruleState.proficiencies.skills).toContain(skillDecision.optionIds[0]);
    }
  });

  it('runs every class spell-choice root and proves exact counts, legal pools, grants, and provenance', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-CLASS-SPELLS-01' },
  }, () => {
    const classSpecs = [
      {
        classCard: CLASS_CARDS.cleric, className: 'жрец', ability: 'wis',
        choices: [
          { suffix: 'cleric_cantrips', count: 3, level: 0, access: 'cantrip' },
          { suffix: 'cleric_spells_l1', count: 4, level: 1, access: 'always_prepared' },
        ],
      },
      {
        classCard: CLASS_CARDS.druid, className: 'друид', ability: 'wis',
        choices: [
          { suffix: 'druid_cantrips', count: 2, level: 0, access: 'cantrip' },
          { suffix: 'druid_spells_l1', count: 4, level: 1, access: 'always_prepared' },
        ],
      },
      {
        classCard: CLASS_CARDS.sorcerer, className: 'чародей', ability: 'cha',
        choices: [
          { suffix: 'sorcerer_cantrips', count: 4, level: 0, access: 'cantrip' },
          { suffix: 'sorcerer_spells_known', count: 2, level: 1, access: 'known' },
        ],
      },
      {
        classCard: CLASS_CARDS.warlock, className: 'колдун', ability: 'cha',
        choices: [
          { suffix: 'warlock_cantrips', count: 2, level: 0, access: 'cantrip' },
          { suffix: 'warlock_spells_known', count: 2, level: 1, access: 'known' },
        ],
      },
      {
        classCard: CLASS_CARDS.wizard, className: 'волшебник', ability: 'int',
        choices: [
          { suffix: 'wizard_cantrips', count: 3, level: 0, access: 'cantrip' },
          { suffix: 'wizard_spellbook_level_1', count: 6, level: 1, access: 'spellbook' },
        ],
      },
    ] as const;

    for (const classSpec of classSpecs) {
      const root = rootFor({
        classCard: classSpec.classCard,
        speciesCard: SPECIES_CARDS.dwarf,
        backgroundCard: 'BG-0012',
        originFeatCard: 'FEAT-0005',
      });
      const { finalSubject } = executeRoot(root, `class-spells-${classSpec.classCard}`);
      const access = required(root.actor.spellcastingAccess, `${root.stableKey}:spell access`);

      for (const expected of classSpec.choices) {
        const pending = choice(root, expected.suffix);
        const resolved = decision(root, expected.suffix);
        const spells = selectedSpells(root, expected.suffix);
        expect(pending).toMatchObject({
          count: expected.count,
          source: 'spell',
          grantKind: 'grant_spell',
          options: {
            source: 'spell',
            filter: { classes: [classSpec.className], levels: [expected.level] },
          },
        });
        expect(resolved).toEqual({
          choiceId: pending.id,
          optionIds: expect.any(Array),
          stage: 'creation',
          provenance: 'overlay-policy',
        });
        expect(resolved.optionIds).toHaveLength(expected.count);
        expect(new Set(resolved.optionIds).size).toBe(expected.count);
        expect(spells).toHaveLength(expected.count);

        const actionIds: string[] = [];
        for (const spell of spells) {
          expect(spell.level, spell.card_number).toBe(expected.level);
          expect(spell.classes, spell.card_number).toContain(classSpec.className);
          expect(root.assembled.spells.map((candidate) => candidate.id)).toContain(spell.id);
          const action = required(root.rulesActions.find((candidate) => (
            candidate.kind === 'spell'
              && candidate.sourceEntityIds.includes(spell.id)
              && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
          )), `${root.stableKey}:${spell.card_number}:action`);
          expect(action.kind).toBe('spell');
          if (action.kind !== 'spell') throw new Error('unreachable non-spell action');
          expect(action.spell.sourceClass).toBe(classSpec.classCard);
          actionIds.push(action.id);
          expect(access.grants).toContainEqual(expect.objectContaining({
            actionId: action.id,
            sourceId: classSpec.classCard,
            access: expected.access,
            level: expected.level,
            spellcastingAbility: classSpec.ability,
          }));
        }

        if (expected.suffix === 'wizard_spellbook_level_1') {
          const prepared = access.preparedSources[CLASS_CARDS.wizard];
          expect(prepared).toMatchObject({
            sourceId: CLASS_CARDS.wizard,
            capacity: 4,
            availableActionIds: expect.any(Array),
            preparedActionIds: expect.any(Array),
          });
          expect(new Set(prepared?.availableActionIds)).toEqual(new Set(actionIds));
          expect(prepared?.preparedActionIds).toHaveLength(4);
          expect(new Set(prepared?.preparedActionIds).size).toBe(4);
          expect(prepared?.preparedActionIds.every((id) => actionIds.includes(id))).toBe(true);
        }
      }
      expect(finalSubject.spellcastingAccess).toEqual(access);
    }
  });

  it('runs every structured class-choice branch and proves its materialized grants and provenance', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-CLASS-STRUCTURED-01' },
  }, () => {
    const clericProtector = required(variants.get('cleric-order:protector'), 'cleric Protector');
    const clericThaumaturge = required(variants.get('cleric-order:thaumaturge'), 'cleric Thaumaturge');
    const clericRuns = [clericProtector, clericThaumaturge].map((root) => (
      executeRoot(root, `cleric-order-${decision(root, 'cleric_divine_order').optionIds[0]}`)
    ));
    for (const { root, finalSubject } of clericRuns) {
      const pending = choice(root, 'cleric_divine_order');
      const resolved = decision(root, 'cleric_divine_order');
      expect(pending.count).toBe(1);
      expect(pending.items?.map((item) => item.id)).toEqual(['protector', 'thaumaturge']);
      expect(resolved).toMatchObject({
        choiceId: pending.id,
        optionIds: [expect.stringMatching(/^(protector|thaumaturge)$/)],
        stage: 'creation', provenance: 'overlay-policy',
      });
      expect(finalSubject.choices).toContainEqual(resolved);
    }
    expect(clericProtector.ruleState.proficiencies.armor).toContain('heavy');
    expect(clericProtector.ruleState.proficiencies.weapons).toContain('martial');
    const clericExtra = decision(clericThaumaturge, 'cleric_thaumaturge_cantrip');
    expect(clericExtra.optionIds).toHaveLength(1);
    expect(clericThaumaturge.ruleState.spells.cantrips).toContain(clericExtra.optionIds[0]);
    expect(skillRuntimeBonus(clericThaumaturge, 'arcana'))
      .toBeGreaterThan(skillRuntimeBonus(clericProtector, 'arcana'));
    expect(skillRuntimeBonus(clericThaumaturge, 'religion'))
      .toBeGreaterThan(skillRuntimeBonus(clericProtector, 'religion'));

    const druidMagician = required(variants.get('druid-order:magician'), 'druid Magician');
    const druidWarden = required(variants.get('druid-order:warden'), 'druid Warden');
    const druidRuns = [druidMagician, druidWarden].map((root) => (
      executeRoot(root, `druid-order-${decision(root, 'druid_primal_order').optionIds[0]}`)
    ));
    for (const { root, finalSubject } of druidRuns) {
      const pending = choice(root, 'druid_primal_order');
      const resolved = decision(root, 'druid_primal_order');
      expect(pending.count).toBe(1);
      expect(pending.items?.map((item) => item.id)).toEqual(['magician', 'warden']);
      expect(resolved).toMatchObject({
        choiceId: pending.id,
        optionIds: [expect.stringMatching(/^(magician|warden)$/)],
        stage: 'creation', provenance: 'overlay-policy',
      });
      expect(finalSubject.choices).toContainEqual(resolved);
    }
    expect(druidWarden.ruleState.proficiencies.armor).toContain('medium');
    expect(druidWarden.ruleState.proficiencies.weapons).toContain('martial');
    const druidExtra = decision(druidMagician, 'druid_magician_cantrip');
    expect(druidExtra.optionIds).toHaveLength(1);
    expect(druidMagician.ruleState.spells.cantrips).toContain(druidExtra.optionIds[0]);
    expect(skillRuntimeBonus(druidMagician, 'arcana'))
      .toBeGreaterThan(skillRuntimeBonus(druidWarden, 'arcana'));
    expect(skillRuntimeBonus(druidMagician, 'nature'))
      .toBeGreaterThan(skillRuntimeBonus(druidWarden, 'nature'));

    const styleKindsByCard = {
      'FEAT-0063': 'archery',
      'FEAT-0056': 'defense',
      'FEAT-0061': 'twoWeaponFighting',
      'FEAT-0055': 'protection',
    } as const;
    for (const cardNumber of FIGHTING_STYLE_CARDS) {
      const root = required(variants.get(`fighter-style:${cardNumber}`), cardNumber);
      const { finalSubject } = executeRoot(root, `fighter-style-${cardNumber}`);
      const pending = choice(root, 'fighter_fighting_style');
      const resolved = decision(root, 'fighter_fighting_style');
      const selected = required(
        catalogs.feats.find((feat) => feat.id === resolved.optionIds[0]),
        `${cardNumber}:selected style`,
      );
      const kind = styleKindsByCard[cardNumber];
      const pinned = MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind];
      const selectedEffect = required(root.assembled.effects.find((item) => (
        item.origin.kind === 'feat'
          && item.origin.id === selected.id
          && item.effect.id === pinned.effectEntityId
      )), `${cardNumber}:source-owned effect`);

      expect(pending).toMatchObject({
        count: 1, source: 'feat', filter: 'fighting_style', grantKind: 'grant_feat',
      });
      expect(resolved).toEqual({
        choiceId: pending.id,
        optionIds: [pinned.featEntityId],
        stage: 'creation', provenance: 'overlay-policy',
      });
      expect(selected).toMatchObject({
        id: pinned.featEntityId, card_number: pinned.featCardNumber, category: 'fighting_style',
      });
      expect(selectedEffect.effect).toMatchObject({
        id: pinned.effectEntityId, card_number: pinned.effectCardNumber,
      });
      if (kind === 'protection') {
        expect(finalSubject.capabilities.featureSources?.[PROTECTION_REACTION_CAPABILITY])
          .toEqual(pinned.sourceEntityIds);
        expect(finalSubject.passives?.some((passive) => passive.id === pinned.effectEntityId))
          .toBe(false);
      } else {
        expect(finalSubject.passives).toContainEqual(expect.objectContaining({
          id: pinned.effectCardNumber,
          sourceEntityIds: pinned.sourceEntityIds,
        }));
      }
    }

    const warlock = rootFor({
      classCard: CLASS_CARDS.warlock,
      speciesCard: SPECIES_CARDS.dwarf,
      backgroundCard: 'BG-0012',
      originFeatCard: 'FEAT-0005',
    });
    const { finalSubject: finalWarlock } = executeRoot(warlock, 'warlock-invocation-choice');
    const invocationChoice = choice(warlock, 'warlock_invocation_l1');
    const invocationDecision = decision(warlock, 'warlock_invocation_l1');
    expect(invocationChoice).toMatchObject({ count: 1, source: 'effect' });
    expect(invocationChoice.items?.map((item) => item.id)).toEqual(WARLOCK_INVOCATION_CARDS);
    expect(invocationDecision).toMatchObject({
      choiceId: invocationChoice.id,
      optionIds: [expect.stringMatching(/^EFF-/)],
      stage: 'creation', provenance: 'overlay-policy',
    });
    expect(WARLOCK_INVOCATION_CARDS).toContain(invocationDecision.optionIds[0]);
    const invocation = required(warlock.assembled.effects.find(({ effect }) => (
      effect.card_number === invocationDecision.optionIds[0]
    )), `${warlock.stableKey}:selected invocation`);
    expect(invocation.origin).toMatchObject({ kind: 'class', id: warlock.matrixCase.klass.id });
    expect(warlock.selectedInvocationEffectIds).toEqual([invocation.effect.id]);
    expect(finalWarlock.compiledSource.selectedInvocationEffectIds).toEqual([invocation.effect.id]);
  });

  it('runs skill, feat, and Expertise choice roots and proves exact legal grants with source ownership', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-SKILLS-FEATS-01' },
  }, () => {
    const elf = rootFor({ speciesCard: SPECIES_CARDS.elf, lineageCard: 'sub-drow' });
    const { finalSubject: finalElf } = executeRoot(elf, 'elf-keen-senses');
    const elfChoice = choice(elf, 'elf_skill');
    const elfDecision = decision(elf, 'elf_skill');
    expect(elfChoice).toMatchObject({
      count: 1,
      source: 'skill',
      filter: ['insight', 'perception', 'survival'],
      grantKind: 'grant_proficiency',
    });
    expect(elfDecision).toMatchObject({
      choiceId: elfChoice.id,
      optionIds: [expect.stringMatching(/^(insight|perception|survival)$/)],
      stage: 'creation', provenance: 'overlay-policy',
    });
    expect(elf.ruleState.proficiencies.skills).toContain(elfDecision.optionIds[0]);
    expect(elf.ruleState.appliedGrants).toContainEqual(expect.objectContaining({
      choiceId: elfChoice.id,
      kind: 'skill', value: elfDecision.optionIds[0], mode: 'proficiency',
      source: expect.objectContaining({ type: 'species' }),
    }));
    expect(finalElf.ruleState.proficiencies.skills).toContain(elfDecision.optionIds[0]);

    const skilled = rootFor({
      classCard: CLASS_CARDS.fighter,
      speciesCard: SPECIES_CARDS.dwarf,
      backgroundCard: 'BG-0012',
      originFeatCard: 'FEAT-0008',
    });
    executeRoot(skilled, 'feat-skilled');
    const skilledChoice = choice(skilled, 'feat_skilled');
    const skilledDecision = decision(skilled, 'feat_skilled');
    const skilledItems = (skilledChoice.options as JsonRecord | undefined)?.items as
      | Array<{ id: string }>
      | undefined;
    expect(skilledChoice).toMatchObject({
      count: 3, source: 'explicit', grantKind: 'grant_proficiency',
      options: { source: 'explicit', items: expect.any(Array) },
    });
    expect(skilledItems).toHaveLength(55);
    expect(skilledItems?.filter((item) => item.id.startsWith('skill:'))).toHaveLength(18);
    expect(skilledItems?.filter((item) => item.id.startsWith('tool:'))).toHaveLength(37);
    expect(skilledDecision).toMatchObject({
      choiceId: skilledChoice.id,
      optionIds: expect.any(Array),
      stage: 'creation', provenance: 'overlay-policy',
    });
    expect(skilledDecision.optionIds).toHaveLength(3);
    expect(new Set(skilledDecision.optionIds).size).toBe(3);
    expect(skilledDecision.optionIds.every((id) => skilledItems?.some((item) => item.id === id)))
      .toBe(true);
    const skilledGrants = skilled.ruleState.appliedGrants.filter((grant) => (
      grant.choiceId === skilledChoice.id
    ));
    expect(skilledGrants).toHaveLength(3);
    expect(skilledGrants.every((grant) => (
      grant.source.type === 'feat'
        && grant.source.id.includes(skilled.matrixCase.originFeat.id)
        && grant.mode === 'proficiency'
    ))).toBe(true);
    expect(skilledGrants.map((grant) => `${grant.kind}:${grant.value}`))
      .toEqual(skilledDecision.optionIds);

    const magicInitiate = rootFor({
      classCard: CLASS_CARDS.fighter,
      speciesCard: SPECIES_CARDS.dwarf,
      backgroundCard: 'BG-0012',
      originFeatCard: 'FEAT-0009',
    });
    const { finalSubject: finalMagicInitiate } = executeRoot(magicInitiate, 'magic-initiate-choices');
    const miCantripChoice = choice(magicInitiate, 'magic_initiate_wizard_cantrips');
    const miLevelChoice = choice(magicInitiate, 'magic_initiate_wizard_level_1');
    const miCantrips = decision(magicInitiate, 'magic_initiate_wizard_cantrips');
    const miLevel = decision(magicInitiate, 'magic_initiate_wizard_level_1');
    expect(miCantripChoice).toMatchObject({
      count: 2, source: 'spell', grantKind: 'grant_spell',
      options: { source: 'spell', filter: { classes: ['волшебник'], levels: [0] } },
    });
    expect(miLevelChoice).toMatchObject({
      count: 1, source: 'spell', grantKind: 'grant_spell',
      options: { source: 'spell', filter: { classes: ['волшебник'], levels: [1] } },
    });
    expect(miCantrips.optionIds).toHaveLength(2);
    expect(new Set(miCantrips.optionIds).size).toBe(2);
    expect(miLevel.optionIds).toHaveLength(1);
    const miSpells = [
      ...selectedSpells(magicInitiate, 'magic_initiate_wizard_cantrips'),
      ...selectedSpells(magicInitiate, 'magic_initiate_wizard_level_1'),
    ];
    expect(miSpells.map((spell) => spell.level)).toEqual([0, 0, 1]);
    expect(miSpells.every((spell) => spell.classes?.includes('волшебник'))).toBe(true);
    const miEffect = effectByCard(magicInitiate, 'magic_initiate_wizard');
    expect(miEffect.origin).toMatchObject({
      kind: 'feat', id: magicInitiate.matrixCase.originFeat.id,
    });
    for (const spell of miSpells) {
      const action = required(magicInitiate.rulesActions.find((candidate) => (
        candidate.kind === 'spell'
          && candidate.sourceEntityIds.includes(spell.id)
          && candidate.sourceEntityIds.includes(magicInitiate.matrixCase.originFeat.id)
          && candidate.sourceEntityIds.includes(miEffect.effect.id)
      )), `${magicInitiate.stableKey}:${spell.card_number}:Magic Initiate action`);
      const grant = required(magicInitiate.actor.spellcastingAccess?.grants.find((candidate) => (
        candidate.actionId === action.id && candidate.sourceId === 'FEAT-0009'
      )), `${magicInitiate.stableKey}:${spell.card_number}:Magic Initiate grant`);
      expect(grant).toMatchObject({
        access: spell.level === 0 ? 'cantrip' : 'always_prepared',
        level: spell.level,
        spellcastingAbility: 'int',
      });
      if (spell.level === 1) {
        expect(grant.freeUseResource).toEqual(expect.any(String));
        expect(magicInitiate.actor.runtime.maxResources[grant.freeUseResource!]).toBe(1);
      }
    }
    expect(magicInitiate.ruleState.appliedGrants.filter((grant) => (
      grant.source.type === 'feat' && grant.kind === 'spell'
    )).map((grant) => grant.choiceId)).toEqual([
      miCantrips.choiceId, miCantrips.choiceId, miLevel.choiceId,
    ]);
    expect(finalMagicInitiate.spellcastingAccess).toEqual(magicInitiate.actor.spellcastingAccess);

    const rogue = rootFor({
      classCard: CLASS_CARDS.rogue,
      speciesCard: SPECIES_CARDS.dwarf,
      backgroundCard: 'BG-0012',
      originFeatCard: 'FEAT-0005',
    });
    const { finalSubject: finalRogue } = executeRoot(rogue, 'rogue-expertise');
    const expertiseChoice = choice(rogue, 'rogue_expertise_l1');
    const expertiseDecision = decision(rogue, 'rogue_expertise_l1');
    expect(expertiseChoice).toMatchObject({
      count: 2, source: 'skill', filter: 'proficient', grantKind: 'grant_proficiency',
    });
    expect(expertiseDecision).toMatchObject({
      choiceId: expertiseChoice.id,
      optionIds: expect.any(Array), stage: 'creation', provenance: 'overlay-policy',
    });
    expect(expertiseDecision.optionIds).toHaveLength(2);
    expect(new Set(expertiseDecision.optionIds).size).toBe(2);
    expect(expertiseDecision.optionIds.every((skill) => (
      rogue.ruleState.proficiencies.skills.includes(skill)
        && rogue.ruleState.expertise.skills.includes(skill)
    ))).toBe(true);
    expect(rogue.ruleState.appliedGrants.filter((grant) => (
      grant.choiceId === expertiseChoice.id
    )).every((grant) => (
      grant.source.type === 'class' && grant.kind === 'skill' && grant.mode === 'expertise'
    ))).toBe(true);
    expect(finalRogue.ruleState.expertise.skills)
      .toEqual(expect.arrayContaining(expertiseDecision.optionIds));
  });

  it('runs Fighter and Rogue mastery roots and proves qualified selections and executable bindings', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-WEAPON-MASTERY-01' },
  }, () => {
    const specs = [
      { classCard: CLASS_CARDS.fighter, weapons: ['longsword', 'longbow', 'greatsword'] },
      { classCard: CLASS_CARDS.rogue, weapons: ['dagger', 'shortbow'] },
    ] as const;
    for (const spec of specs) {
      const root = rootFor({
        classCard: spec.classCard,
        speciesCard: SPECIES_CARDS.dwarf,
        backgroundCard: 'BG-0012',
        originFeatCard: 'FEAT-0005',
      });
      const { finalSubject } = executeRoot(root, `mastery-${spec.classCard}`);
      const masteryChoice = choice(root, 'weapon-mastery');
      const masteryDecision = decision(root, 'weapon-mastery');
      expect(masteryChoice).toMatchObject({
        count: spec.weapons.length,
        source: 'weapon',
        context: 'in_play',
        grantKind: 'weapon_mastery',
      });
      expect(masteryDecision).toMatchObject({
        choiceId: masteryChoice.id,
        optionIds: expect.any(Array),
        stage: 'rest', provenance: 'overlay-policy',
      });
      expect(new Set(masteryDecision.optionIds)).toEqual(new Set(spec.weapons));
      expect(new Set(root.actor.character.weaponMasteries ?? [])).toEqual(new Set(spec.weapons));
      expect(new Set(finalSubject.character.weaponMasteries ?? [])).toEqual(new Set(spec.weapons));

      const expectedEffectIds = new Set<string>();
      for (const weaponType of spec.weapons) {
        const masteryId = required(WEAPON_MASTERY_BINDINGS[weaponType], weaponType);
        expectedEffectIds.add(masteryId);
        const canonical = required(
          catalogs.effects.find((effect) => effect.id === masteryId),
          `${weaponType}:${masteryId}`,
        );
        expect(catalogs.cards.some((card) => (
          card.type === 'weapon'
            && card.weapon_type === weaponType
            && card.mastery === masteryId
        ))).toBe(true);
        expect(root.actor.masteryEffects?.[masteryId]).toMatchObject({
          name: canonical.name,
          mechanics: canonical.mechanics,
          weaponTypes: [weaponType],
          sourceEntityIds: expect.arrayContaining([
            root.matrixCase.klass.id,
            root.matrixCase.klass.card_number,
            required(masteryChoice.origin.featureId, `${weaponType}:featureId`),
            canonical.id,
            canonical.card_number,
          ]),
        });
        expect(finalSubject.masteryEffects?.[masteryId])
          .toEqual(root.actor.masteryEffects?.[masteryId]);
      }
      expect(new Set(Object.keys(root.actor.masteryEffects ?? {}))).toEqual(expectedEffectIds);
    }
  });

  it('runs all ten Dragonborn ancestries and proves matching Breath Weapon, resistance, uses, and no flight leakage', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-DRAGONBORN-LINEAGES-01' },
  }, () => {
    for (const [lineage, expected] of Object.entries(DRAGONBORN_LINEAGES)) {
      const root = rootFor({
        speciesCard: SPECIES_CARDS.dragonborn,
        lineageCard: expected.card,
      });
      const { finalSubject } = executeRoot(root, `dragonborn-${lineage}`);
      const subrace = required(root.assembled.subrace ?? undefined, `${lineage}:subrace`);
      const breathId = required(subrace.related_actions?.[0], `${lineage}:breath id`);
      const resistanceId = required(subrace.related_effects?.[0], `${lineage}:resistance id`);
      const breath = required(
        root.assembled.actions.find((item) => item.action.id === breathId)?.action,
        `${lineage}:breath action`,
      );
      const resistance = required(
        root.assembled.effects.find((item) => item.effect.id === resistanceId)?.effect,
        `${lineage}:resistance effect`,
      );
      const compiledBreath = required(root.rulesActions.find((action) => (
        action.kind === 'nonSpell' && action.sourceEntityIds.includes(breathId)
      )), `${lineage}:compiled breath`);
      const breathMechanics = rawRecord(breath.mechanics);
      const save = required(
        (breathMechanics.effects as JsonRecord[] | undefined)?.[0],
        `${lineage}:save mechanics`,
      );
      const target = rawRecord(breathMechanics.targeting);

      expect(root.speciesAudit).toMatchObject({
        lineageId: subrace.id,
        lineageCardNumber: expected.card,
        l1ActionIds: expect.arrayContaining([breathId]),
        l1EffectIds: expect.arrayContaining([resistanceId]),
      });
      expect(root.decisions).toContainEqual({
        choiceId: `species:${root.matrixCase.species.id}:lineage`,
        optionIds: [subrace.id],
        stage: 'creation', provenance: 'overlay-policy',
      });
      expect(save).toMatchObject({
        resolution: 'save', who: 'target', ability: 'dex', dc: '8+prof+con',
        on_fail: [expect.objectContaining({ kind: 'damage', dice: '1d10', type: expected.damage })],
        on_success: [expect.objectContaining({
          kind: 'damage', dice: '1d10', type: expected.damage, on_success: 'half',
        })],
      });
      expect(target).toMatchObject({
        shape: 'area', area: { kind: 'cone', size_ft: 15 },
      });
      expect(breathMechanics.uses).toEqual({ count: 'prof_bonus', per: 'long_rest' });
      expect(payloadsOf(resistance.mechanics)).toContainEqual(expect.objectContaining({
        kind: 'resistance', damage_type: expected.damage, value: 'resistance',
      }));
      expect(root.actor.capabilities.actionIds).toContain(compiledBreath.id);
      expect(root.actor.runtime.maxResources[actionUsesKey(breath.card_number)]).toBe(2);
      expect(root.actor.passives?.some((passive) => (
        Array.isArray(passive.sourceEntityIds) && passive.sourceEntityIds.includes(resistanceId)
          && payloadsOf(passive).some((payload) => (
            payload.kind === 'resistance' && payload.damage_type === expected.damage
          ))
      ))).toBe(true);
      expect(root.assembled.effects.map(({ effect }) => effect.card_number))
        .not.toContain('RE-dragonborn-4');
      expect(root.actor.capabilities.actionIds)
        .not.toContain('fe0ac34d-719c-487c-86bd-4d71ed4390da');
      expect(finalSubject.compiledSource.entities.lineage).toEqual({
        id: subrace.id, cardNumber: expected.card,
      });
      expect(finalSubject.capabilities.actionIds).toContain(compiledBreath.id);
      expect(finalSubject.runtime.maxResources[actionUsesKey(breath.card_number)]).toBe(2);
    }
  });

  it('runs all three Elf lineages and proves level-1 grants, source ability, and no level-3 or level-5 leakage', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BUILD-ELF-LINEAGES-01' },
  }, () => {
    for (const [lineage, expected] of Object.entries(ELF_LINEAGES)) {
      const root = rootFor({ speciesCard: SPECIES_CARDS.elf, lineageCard: expected.card });
      const { finalSubject } = executeRoot(root, `elf-lineage-${lineage}`);
      const subrace = required(root.assembled.subrace ?? undefined, `${lineage}:subrace`);
      const lineageEffectId = required(subrace.related_effects?.[0], `${lineage}:effect id`);
      const lineageEffect = required(
        root.assembled.effects.find((item) => item.effect.id === lineageEffectId)?.effect,
        `${lineage}:effect`,
      );
      const grants = payloadsOf(lineageEffect.mechanics).filter((payload) => (
        payload.kind === 'grant_spell'
      ));
      const l1Grants = grants.filter((payload) => Number(payload.level_gate ?? 1) === 1);
      const higherGrants = grants.filter((payload) => Number(payload.level_gate ?? 1) > 1);
      const l1Spell = required(
        catalogs.spells.find((spell) => spell.card_number === expected.l1),
        `${lineage}:${expected.l1}`,
      );
      const compiledAction = required(root.rulesActions.find((action) => (
        action.kind === 'spell'
          && action.sourceEntityIds.includes(l1Spell.id)
          && action.sourceEntityIds.includes(subrace.id)
      )), `${lineage}:compiled L1 spell action`);
      const spellGrant = required(root.actor.spellcastingAccess?.grants.find((grant) => (
        grant.actionId === compiledAction.id && grant.sourceId === subrace.id
      )), `${lineage}:source-owned spell grant`);
      const abilityChoice = choice(root, 'elf_lineage_spellcasting_ability');
      const abilityDecision = decision(root, 'elf_lineage_spellcasting_ability');

      expect(root.speciesAudit).toMatchObject({
        lineageId: subrace.id,
        lineageCardNumber: expected.card,
        l1EffectIds: expect.arrayContaining([lineageEffectId]),
        l1SpellRefs: [expected.l1],
        excludedHigherLevelSpellRefs: expected.higher,
      });
      expect(l1Grants).toEqual([expect.objectContaining({
        kind: 'grant_spell', value: expected.l1, level_gate: 1,
      })]);
      expect(higherGrants.map((grant) => grant.value).sort()).toEqual(expected.higher);
      expect(abilityChoice).toMatchObject({
        count: 1,
        source: 'ability',
        items: [
          { id: 'int', name: 'INT' },
          { id: 'wis', name: 'WIS' },
          { id: 'cha', name: 'CHA' },
        ],
        origin: { id: subrace.id },
      });
      expect(abilityDecision).toEqual({
        choiceId: abilityChoice.id,
        optionIds: [root.speciesAudit.lineageSpellcastingAbility],
        stage: 'creation', provenance: 'overlay-policy',
      });
      expect(spellGrant).toMatchObject({
        sourceId: subrace.id,
        level: 0,
        access: 'cantrip',
        spellcastingAbility: root.speciesAudit.lineageSpellcastingAbility,
      });
      expect(root.assembled.spells.map((spell) => spell.id)).toContain(l1Spell.id);
      for (const higherCard of expected.higher) {
        const higher = required(
          catalogs.spells.find((spell) => spell.card_number === higherCard),
          `${lineage}:${higherCard}`,
        );
        expect(root.assembled.spells.map((spell) => spell.id)).not.toContain(higher.id);
        expect(root.rulesActions.some((action) => action.sourceEntityIds.includes(higher.id))).toBe(false);
        expect(root.actor.spellcastingAccess?.grants.some((grant) => (
          grant.sourceId === subrace.id && grant.actionId.includes(higher.id)
        ))).toBe(false);
      }
      expect(finalSubject.compiledSource.entities.lineage).toEqual({
        id: subrace.id, cardNumber: expected.card,
      });
      expect(finalSubject.capabilities.actionIds).toContain(compiledAction.id);
      expect(finalSubject.spellcastingAccess?.grants).toContainEqual(spellGrant);
    }
  });
});
