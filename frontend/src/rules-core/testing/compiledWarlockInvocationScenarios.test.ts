import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  canonicalStringify,
  type DieTapeEntry,
} from '../determinism';
import type {
  RuleActionDefinition,
  SpatialFacts,
} from '../domain';
import type { SpellGrantAccess } from '../spellcastingAccess';
import {
  compileMicroMvpAcceptanceCorpus,
  createCompiledMicroMvpAcceptanceCaseForRoot,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import { COMPILED_WARLOCK_INVOCATION_SCENARIO_EVIDENCE } from './compiledWarlockInvocationScenarioEvidence';
import {
  type ScenarioRun,
  type ScenarioSpec,
  type ScenarioStep,
} from './scenario';
import { runCompiledRuntimeScenario } from './compiledMicroMvpSpeciesFeatStyleRuntime';

type CompiledSpell = Extract<RuleActionDefinition, { kind: 'spell' }>;

interface InvocationContext {
  id: string;
  root: CompiledMicroMvpL1Root;
  baseSteps: number;
  support: CompiledMicroMvpL1Root;
}

let corpus: CompiledMicroMvpAcceptanceCorpus;
let armor: CompiledMicroMvpL1Root;
let mind: CompiledMicroMvpL1Root;
let tome: CompiledMicroMvpL1Root;
let scenarioIndex = 0;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled Warlock scenario fixture: ${label}`);
  return value;
}

function selectedInvocation(root: CompiledMicroMvpL1Root): string {
  return required(root.decisions.find((decision) => (
    decision.choiceId.endsWith(':warlock_invocation_l1')
  )), `${root.stableKey}:invocation decision`).optionIds[0];
}

function spellByCard(
  root: CompiledMicroMvpL1Root,
  cardNumber: string,
  sourceId?: string,
): { action: CompiledSpell; grant: SpellGrantAccess; entityId: string } {
  const entity = required(
    root.assembled.spells.find((spell) => spell.card_number === cardNumber),
    `${root.stableKey}:${cardNumber}:entity`,
  );
  const candidates = root.rulesActions.filter((candidate): candidate is CompiledSpell => (
    candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id)
  ));
  const grant = required(root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidates.some((action) => action.id === candidate.actionId)
      && (sourceId === undefined || candidate.sourceId === sourceId)
  )), `${root.stableKey}:${cardNumber}:grant`);
  const action = required(candidates.find((candidate) => candidate.id === grant.actionId), (
    `${root.stableKey}:${cardNumber}:action`
  ));
  return { action, grant, entityId: entity.id };
}

function facts(relation: SpatialFacts['relation'], distanceFt: number): SpatialFacts {
  return {
    factsSource: 'scenario', boardRevision: 41, distanceFt,
    lineOfSight: true, cover: 'none', relation,
  };
}

function start(id: string, actor: 'subject' | 'support', suffix: string): ScenarioStep {
  return {
    do: 'startTurn', actor,
    assertions: [{
      id: `${id}:${suffix}:START`, type: 'event', eventType: 'turn_started', exactly: 1,
    }],
  };
}

function end(id: string, actor: 'subject' | 'support', suffix: string): ScenarioStep {
  return {
    do: 'endTurn', actor,
    assertions: [{
      id: `${id}:${suffix}:END`, type: 'event', eventType: 'turn_ended', exactly: 1,
    }],
  };
}

function checkpoint(id: string, suffix: string, path: string, value: unknown): ScenarioStep {
  return {
    do: 'checkpointReload',
    assertions: [{ id: `${id}:${suffix}:RELOAD`, type: 'equals', path, value }],
  };
}

function runInvocation(input: {
  label: string;
  root: CompiledMicroMvpL1Root;
  extraTape?: readonly DieTapeEntry[];
  steps: (context: InvocationContext) => ScenarioStep[];
}): ScenarioRun {
  const base = createCompiledMicroMvpAcceptanceCaseForRoot(corpus, input.root, {
    index: scenarioIndex,
    idPrefix: `compiled-warlock-${input.label}`,
  });
  scenarioIndex += 1;
  const context: InvocationContext = {
    id: base.id,
    root: input.root,
    baseSteps: base.spec.steps.length,
    support: base.support,
  };
  const spec: ScenarioSpec = {
    ...base.spec,
    objects: input.root.initialWorldObjects.map((object) => ({
      ...object,
      ...(object.ownerActorId === input.root.fixtureId ? { ownerActorId: 'subject' } : {}),
      ...(object.carriedByActorId === input.root.fixtureId ? { carriedByActorId: 'subject' } : {}),
      ...(object.sourceActorId === input.root.fixtureId ? { sourceActorId: 'subject' } : {}),
      ...(object.illumination?.sourceActorId === input.root.fixtureId ? {
        illumination: { ...object.illumination, sourceActorId: 'subject' },
      } : {}),
      ...(object.prestidigitation ? {
        prestidigitation: object.prestidigitation.map((attachment) => ({
          ...attachment,
          sourceActorId: attachment.sourceActorId === input.root.fixtureId
            ? 'subject'
            : attachment.sourceActorId,
        })),
      } : {}),
    })),
    rollTape: [...(base.spec.rollTape ?? []), ...(input.extraTape ?? [])],
    steps: [...base.spec.steps, ...input.steps(context)],
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
  expect(Object.values(run.initialState.actors)).toHaveLength(2);
  expect(Object.values(run.initialState.actors).every((actor) => (
    actor.kind === 'playerCharacter'
  ))).toBe(true);
  expect(run.observedTrace).toEqual([
    'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
  ]);
  expect(run.rejections).toEqual([]);
  expect(run.checkpoints.length).toBeGreaterThanOrEqual(2);
  expect(canonicalStringify(run.finalState)).toBe(canonicalStringify(run.replayState));
  expect(run.rngConsumed).toBe(spec.rollTape?.length);
  return run;
}

function actionDeclarations(run: ScenarioRun) {
  return run.events.flatMap((entry) => (
    entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
  ));
}

function engineRolls(run: ScenarioRun) {
  return run.events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' && entry.payload.event.type === 'roll'
      ? [entry.payload.event]
      : []
  ));
}

describe('compiled Warlock invocation mandatory two-PC scenarios', () => {
  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled Warlock scenarios');
    };
    try {
      corpus = await compileMicroMvpAcceptanceCorpus();
      const base = required(corpus.compiled.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-warlock'
          && root.matrixCase.species.card_number === 'RACE-0003'
      )), 'Dwarf Warlock base');
      [armor, mind, tome] = await compileMicroMvpL1ChoiceVariants([
        {
          stableKey: base.stableKey,
          overrides: { warlock_invocation_l1: ['EFF-invoc-armor_of_shadows'] },
        },
        {
          stableKey: base.stableKey,
          overrides: {
            warlock_invocation_l1: ['EFF-invoc-eldritch_mind'],
            warlock_spells_known: ['detect_magic', 'SPELL-0189'],
          },
        },
        {
          stableKey: base.stableKey,
          overrides: {
            warlock_invocation_l1: ['EFF-pact-tome'],
            pact_tome_cantrips: ['fire_bolt', 'light', 'SPELL-0230'],
            pact_tome_rituals: ['SPELL-0236', 'SPELL-0252'],
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('keeps all three focused invocation selections attached to the canonical Warlock choice', () => {
    expect([selectedInvocation(armor), selectedInvocation(mind), selectedInvocation(tome)])
      .toEqual([
        'EFF-invoc-armor_of_shadows',
        'EFF-invoc-eldritch_mind',
        'EFF-pact-tome',
      ]);
    const registrations = COMPILED_WARLOCK_INVOCATION_SCENARIO_EVIDENCE;
    expect(registrations).toHaveLength(3);
    expect(new Set(registrations.map((item) => item.assertionId)).size).toBe(3);
  });

  it('runs compiled Armor of Shadows as self-only at-will Mage Armor without spending the Pact slot', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WARLOCK-ARMOR-SHADOWS-01' },
  }, () => {
    const spell = spellByCard(armor, 'SPELL-0190', 'EFF-invoc-armor_of_shadows');
    const slotBefore = armor.actor.runtime.resources.spell_slot_1;
    const run = runInvocation({
      label: 'armor-of-shadows', root: armor,
      steps: ({ id }) => [
        start(id, 'subject', 'ARMOR-SUBJECT'),
        {
          do: 'use', actor: 'subject', actionId: spell.action.id, actionKind: 'spell',
          targets: ['subject'], factsByTarget: {
            subject: { ...facts('self', 0), willing: true },
          },
          spell: { baseLevel: 1, grantId: spell.grant.grantId, mode: 'normal' },
          assertions: [
            {
              id: `${id}:ARMOR-SLOT-UNCHANGED`, type: 'equals',
              path: 'actors.subject.runtime.resources.spell_slot_1', value: slotBefore,
            },
            {
              id: `${id}:ARMOR-DECLARED`, type: 'event', exactly: 1,
              match: {
                payloadType: 'ActionDeclared', sourceActorId: 'subject',
                payloadSubset: {
                  actionId: spell.action.id,
                  spell: {
                    grantId: spell.grant.grantId,
                    sourceId: 'EFF-invoc-armor_of_shadows',
                    payment: { kind: 'none' },
                  },
                },
              },
            },
          ],
        },
        checkpoint(id, 'ARMOR', 'actors.subject.runtime.resources.spell_slot_1', slotBefore),
        end(id, 'subject', 'ARMOR-SUBJECT'),
      ],
    });
    expect(run.finalState.actors.subject.runtime.activeEffects).toContainEqual(
      expect.objectContaining({ roundsLeft: 4_800 }),
    );
  });

  it('runs compiled Eldritch Mind through a damaging cross-PC spell and the exact Concentration save', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WARLOCK-ELDRITCH-MIND-01' },
  }, () => {
    const detect = spellByCard(mind, 'detect_magic', 'CLASS-warlock');
    const run = runInvocation({
      label: 'eldritch-mind', root: mind,
      extraTape: [
        { label: 'second Thunderwave damage one', sides: 8, value: 2 },
        { label: 'second Thunderwave damage two', sides: 8, value: 3 },
      ],
      steps: ({ id, support }) => {
        const thunderwave = spellByCard(support, 'SPELL-0171', 'CLASS-wizard');
        return [
          start(id, 'subject', 'MIND-SUBJECT'),
          {
            do: 'use', actor: 'subject', actionId: detect.action.id, actionKind: 'spell',
            targets: [], factsByTarget: {},
            spell: { baseLevel: 1, grantId: detect.grant.grantId, mode: 'normal' },
            assertions: [{
              id: `${id}:MIND-CONCENTRATING`, type: 'equals',
              path: 'concentrations.subject.actionId', value: detect.action.id,
            }],
          },
          checkpoint(id, 'MIND-CONCENTRATION', 'concentrations.subject.actionId', detect.action.id),
          end(id, 'subject', 'MIND-SUBJECT'),
          start(id, 'support', 'MIND-SUPPORT'),
          {
            do: 'use', actor: 'support', actionId: thunderwave.action.id, actionKind: 'spell',
            targets: ['subject'], factsByTarget: {
              subject: { ...facts('enemy', 5), inArea: true },
            },
            spell: { baseLevel: 1, grantId: thunderwave.grant.grantId, mode: 'normal' },
            worldInput: { type: 'area_objects', factsByObject: {} },
            assertions: [{
              id: `${id}:MIND-TARGET-SAVE`, type: 'pending', pendingType: 'target_save',
            }],
          },
          {
            do: 'resolveDecision', actor: 'subject',
            roll: { mode: 'manual', dice: [{ sides: 20, value: 20 }] },
            assertions: [{
              id: `${id}:MIND-CONCENTRATION-SAVE-WINDOW`,
              type: 'pending', pendingType: 'concentration_save',
            }],
          },
          checkpoint(id, 'MIND-SAVE', 'pendingResolution.type', 'concentration_save'),
          {
            do: 'resolveDecision', actor: 'subject',
            roll: {
              mode: 'manual',
              dice: [{ sides: 20, value: 2 }, { sides: 20, value: 15 }],
            },
            assertions: [
              { id: `${id}:MIND-SAVE-CLOSED`, type: 'pending', pendingType: null },
              {
                id: `${id}:MIND-SAVE-SUCCEEDS`, type: 'event', exactly: 1,
                match: {
                  engineEventType: 'roll', sourceActorId: 'subject',
                  includesObligationIds: ['system:concentration-damage-save'],
                  roll: { kind: 'save', outcome: 'success' },
                },
              },
            ],
          },
          end(id, 'support', 'MIND-SUPPORT'),
        ];
      },
    });
    const concentration = engineRolls(run).find((entry) => entry.label.startsWith('Концентрация'));
    expect(concentration?.roll).toMatchObject({
      kind: 'save', advantage: 'advantage',
      dice: [{ sides: 20, result: 15 }, { sides: 20, result: 2, discarded: true }],
      outcome: 'success',
    });
    expect(run.finalState.concentrations.subject?.actionId).toBe(detect.action.id);
  });

  it('runs a compiled Pact Tome cantrip from its source-owned book and preserves all five choices', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-WARLOCK-PACT-TOME-01' },
  }, () => {
    const pact = required(tome.actor.warlockPacts?.tome, 'Pact Tome state');
    const fireBolt = spellByCard(tome, 'fire_bolt', pact.tome.bookObjectId);
    const supportHpBefore = createCompiledMicroMvpAcceptanceCaseForRoot(corpus, tome, {
      index: 900,
      idPrefix: 'compiled-warlock-tome-hp-probe',
    }).support.actor.runtime.hp.current;
    const run = runInvocation({
      label: 'pact-tome', root: tome,
      extraTape: [
        { label: 'Pact Tome Fire Bolt disadvantage high', sides: 20, value: 16 },
        { label: 'Pact Tome Fire Bolt disadvantage low', sides: 20, value: 15 },
        { label: 'Pact Tome Fire Bolt damage', sides: 10, value: 7 },
      ],
      steps: ({ id }) => [
        start(id, 'subject', 'TOME-SUBJECT'),
        {
          do: 'use', actor: 'subject', actionId: fireBolt.action.id, actionKind: 'spell',
          targets: ['support'], factsByTarget: {
            support: { ...facts('enemy', 120), targetCanSeeSource: false },
          },
          spell: { baseLevel: 0, grantId: fireBolt.grant.grantId, mode: 'normal' },
          assertions: [{
            id: `${id}:TOME-DECLARED`, type: 'event', exactly: 1,
            match: {
              payloadType: 'ActionDeclared', sourceActorId: 'subject', targetIds: ['support'],
              payloadSubset: {
                actionId: fireBolt.action.id,
                spell: {
                  grantId: fireBolt.grant.grantId,
                  sourceId: pact.tome.bookObjectId,
                  payment: { kind: 'none' },
                },
              },
            },
          }],
        },
        {
          do: 'resolveReaction', actor: 'support', actionId: null,
          assertions: [{
            id: `${id}:TOME-SHIELD-DECLINED`, type: 'pending', pendingType: null,
          }],
        },
        checkpoint(id, 'TOME', 'actors.subject.warlockPacts.tome.tome.bookObjectId', pact.tome.bookObjectId),
        end(id, 'subject', 'TOME-SUBJECT'),
      ],
    });
    expect(pact.tome.cantripActionIds).toHaveLength(3);
    expect(pact.tome.ritualActionIds).toHaveLength(2);
    expect(pact.tome.spellGrantIds).toHaveLength(5);
    expect(run.finalState.objects[pact.tome.bookObjectId]).toMatchObject({
      sourceActorId: 'subject', sourceActionId: pact.sourceEntityId,
    });
    expect(run.finalState.actors.support.runtime.hp.current).toBe(supportHpBefore - 7);
    expect(actionDeclarations(run)).toContainEqual(expect.objectContaining({
      actionId: fireBolt.action.id,
      spell: expect.objectContaining({ sourceId: pact.tome.bookObjectId }),
    }));
  });
});
