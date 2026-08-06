import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import {
  canonicalStringify,
} from './determinism';
import type {
  ActionWorldInput,
  RuleActionDefinition,
} from './domain';
import {
  replacePreparedSpells,
  resolveSpellAccess,
  type SpellGrantAccess,
} from './spellcastingAccess';
import { COMPILED_WORLD_SPELL_SCENARIO_EVIDENCE } from './compiledWorldSpellScenarios';
import {
  compileMicroMvpAcceptanceCorpus,
  createCompiledMicroMvpAcceptanceCaseForRoot,
  type CompiledMicroMvpAcceptanceCorpus,
} from './testing/compiledMicroMvpAcceptanceCorpus';
import {
  type ScenarioAssertion,
  type ScenarioRun,
  type ScenarioSpec,
  type ScenarioStep,
} from './testing/scenario';
import { runCompiledRuntimeScenario } from './testing/compiledMicroMvpSpeciesFeatStyleRuntime';
import type { WorldObjectState } from './worldObjects';

type CompiledSpell = Extract<RuleActionDefinition, { kind: 'spell' }>;

interface PreparedSpell {
  action: CompiledSpell;
  grant: SpellGrantAccess;
}

interface ScenarioExtensionContext {
  id: string;
  action: CompiledSpell;
  grant: SpellGrantAccess;
  castStep: number;
  castCommandId: string;
}

interface WorldScenarioInput {
  label: string;
  root: CompiledMicroMvpL1Root;
  spellCardNumber: string;
  objects?: readonly WorldObjectState[];
  worldInput?: ActionWorldInput;
  spellMode?: 'normal' | 'ritual';
  /** Long casts execute before the shared encounter chronology begins. */
  castInExploration?: boolean;
  afterCast?: (context: ScenarioExtensionContext) => ScenarioStep[];
}

let corpus: CompiledMicroMvpAcceptanceCorpus;
let wizard: CompiledMicroMvpL1Root;
let druid: CompiledMicroMvpL1Root;
let cleric: CompiledMicroMvpL1Root;
let scenarioIndex = 0;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled world scenario fixture: ${label}`);
  return value;
}

function cardId(cardNumber: string): string {
  return required(
    readProdSnapshotCatalogs().spells.find((spell) => spell.card_number === cardNumber),
    `spell card ${cardNumber}`,
  ).id;
}

function rootByClass(classCardNumber: string): CompiledMicroMvpL1Root {
  return required(corpus.compiled.roots.find((root) => (
    root.matrixCase.klass.card_number === classCardNumber
      && root.matrixCase.species.card_number === 'RACE-0003'
  )), classCardNumber);
}

function preparedSpell(root: CompiledMicroMvpL1Root, cardNumber: string): PreparedSpell {
  const entity = required(
    root.assembled.spells.find((spell) => spell.card_number === cardNumber),
    `${root.stableKey}:${cardNumber}:entity`,
  );
  const action = required(root.rulesActions.find((candidate): candidate is CompiledSpell => (
    candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id)
  )), `${root.stableKey}:${cardNumber}:action`);
  const grant = required(root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.actionId === action.id
  )), `${root.stableKey}:${cardNumber}:grant`);
  return { action, grant };
}

function eventAssertion(
  id: string,
  payloadSubset: Record<string, unknown>,
): ScenarioAssertion {
  return {
    id,
    type: 'event',
    match: { payloadType: 'ActionDeclared', sourceActorId: 'subject', payloadSubset },
    exactly: 1,
  };
}

function startTurnStep(id: string, suffix: string, actor: 'subject' | 'support'): ScenarioStep {
  return {
    do: 'startTurn', actor,
    assertions: [{
      id: `${id}:${suffix}:START`, type: 'event', eventType: 'turn_started', exactly: 1,
    }],
  };
}

function endTurnStep(id: string, suffix: string, actor: 'subject' | 'support'): ScenarioStep {
  return {
    do: 'endTurn', actor,
    assertions: [{
      id: `${id}:${suffix}:END`, type: 'event', eventType: 'turn_ended', exactly: 1,
    }],
  };
}

function checkpointStep(id: string, suffix: string, path: string, value: unknown): ScenarioStep {
  return {
    do: 'checkpointReload',
    assertions: [{ id: `${id}:${suffix}:CHECKPOINT`, type: 'equals', path, value }],
  };
}

function runWorldScenario(input: WorldScenarioInput): ScenarioRun & {
  castCommandId: string;
  action: CompiledSpell;
  grant: SpellGrantAccess;
} {
  const prepared = preparedSpell(input.root, input.spellCardNumber);
  const base = createCompiledMicroMvpAcceptanceCaseForRoot(corpus, input.root, {
    index: scenarioIndex,
    idPrefix: `compiled-world-${input.label}`,
  });
  scenarioIndex += 1;
  const castStep = input.castInExploration ? 1 : base.spec.steps.length + 2;
  const castCommandId = `${base.id}:step:${castStep}`;
  const context: ScenarioExtensionContext = {
    id: base.id,
    action: prepared.action,
    grant: prepared.grant,
    castStep,
    castCommandId,
  };
  const spellMode = input.spellMode ?? 'normal';
  const cast: ScenarioStep = {
      do: 'use', actor: 'subject', actionId: prepared.action.id, actionKind: 'spell',
      targets: [], factsByTarget: {},
      spell: {
        baseLevel: prepared.action.spell.level,
        grantId: prepared.grant.grantId,
        mode: spellMode,
      },
      worldInput: input.worldInput,
      assertions: [eventAssertion(`${base.id}:ACTUAL-COMPILED-SPELL`, {
        actionId: prepared.action.id,
        actionKind: 'spell',
        spell: {
          grantId: prepared.grant.grantId,
          sourceId: prepared.grant.sourceId,
          spellcastingAbility: prepared.grant.spellcastingAbility,
          mode: spellMode,
        },
      })],
    };
  const actualSteps: ScenarioStep[] = input.castInExploration
    ? [
      cast,
      ...(input.afterCast?.(context) ?? []),
      {
        do: 'startEncounter',
        actor: 'subject',
        assertions: [{
          id: `${base.id}:EXPLORATION-TO-ENCOUNTER`,
          type: 'equals',
          path: 'scene.mode',
          value: 'encounter',
        }],
      },
      ...base.spec.steps,
    ]
    : [
      ...base.spec.steps,
      startTurnStep(base.id, 'ACTUAL-SUBJECT', 'subject'),
      cast,
      ...(input.afterCast?.(context) ?? []),
    ];
  const spec: ScenarioSpec = {
    ...base.spec,
    ...(input.castInExploration ? { autoStartEncounter: false } : {}),
    objects: input.objects ? JSON.parse(JSON.stringify(input.objects)) as WorldObjectState[] : [],
    steps: actualSteps,
  };
  const run = runCompiledRuntimeScenario({
    foundation: {
      acceptance: base,
      root: input.root,
      spec: base.spec,
      provider: base.provider,
    },
    spec,
  });
  expect(Object.keys(run.initialState.actors)).toEqual(['subject', 'support']);
  expect(run.initialState.actors.subject.kind).toBe('playerCharacter');
  expect(run.initialState.actors.support.kind).toBe('playerCharacter');
  expect(base.subject.fixtureId).not.toBe(base.support.fixtureId);
  expect(run.rejections).toEqual([]);
  expect(run.checkpoints.length).toBeGreaterThanOrEqual(2);
  expect(canonicalStringify(run.finalState)).toBe(canonicalStringify(run.replayState));
  expect(run.observedTrace).toEqual([
    'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
  ]);
  return { ...run, castCommandId, ...prepared };
}

const BASE_OBJECTS: readonly WorldObjectState[] = [
  {
    id: 'rope', name: 'Torn rope', kind: 'item', size: 'tiny',
    breakOrTear: { maxDimensionFt: 0.5, repaired: false },
  },
  {
    id: 'flower', name: 'Closed flower', kind: 'environment', size: 'tiny',
    plant: { kind: 'flower', bloomed: false },
  },
  { id: 'torch', name: 'Torch', kind: 'item', size: 'tiny' },
  { id: 'stone', name: 'Stone', kind: 'environment', size: 'small' },
  {
    id: 'rune', name: 'Abjuration rune', kind: 'spell_effect', size: 'small',
    magicalAura: { school: 'abjuration', createdBySpell: true, visible: true },
  },
  {
    id: 'lead-box', name: 'Lead box', kind: 'item', size: 'small',
    magicalAura: { school: 'illusion', createdBySpell: true, visible: true },
  },
  {
    id: 'venom', name: 'Wyvern venom', kind: 'item', size: 'tiny',
    hazardousSubstance: { kind: 'poison', specificKind: 'wyvern venom' },
  },
  {
    id: 'stew', name: 'Spoiled stew', kind: 'item', size: 'small',
    foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
  },
  {
    id: 'magic-wine', name: 'Magic wine', kind: 'item', size: 'tiny',
    foodOrDrink: { kind: 'drink', magical: true, poisoned: true, rotten: true },
  },
];

describe('compiled PHB 2024 world spells in mandatory two-PC scenarios', () => {
  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled world scenario tests');
    };
    try {
      corpus = await compileMicroMvpAcceptanceCorpus();
      const wizardBase = rootByClass('CLASS-wizard');
      const druidBase = rootByClass('CLASS-druid');
      const clericBase = rootByClass('CLASS-cleric');
      const variants = await compileMicroMvpL1ChoiceVariants([
        {
          stableKey: wizardBase.stableKey,
          overrides: {
            wizard_cantrips: ['dancing_lights', 'mending', 'prestidigitation'].map(cardId),
            wizard_spellbook_level_1: [
              'detect_magic', 'SPELL-0174', 'SPELL-0242', 'SPELL-0317', 'SPELL-0190', 'SPELL-0171',
            ].map(cardId),
          },
        },
        {
          stableKey: druidBase.stableKey,
          overrides: { druid_cantrips: ['druidcraft', 'poison_spray'].map(cardId) },
        },
        {
          stableKey: clericBase.stableKey,
          overrides: {
            cleric_cantrips: ['light', 'mending', 'SPELL-0286'].map(cardId),
            cleric_spells_l1: ['SPELL-0214', 'SPELL-0163', 'SPELL-0236', 'SPELL-0252'].map(cardId),
          },
        },
      ]);
      [wizard, druid, cleric] = variants;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('exports only unique evidence links owned by the executable scenarios below', () => {
    const links: Array<{ entityId: string; obligationId: string }> = [];
    for (const item of COMPILED_WORLD_SPELL_SCENARIO_EVIDENCE) links.push(...item.links);
    expect(links).toHaveLength(12);
    expect(new Set(links.map((item) => `${item.entityId}:${item.obligationId}`)).size).toBe(12);
  });

  it('casts compiled Dancing Lights, moves the linked lights, and preserves exact concentration through reload', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-DANCING-LIGHTS-01' },
  }, () => {
    const run = runWorldScenario({
      label: 'dancing-lights', root: wizard, spellCardNumber: 'dancing_lights',
      objects: BASE_OBJECTS,
      worldInput: {
        type: 'dancing_lights', form: 'individual',
        facts: { factsSource: 'board', boardRevision: 21, distanceFt: 45, lineOfSight: true },
        placements: [
          { distanceFromCasterFt: 30, withinRequiredSeparation: true },
          { distanceFromCasterFt: 45, withinRequiredSeparation: true },
        ],
      },
      afterCast: ({ id, castCommandId }) => {
        const groupId = `${castCommandId}:id:1`;
        const first = `${castCommandId}:id:2`;
        const second = `${castCommandId}:id:3`;
        return [
          {
            do: 'moveDancingLights', actor: 'subject', groupId,
            factsSource: 'board', boardRevision: 22,
            resultingFacts: [
              { lightId: first, movementFt: 30, distanceFromCasterFt: 60, withinRequiredSeparation: true },
              { lightId: second, movementFt: 60, distanceFromCasterFt: 130, withinRequiredSeparation: true },
            ],
            assertions: [{
              id: `${id}:DANCING-MOVED`, type: 'equals',
              path: `objects.${first}.distanceFromSourceFt`, value: 60,
            }],
          },
          checkpointStep(
            id, 'DANCING', `concentrations.subject.id`, `${castCommandId}:concentration`,
          ),
          endTurnStep(id, 'ACTUAL-SUBJECT', 'subject'),
        ];
      },
    });
    expect(run.finalState.objects[`${run.castCommandId}:id:2`]?.distanceFromSourceFt).toBe(60);
    expect(run.finalState.objects[`${run.castCommandId}:id:3`]).toBeUndefined();
    expect(run.finalState.concentrations.subject).toMatchObject({ actionId: run.action.id });
  });

  it('casts compiled Druidcraft and mutates only the explicit legal plant target', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-DRUIDCRAFT-01' },
  }, () => {
    const run = runWorldScenario({
      label: 'druidcraft', root: druid, spellCardNumber: 'druidcraft', objects: BASE_OBJECTS,
      worldInput: {
        type: 'druidcraft',
        option: {
          kind: 'bloom', objectId: 'flower',
          facts: { factsSource: 'board', boardRevision: 23, distanceFt: 30, lineOfSight: true },
        },
      },
      afterCast: ({ id }) => [
        checkpointStep(id, 'DRUIDCRAFT', 'objects.flower.plant.bloomed', true),
        endTurnStep(id, 'ACTUAL-SUBJECT', 'subject'),
      ],
    });
    expect(run.finalState.objects.flower.plant?.bloomed).toBe(true);
    expect(run.finalState.objects.rope.breakOrTear?.repaired).toBe(false);
  });

  it('casts compiled Mending and repairs the explicit touched break through replay', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-MENDING-01' },
  }, () => {
    const run = runWorldScenario({
      label: 'mending', root: wizard, spellCardNumber: 'mending', objects: BASE_OBJECTS,
      castInExploration: true,
      worldInput: {
        type: 'mending', objectId: 'rope',
        facts: {
          factsSource: 'gm_ruling', boardRevision: 24,
          distanceFt: 0, lineOfSight: true, touched: true,
        },
      },
      afterCast: ({ id }) => [
        checkpointStep(id, 'MENDING', 'objects.rope.breakOrTear.repaired', true),
      ],
    });
    expect(run.finalState.objects.rope.breakOrTear).toEqual({
      maxDimensionFt: 0.5, repaired: true,
    });
  });

  it('casts compiled Prestidigitation and expires its creation at the exact source-turn boundary', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-PRESTIDIGITATION-01' },
  }, () => {
    let creationId = '';
    const run = runWorldScenario({
      label: 'prestidigitation', root: wizard, spellCardNumber: 'prestidigitation',
      objects: BASE_OBJECTS,
      worldInput: {
        type: 'prestidigitation',
        option: {
          kind: 'minor_creation', description: 'Tiny brass key', size: 'tiny', fitsInHand: true,
          facts: { factsSource: 'scenario', boardRevision: 25, distanceFt: 5, lineOfSight: true },
        },
      },
      afterCast: ({ id, castCommandId }) => {
        creationId = `${castCommandId}:id:1`;
        return [
          checkpointStep(id, 'PRESTIDIGITATION-CREATED', `objects.${creationId}.sourceTurnEndingsLeft`, 2),
          endTurnStep(id, 'ACTUAL-SUBJECT-ONE', 'subject'),
          startTurnStep(id, 'ACTUAL-SUPPORT-TWO', 'support'),
          endTurnStep(id, 'ACTUAL-SUPPORT-TWO', 'support'),
          startTurnStep(id, 'ACTUAL-SUBJECT-TWO', 'subject'),
          endTurnStep(id, 'ACTUAL-SUBJECT-TWO', 'subject'),
        ];
      },
    });
    expect(run.finalState.objects[creationId]).toBeUndefined();
    expect(run.events.some((entry) => (
      entry.payload.type === 'WorldObjectMutationRecorded'
        && entry.payload.event.type === 'WorldObjectRemoved'
        && entry.payload.event.objectId === creationId
        && entry.payload.event.reason === 'source_turn_end_expired'
    ))).toBe(true);
  });

  it('casts compiled Light twice and replaces only the caster previous illumination', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-LIGHT-01' },
  }, () => {
    const run = runWorldScenario({
      label: 'light', root: cleric, spellCardNumber: 'light', objects: BASE_OBJECTS,
      worldInput: {
        type: 'target_object', objectId: 'torch',
        facts: {
          factsSource: 'board', boardRevision: 26,
          distanceFt: 0, lineOfSight: true, touched: true,
        },
      },
      afterCast: ({ id, action, grant }) => [
        checkpointStep(id, 'LIGHT-FIRST', 'objects.torch.illumination.roundsLeft', 600),
        endTurnStep(id, 'ACTUAL-SUBJECT-ONE', 'subject'),
        startTurnStep(id, 'ACTUAL-SUPPORT-TWO', 'support'),
        endTurnStep(id, 'ACTUAL-SUPPORT-TWO', 'support'),
        startTurnStep(id, 'ACTUAL-SUBJECT-TWO', 'subject'),
        {
          do: 'use', actor: 'subject', actionId: action.id, actionKind: 'spell',
          targets: [], factsByTarget: {}, spell: { baseLevel: 0, grantId: grant.grantId },
          worldInput: {
            type: 'target_object', objectId: 'stone',
            facts: {
              factsSource: 'board', boardRevision: 27,
              distanceFt: 0, lineOfSight: true, touched: true,
            },
          },
          assertions: [{
            id: `${id}:LIGHT-RECAST`, type: 'equals',
            path: 'objects.stone.illumination.roundsLeft', value: 600,
          }],
        },
        checkpointStep(id, 'LIGHT-SECOND', 'objects.stone.illumination.brightRadiusFt', 20),
        endTurnStep(id, 'ACTUAL-SUBJECT-TWO', 'subject'),
      ],
    });
    expect(run.finalState.objects.torch.illumination).toBeUndefined();
    expect(run.finalState.objects.stone.illumination).toMatchObject({
      brightRadiusFt: 20, dimAdditionalRadiusFt: 20, sourceActorId: 'subject',
    });
  });

  it('casts compiled Detect Magic with a source-owned slot and reveals only an unblocked visible aura on a later turn', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-DETECT-MAGIC-01' },
  }, () => {
    const detect = preparedSpell(wizard, 'detect_magic');
    const access = required(wizard.actor.spellcastingAccess, 'Wizard spellcasting access');
    const preparedSource = required(
      access.preparedSources[detect.grant.sourceId],
      'Wizard prepared-spell source',
    );
    expect(preparedSource.preparedActionIds).toContain(detect.action.id);
    const withoutDetect = preparedSource.availableActionIds
      .filter((actionId) => actionId !== detect.action.id)
      .slice(0, preparedSource.capacity);
    const unprepared = replacePreparedSpells(access, detect.grant.sourceId, withoutDetect);
    if ('status' in unprepared) throw new Error(unprepared.message);
    expect(resolveSpellAccess({
      state: unprepared,
      actionId: detect.action.id,
      grantId: detect.grant.grantId,
      mode: 'normal',
      resources: wizard.actor.runtime.resources,
    })).toMatchObject({ status: 'rejected', code: 'SpellNotPrepared' });
    expect(resolveSpellAccess({
      state: unprepared,
      actionId: detect.action.id,
      grantId: detect.grant.grantId,
      mode: 'ritual',
      resources: { spell_slot_1: 0 },
    })).toMatchObject({
      status: 'allowed',
      grant: { sourceId: 'CLASS-wizard', access: 'spellbook', ritual: true },
      payment: { kind: 'none' },
    });
    const restCapabilityId = wizard.rulesActions.find((action) => action.restDecision)
      ?.restDecision?.capabilityId;
    if (!restCapabilityId) throw new Error('Wizard root has no compiled rest decision');
    expect(wizard.actor.capabilities.featureSources?.[restCapabilityId])
      .toEqual(expect.arrayContaining([wizard.matrixCase.klass.id]));
    const run = runWorldScenario({
      label: 'detect-magic', root: wizard, spellCardNumber: 'detect_magic',
      objects: BASE_OBJECTS,
      afterCast: ({ id, castCommandId }) => [
        checkpointStep(id, 'DETECT-MAGIC', 'concentrations.subject.id', `${castCommandId}:concentration`),
        endTurnStep(id, 'ACTUAL-SUBJECT-ONE', 'subject'),
        startTurnStep(id, 'ACTUAL-SUPPORT-TWO', 'support'),
        endTurnStep(id, 'ACTUAL-SUPPORT-TWO', 'support'),
        startTurnStep(id, 'ACTUAL-SUBJECT-TWO', 'subject'),
        {
          do: 'revealMagicAura', actor: 'subject',
          observations: {
            rune: {
              facts: {
                factsSource: 'board', boardRevision: 28,
                distanceFt: 30, lineOfSight: true,
              },
              blockingLayers: [],
            },
            'lead-box': {
              facts: {
                factsSource: 'board', boardRevision: 28,
                distanceFt: 10, lineOfSight: true,
              },
              blockingLayers: [{ material: 'lead', thicknessInches: 0.01 }],
            },
          },
          assertions: [{
            id: `${id}:DETECT-MAGIC-OBSERVED`, type: 'event',
            match: {
              payloadType: 'WorldObjectMutationRecorded', sourceActorId: 'subject',
              payloadSubset: {
                event: {
                  type: 'WorldObjectObserved', objectId: 'rune', actorId: 'subject',
                  observation: 'detect_magic_aura',
                  details: { sensed: true, auraVisible: true, school: 'abjuration' },
                },
              },
            },
            exactly: 1,
          }],
        },
        checkpointStep(id, 'DETECT-MAGIC-AFTER-OBSERVATION', 'actors.subject.runtime.resources.action', 0),
        endTurnStep(id, 'ACTUAL-SUBJECT-TWO', 'subject'),
      ],
    });
    const observations = run.events.flatMap((entry) => (
      entry.payload.type === 'WorldObjectMutationRecorded'
        && entry.payload.event.type === 'WorldObjectObserved'
        ? [entry.payload.event]
        : []
    ));
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectId: 'rune',
        details: expect.objectContaining({ sensed: true, auraVisible: true, school: 'abjuration' }),
      }),
      expect.objectContaining({
        objectId: 'lead-box',
        details: expect.objectContaining({ sensed: false, auraVisible: false }),
      }),
    ]));
  });

  it('casts compiled Detect Poison and Disease with a source-owned slot and records its exact sensed poison fact', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-DETECT-POISON-01' },
  }, () => {
    const run = runWorldScenario({
      label: 'detect-poison', root: cleric, spellCardNumber: 'SPELL-0236',
      objects: BASE_OBJECTS,
      afterCast: ({ id, castCommandId }) => [
        {
          do: 'observePoisonDisease', actor: 'subject',
          observations: {
            venom: {
              facts: {
                factsSource: 'board', boardRevision: 29,
                distanceFt: 30, lineOfSight: false,
              },
              blockingLayers: [],
            },
          },
          assertions: [{
            id: `${id}:DETECT-POISON-OBSERVED`, type: 'event',
            match: {
              payloadType: 'WorldObjectMutationRecorded', sourceActorId: 'subject',
              payloadSubset: {
                event: {
                  type: 'WorldObjectObserved', objectId: 'venom', actorId: 'subject',
                  observation: 'detect_poison_and_disease',
                  details: {
                    sensed: true, locationKnown: true, kind: 'wyvern venom',
                    concentrationId: `${castCommandId}:concentration`,
                  },
                },
              },
            },
            exactly: 1,
          }],
        },
        checkpointStep(id, 'DETECT-POISON', 'concentrations.subject.id', `${castCommandId}:concentration`),
        endTurnStep(id, 'ACTUAL-SUBJECT', 'subject'),
      ],
    });
    expect(run.finalState.concentrations.subject).toMatchObject({ actionId: run.action.id });
  });

  it('casts compiled Purify Food and Drink with a source-owned slot and changes only nonmagical food in its sphere', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WORLD-PURIFY-01' },
  }, () => {
    const run = runWorldScenario({
      label: 'purify', root: cleric, spellCardNumber: 'SPELL-0252',
      objects: BASE_OBJECTS,
      worldInput: {
        type: 'purify_food_drink', sphereCenterDistanceFt: 10,
        factsByObject: {
          stew: {
            factsSource: 'board', boardRevision: 30,
            distanceFt: 10, lineOfSight: true, inArea: true,
          },
          'magic-wine': {
            factsSource: 'board', boardRevision: 30,
            distanceFt: 10, lineOfSight: true, inArea: true,
          },
        },
      },
      afterCast: ({ id }) => [
        checkpointStep(id, 'PURIFY', 'objects.stew.foodOrDrink.poisoned', false),
        endTurnStep(id, 'ACTUAL-SUBJECT', 'subject'),
      ],
    });
    expect(run.finalState.objects.stew.foodOrDrink).toMatchObject({ poisoned: false, rotten: false });
    expect(run.finalState.objects['magic-wine'].foodOrDrink).toMatchObject({
      poisoned: true, rotten: true, magical: true,
    });
  });
});
