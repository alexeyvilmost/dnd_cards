import { canonicalStringify } from '../determinism';
import type {
  ActorState,
  ActionWorldInput,
  Ability,
  CommandRejectionCode,
  DecisionRoll,
  DeterministicEnvironment,
  GameCommand,
  HideEligibilityFacts,
  InitiativeSwapFacts,
  RulesCatalog,
  RulesetReference,
  RuleEventPayload,
  SpatialFacts,
  UncommittedRuleEvent,
  UseActionCommand,
  WorldState,
} from '../domain';
import type { ArcaneRecoveryDecision } from '../restDecisions';
import type { UnarmedStrikeOption } from '../attackSequence';
import type { MagicBlockingLayer, WorldObjectFacts, WorldObjectState } from '../worldObjects';
import { createWorld } from '../domain';
import { createStrictRngTape } from '../determinism';
import type { DieTapeEntry } from '../determinism';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';

export type RequiredScenarioTrace =
  | 'nonSpellAction'
  | 'castSpell'
  | 'applyCondition'
  | 'savingThrow'
  | 'abilityCheck';

export interface ScenarioActorSpec {
  fixtureId: string;
}

interface ScenarioStepBase {
  assertions: ScenarioAssertion[];
  /** Accepted is the default. Rejections must be explicit and code-specific. */
  expectedResult?: ScenarioExpectedResult;
}

type EngineEvent = Extract<RuleEventPayload, { type: 'EngineEventRecorded' }>['event'];
type EngineRoll = Extract<EngineEvent, { type: 'roll' }>['roll'];

export type ScenarioExpectedResult =
  | { status: 'accepted' }
  | { status: 'rejected'; code: CommandRejectionCode; messageIncludes?: string };

/** A structural event selector. Arrays (including target/obligation lists) are order-sensitive. */
export interface ScenarioEventMatcher {
  payloadType?: RuleEventPayload['type'];
  engineEventType?: EngineEvent['type'];
  sourceActorId?: string;
  actorId?: string;
  targetIds?: string[];
  obligationIds?: string[];
  includesObligationIds?: string[];
  roll?: {
    kind?: EngineRoll['kind'];
    outcome?: NonNullable<EngineRoll['outcome']>;
  };
  /** Recursive object subset matched against the complete RuleEventPayload. */
  payloadSubset?: Record<string, unknown>;
}

export type ScenarioAssertion =
  | { id: string; type: 'equals'; path: string; value: unknown }
  | { id: string; type: 'condition'; actor: string; condition: string; present: boolean }
  | { id: string; type: 'pending'; pendingType: NonNullable<WorldState['pendingResolution']>['type'] | null }
  | {
      id: string;
      type: 'event';
      /** Legacy shorthand for match.engineEventType. */
      eventType?: EngineEvent['type'];
      match?: ScenarioEventMatcher;
      minimum?: number;
      maximum?: number;
      exactly?: number;
    }
  | {
      id: string;
      type: 'eventOrder';
      /** Matchers must occur in this order; unrelated events may occur between them. */
      matchers: [ScenarioEventMatcher, ...ScenarioEventMatcher[]];
      /** When true, the matched events must be adjacent. */
      contiguous?: boolean;
      /** Optionally pin the first matched event to an exact zero-based step-event index. */
      startIndex?: number;
    };

export type ScenarioStep =
  | (ScenarioStepBase & { do: 'startEncounter'; actor: string })
  | (ScenarioStepBase & { do: 'startTurn'; actor: string })
  | (ScenarioStepBase & { do: 'endTurn'; actor: string })
  | (ScenarioStepBase & {
      do: 'shortRest';
      actor: string;
      decisions?: ArcaneRecoveryDecision[];
      pactTome?: Extract<GameCommand, { type: 'TakeShortRest' }>['pactTome'];
    })
  | (ScenarioStepBase & {
      do: 'longRest';
      actor: string;
      durationHours?: number;
      pactTome?: Extract<GameCommand, { type: 'TakeLongRest' }>['pactTome'];
    })
  | (ScenarioStepBase & {
      do: 'swapInitiative';
      actor: string;
      ally: string;
      facts: InitiativeSwapFacts;
    })
  | (ScenarioStepBase & { do: 'beginAttack'; actor: string })
  | (ScenarioStepBase & {
      do: 'weaponAttack';
      actor: string;
      weaponCardId: string;
      target: string;
      facts: SpatialFacts;
      /** Defaults to this actor's only open canonical Attack-action ledger. */
      attackActionId?: string;
    })
  | (ScenarioStepBase & {
      do: 'unarmedStrike';
      actor: string;
      option: UnarmedStrikeOption;
      target: string;
      facts: SpatialFacts;
      /** Defaults to this actor's only open canonical Attack-action ledger. */
      attackActionId?: string;
    })
  | (ScenarioStepBase & {
      do: 'use';
      actor: string;
      actionId: string;
      actionKind: 'nonSpell' | 'spell';
      targets: string[];
      factsByTarget: Record<string, SpatialFacts>;
      choices?: Record<string, string | string[]>;
      spell?: UseActionCommand['spell'];
      worldInput?: ActionWorldInput;
    })
  | (ScenarioStepBase & {
      /** Takes the Attack action and executes one catalog-owned replacement. */
      do: 'attackReplacement';
      actor: string;
      actionId: string;
      targets: string[];
      factsByTarget: Record<string, SpatialFacts>;
      choices?: Record<string, string | string[]>;
    })
  | (ScenarioStepBase & {
      do: 'abilityCheck';
      actor: string;
      ability: Ability;
      skill?: string;
      dc?: number;
    })
  | (ScenarioStepBase & {
      do: 'donArmor';
      actor: string;
      armorCardId: string;
    })
  | (ScenarioStepBase & {
      do: 'moveDancingLights';
      actor: string;
      /** Defaults to the actor's currently active concentration. */
      concentrationId?: string;
      groupId: string;
      factsSource: 'scenario' | 'board' | 'gm_ruling';
      boardRevision: number;
      resultingFacts: Array<{
        lightId: string;
        movementFt: number;
        distanceFromCasterFt: number;
        withinRequiredSeparation?: boolean;
      }>;
    })
  | (ScenarioStepBase & {
      do: 'observePoisonDisease';
      actor: string;
      /** Defaults to the actor's currently active concentration. */
      concentrationId?: string;
      observations: Record<string, {
        facts: WorldObjectFacts;
        blockingLayers: MagicBlockingLayer[];
      }>;
    })
  | (ScenarioStepBase & {
      do: 'studyWorldObject';
      actor: string;
      objectId: string;
      facts: WorldObjectFacts;
    })
  | (ScenarioStepBase & {
      do: 'physicalInteractWorldObject';
      actor: string;
      objectId: string;
      facts: WorldObjectFacts;
    })
  | (ScenarioStepBase & {
      do: 'revealMagicAura';
      actor: string;
      /** Defaults to the actor's currently active concentration. */
      concentrationId?: string;
      observations: Record<string, {
        facts: WorldObjectFacts;
        blockingLayers: MagicBlockingLayer[];
      }>;
    })
  | (ScenarioStepBase & {
      do: 'hide';
      actor: string;
      eligibility: HideEligibilityFacts;
    })
  | (ScenarioStepBase & {
      do: 'triggerHazard';
      actor: string;
      hazardId: string;
      targetActor: string;
    })
  | (ScenarioStepBase & {
      do: 'savingThrow';
      actor: string;
      ability: Ability;
      dc: number;
    })
  | (ScenarioStepBase & { do: 'resolveDecision'; actor: string; roll: DecisionRoll })
  | (ScenarioStepBase & { do: 'resolveReaction'; actor: string; actionId: string | null })
  | (ScenarioStepBase & { do: 'checkpointReload' });

export interface ScenarioSpec {
  schemaVersion: 1;
  id: string;
  ruleset: RulesetReference;
  actors: Record<string, ScenarioActorSpec>;
  /** Optional deterministic non-creature fixtures for spell/environment scenarios. */
  objects?: WorldObjectState[];
  initiative: string[];
  /** Defaults to true for legacy specs; false allows exploration setup first. */
  autoStartEncounter?: boolean;
  /** JSON-serializable authoritative dice input for this scenario. */
  rollTape?: DieTapeEntry[];
  steps: ScenarioStep[];
  requiredTrace: RequiredScenarioTrace[];
}

export interface ScenarioFixtureProvider {
  getActor(fixtureId: string): ActorState | undefined;
  catalog: RulesCatalog;
}

export interface ScenarioRun {
  initialState: WorldState;
  finalState: WorldState;
  /** Exact JSON-compatible commands, including expected rejections, for worker differential replay. */
  commands: GameCommand[];
  events: UncommittedRuleEvent[];
  assertionIds: string[];
  observedTrace: RequiredScenarioTrace[];
  checkpoints: string[];
  replayState: WorldState;
  rejections: Array<{
    step: number;
    action: ScenarioStep['do'];
    code: CommandRejectionCode;
    message: string;
  }>;
  /** Null only for transitional specs that still inject an external RNG. */
  rngConsumed: number | null;
}

export interface ScenarioEnvironment {
  rng?: DeterministicEnvironment['rng'];
  clock: DeterministicEnvironment['clock'];
  nextId: DeterministicEnvironment['nextId'];
}

function matcherHasConstraint(matcher: ScenarioEventMatcher): boolean {
  return Object.values(matcher).some((value) => value !== undefined);
}

function validateMatcher(spec: ScenarioSpec, assertionId: string, matcher: ScenarioEventMatcher): void {
  if (!matcherHasConstraint(matcher)) {
    throw new Error(`${spec.id}: event matcher in ${assertionId} cannot be empty`);
  }
  if (matcher.targetIds && matcher.targetIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error(`${spec.id}: ${assertionId} has an invalid target ID`);
  }
  for (const ids of [matcher.obligationIds, matcher.includesObligationIds]) {
    if (ids?.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error(`${spec.id}: ${assertionId} has an invalid obligation ID`);
    }
  }
  if (matcher.payloadSubset) canonicalStringify(matcher.payloadSubset);
}

function validateSpec(spec: ScenarioSpec): void {
  if (spec.schemaVersion !== 1) throw new Error(`Unsupported scenario schema ${spec.schemaVersion}`);
  const aliases = Object.keys(spec.actors);
  if (aliases.length !== 2) throw new Error(`${spec.id}: acceptance scenario requires exactly two actors`);
  if (spec.initiative.length !== 2 || new Set(spec.initiative).size !== 2
    || spec.initiative.some((alias) => !spec.actors[alias])) {
    throw new Error(`${spec.id}: initiative must contain both actors exactly once`);
  }
  if (spec.steps.some((step) => step.assertions.length === 0)) {
    throw new Error(`${spec.id}: every scenario step requires at least one executable assertion`);
  }
  const assertionIds = spec.steps.flatMap((step) => step.assertions.map((assertion) => assertion.id));
  if (assertionIds.some((id) => !id.trim())) throw new Error(`${spec.id}: assertion IDs cannot be blank`);
  if (new Set(assertionIds).size !== assertionIds.length) throw new Error(`${spec.id}: assertion IDs must be unique`);
  for (const step of spec.steps) {
    if (step.do === 'checkpointReload' && step.expectedResult) {
      throw new Error(`${spec.id}: checkpointReload cannot declare an expected command result`);
    }
    if (step.expectedResult?.status === 'rejected' && !step.expectedResult.code) {
      throw new Error(`${spec.id}: rejected steps require a rejection code`);
    }
    if (step.do === 'triggerHazard' && !spec.actors[step.targetActor]) {
      throw new Error(`${spec.id}: hazard target ${step.targetActor} is not a scenario actor`);
    }
    for (const assertion of step.assertions) {
      if ((assertion.type === 'condition' && !spec.actors[assertion.actor])
        || (assertion.type === 'equals' && !/^[A-Za-z0-9_.:-]+$/.test(assertion.path))) {
        throw new Error(`${spec.id}: invalid assertion ${assertion.id}`);
      }
      if (assertion.type === 'event') {
        if (!assertion.eventType && !assertion.match) {
          throw new Error(`${spec.id}: event assertion ${assertion.id} requires eventType or match`);
        }
        if (assertion.match) validateMatcher(spec, assertion.id, assertion.match);
        if (assertion.eventType && assertion.match?.engineEventType
          && assertion.eventType !== assertion.match.engineEventType) {
          throw new Error(`${spec.id}: event assertion ${assertion.id} declares conflicting event types`);
        }
        const counts = [assertion.minimum, assertion.maximum, assertion.exactly]
          .filter((value): value is number => value !== undefined);
        if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
          throw new Error(`${spec.id}: event assertion ${assertion.id} has an invalid count`);
        }
        if (assertion.exactly != null && (assertion.minimum != null || assertion.maximum != null)) {
          throw new Error(`${spec.id}: event assertion ${assertion.id} cannot mix exactly with minimum/maximum`);
        }
        if (assertion.minimum != null && assertion.maximum != null && assertion.minimum > assertion.maximum) {
          throw new Error(`${spec.id}: event assertion ${assertion.id} has minimum above maximum`);
        }
      }
      if (assertion.type === 'eventOrder') {
        assertion.matchers.forEach((matcher) => validateMatcher(spec, assertion.id, matcher));
        if (assertion.startIndex != null
          && (!Number.isInteger(assertion.startIndex) || assertion.startIndex < 0)) {
          throw new Error(`${spec.id}: event order assertion ${assertion.id} has invalid startIndex`);
        }
      }
    }
  }
  if (spec.rollTape) {
    for (const [index, entry] of spec.rollTape.entries()) {
      if (!entry.label.trim()) throw new Error(`${spec.id}: rollTape entry ${index + 1} has a blank label`);
    }
  }
  if (new Set(spec.requiredTrace).size !== spec.requiredTrace.length) {
    throw new Error(`${spec.id}: requiredTrace contains duplicates`);
  }
}

interface ResolvedScenarioActorFixture {
  alias: string;
  lookupFixtureId: string;
  actor: ActorState;
}

interface ScenarioActorAliasResolver {
  resolve: (actorId: string, path: string) => string;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}

function resolveActorFixtures(
  spec: ScenarioSpec,
  fixtures: ScenarioFixtureProvider,
): ResolvedScenarioActorFixture[] {
  return Object.entries(spec.actors).map(([alias, actorSpec]) => {
    const actor = fixtures.getActor(actorSpec.fixtureId);
    if (!actor) throw new Error(`${spec.id}: missing actor fixture ${actorSpec.fixtureId}`);
    // A scenario's two principal aliases are normally PCs. A source-owned
    // summoned actor is also admissible so familiar identity and lifecycle can
    // be tested without flattening it into a fake player character. Arbitrary
    // monster fixtures remain outside this acceptance boundary.
    if (actor.kind === 'monster') {
      throw new Error(`${spec.id}: ${actorSpec.fixtureId} is an unsupported monster fixture`);
    }
    return { alias, lookupFixtureId: actorSpec.fixtureId, actor: canonicalClone(actor) };
  });
}

function actorAliasResolver(
  spec: ScenarioSpec,
  resolved: readonly ResolvedScenarioActorFixture[],
): ScenarioActorAliasResolver {
  const aliases = new Set(resolved.map((entry) => entry.alias));
  const aliasesBySourceId = new Map<string, Set<string>>();
  for (const entry of resolved) {
    for (const sourceId of new Set([entry.lookupFixtureId, entry.actor.id])) {
      const mapped = aliasesBySourceId.get(sourceId) ?? new Set<string>();
      mapped.add(entry.alias);
      aliasesBySourceId.set(sourceId, mapped);
    }
  }
  for (const alias of aliases) {
    const sourceMappings = aliasesBySourceId.get(alias);
    if (sourceMappings && (sourceMappings.size !== 1 || !sourceMappings.has(alias))) {
      throw new Error(`${spec.id}: actor alias ${alias} collides with a different fixture identity`);
    }
  }
  return {
    resolve: (actorId, path) => {
      if (aliases.has(actorId)) return actorId;
      const mapped = aliasesBySourceId.get(actorId);
      if (!mapped) return actorId;
      if (mapped.size !== 1) {
        throw new Error(
          `${spec.id}: ${path} uses ambiguous fixture actor ID ${actorId}; use a scenario alias`,
        );
      }
      return [...mapped][0];
    },
  };
}

function rebindSelfActorId(input: {
  value: string;
  alias: string;
  path: string;
  resolver: ScenarioActorAliasResolver;
  scenarioId: string;
}): string {
  const rebound = input.resolver.resolve(input.value, input.path);
  if (rebound !== input.alias) {
    throw new Error(
      `${input.scenarioId}: ${input.path} must be owned by fixture actor ${input.alias}; got ${input.value}`,
    );
  }
  return input.alias;
}

function rebindActorFixture(
  spec: ScenarioSpec,
  fixture: ResolvedScenarioActorFixture,
  resolver: ScenarioActorAliasResolver,
): ActorState {
  const actor = fixture.actor;
  const self = (value: string, path: string): string => rebindSelfActorId({
    value,
    alias: fixture.alias,
    path,
    resolver,
    scenarioId: spec.id,
  });
  const runtime = {
    ...actor.runtime,
    activeEffects: actor.runtime.activeEffects.map((effect, index) => ({
      ...effect,
      ...(effect.ownerId !== undefined ? {
        ownerId: self(effect.ownerId, `actors.${fixture.alias}.runtime.activeEffects[${index}].ownerId`),
      } : {}),
      ...(effect.sourceId !== undefined ? {
        sourceId: resolver.resolve(
          effect.sourceId,
          `actors.${fixture.alias}.runtime.activeEffects[${index}].sourceId`,
        ),
      } : {}),
      ...(effect.sourceTurnExpiry ? {
        sourceTurnExpiry: {
          ...effect.sourceTurnExpiry,
          sourceActorId: resolver.resolve(
            effect.sourceTurnExpiry.sourceActorId,
            `actors.${fixture.alias}.runtime.activeEffects[${index}].sourceTurnExpiry.sourceActorId`,
          ),
          ownerActorId: self(
            effect.sourceTurnExpiry.ownerActorId,
            `actors.${fixture.alias}.runtime.activeEffects[${index}].sourceTurnExpiry.ownerActorId`,
          ),
        },
      } : {}),
    })),
  };

  const blade = actor.warlockPacts?.blade;
  const chain = actor.warlockPacts?.chain;
  const tome = actor.warlockPacts?.tome;
  const warlockPacts = actor.warlockPacts ? {
    ...(blade ? {
      blade: {
        ...blade,
        ownerActorId: self(blade.ownerActorId, `actors.${fixture.alias}.warlockPacts.blade.ownerActorId`),
        ...(blade.activeBond ? {
          activeBond: {
            ...blade.activeBond,
            warlockActorId: self(
              blade.activeBond.warlockActorId,
              `actors.${fixture.alias}.warlockPacts.blade.activeBond.warlockActorId`,
            ),
          },
        } : {}),
      },
    } : {}),
    ...(chain ? {
      chain: {
        ...chain,
        ownerActorId: self(chain.ownerActorId, `actors.${fixture.alias}.warlockPacts.chain.ownerActorId`),
        ...(chain.activeFamiliar ? {
          activeFamiliar: {
            ...chain.activeFamiliar,
            actorId: resolver.resolve(
              chain.activeFamiliar.actorId,
              `actors.${fixture.alias}.warlockPacts.chain.activeFamiliar.actorId`,
            ),
            ownerActorId: self(
              chain.activeFamiliar.ownerActorId,
              `actors.${fixture.alias}.warlockPacts.chain.activeFamiliar.ownerActorId`,
            ),
          },
        } : {}),
      },
    } : {}),
    ...(tome ? {
      tome: {
        ...tome,
        ownerActorId: self(tome.ownerActorId, `actors.${fixture.alias}.warlockPacts.tome.ownerActorId`),
        tome: {
          ...tome.tome,
          ownerActorId: self(
            tome.tome.ownerActorId,
            `actors.${fixture.alias}.warlockPacts.tome.tome.ownerActorId`,
          ),
        },
      },
    } : {}),
  } : undefined;

  const familiarState = actor.familiarState ? {
    ...actor.familiarState,
    actorId: self(actor.familiarState.actorId, `actors.${fixture.alias}.familiarState.actorId`),
    ownerActorId: resolver.resolve(
      actor.familiarState.ownerActorId,
      `actors.${fixture.alias}.familiarState.ownerActorId`,
    ),
  } : undefined;
  if (familiarState?.ownerActorId === fixture.alias) {
    throw new Error(`${spec.id}: actors.${fixture.alias}.familiarState cannot own itself`);
  }
  const familiarMetadata = actor.familiarMetadata ? {
    ...actor.familiarMetadata,
    ownerActorId: resolver.resolve(
      actor.familiarMetadata.ownerActorId,
      `actors.${fixture.alias}.familiarMetadata.ownerActorId`,
    ),
  } : undefined;
  if (familiarState && familiarMetadata
    && familiarState.ownerActorId !== familiarMetadata.ownerActorId) {
    throw new Error(`${spec.id}: actors.${fixture.alias} familiar owner projections disagree`);
  }

  const lifecycle = actor.lifecycle?.status === 'dead' ? {
    ...actor.lifecycle,
    adjudication: {
      ...actor.lifecycle.adjudication,
      actorId: self(
        actor.lifecycle.adjudication.actorId,
        `actors.${fixture.alias}.lifecycle.adjudication.actorId`,
      ),
    },
  } : actor.lifecycle;

  return {
    ...actor,
    id: fixture.alias,
    runtime,
    ...(warlockPacts ? { warlockPacts } : {}),
    ...(familiarState ? { familiarState } : {}),
    ...(familiarMetadata ? { familiarMetadata } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  };
}

function rebindWorldObject(
  object: WorldObjectState,
  resolver: ScenarioActorAliasResolver,
  path: string,
): WorldObjectState {
  const resolve = (actorId: string, field: string): string => (
    resolver.resolve(actorId, `${path}.${field}`)
  );
  return {
    ...object,
    ...(object.attunedToActorId !== undefined ? {
      attunedToActorId: resolve(object.attunedToActorId, 'attunedToActorId'),
    } : {}),
    ...(object.heldByActorId !== undefined ? {
      heldByActorId: resolve(object.heldByActorId, 'heldByActorId'),
    } : {}),
    ...(object.ownerActorId !== undefined ? {
      ownerActorId: resolve(object.ownerActorId, 'ownerActorId'),
    } : {}),
    ...(object.carriedByActorId !== undefined ? {
      carriedByActorId: resolve(object.carriedByActorId, 'carriedByActorId'),
    } : {}),
    ...(object.sourceActorId !== undefined ? {
      sourceActorId: resolve(object.sourceActorId, 'sourceActorId'),
    } : {}),
    ...(object.illumination ? {
      illumination: {
        ...object.illumination,
        sourceActorId: resolve(object.illumination.sourceActorId, 'illumination.sourceActorId'),
      },
    } : {}),
    ...(object.illusion ? {
      illusion: {
        ...object.illusion,
        discernedByActorIds: object.illusion.discernedByActorIds.map((actorId, index) => (
          resolve(actorId, `illusion.discernedByActorIds[${index}]`)
        )),
        physicallyRevealedToActorIds: object.illusion.physicallyRevealedToActorIds
          .map((actorId, index) => (
            resolve(actorId, `illusion.physicallyRevealedToActorIds[${index}]`)
          )),
      },
    } : {}),
    ...(object.prestidigitation ? {
      prestidigitation: object.prestidigitation.map((attachment, index) => ({
        ...attachment,
        sourceActorId: resolve(
          attachment.sourceActorId,
          `prestidigitation[${index}].sourceActorId`,
        ),
      })),
    } : {}),
  };
}

function instantiateScenarioState(
  spec: ScenarioSpec,
  fixtures: ScenarioFixtureProvider,
): { actors: ActorState[]; objects: WorldObjectState[] } {
  const resolved = resolveActorFixtures(spec, fixtures);
  const resolver = actorAliasResolver(spec, resolved);
  return {
    actors: resolved.map((fixture) => rebindActorFixture(spec, fixture, resolver)),
    objects: (spec.objects ?? []).map((object, index) => rebindWorldObject(
      canonicalClone(object),
      resolver,
      `objects[${index}]`,
    )),
  };
}

function baseCommand(
  spec: ScenarioSpec,
  actorId: string,
  commandId: string,
  revision: number,
): Pick<GameCommand, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'> {
  return {
    schemaVersion: 1,
    commandId,
    expectedRevision: revision,
    rulesetContentHash: spec.ruleset.contentHash,
    actorId,
  };
}

function commandForStep(
  spec: ScenarioSpec,
  step: Exclude<ScenarioStep, { do: 'checkpointReload' }>,
  index: number,
  world: WorldState,
): GameCommand {
  const base = baseCommand(spec, step.actor, `${spec.id}:step:${index + 1}`, world.revision);
  const openAttackActionId = (): string => {
    const matches = Object.values(world.attackActions).filter((attackAction) => (
      attackAction.actorId === step.actor && attackAction.status === 'open'
    ));
    if (matches.length !== 1) {
      throw new Error(
        `${spec.id}: ${step.actor} must have exactly one open Attack action; got ${matches.length}`,
      );
    }
    return matches[0].id;
  };
  switch (step.do) {
    case 'startEncounter':
      return { ...base, type: 'StartEncounter', initiative: spec.initiative };
    case 'startTurn':
      return { ...base, type: 'StartTurn' };
    case 'endTurn':
      return { ...base, type: 'EndTurn' };
    case 'shortRest':
      return {
        ...base,
        type: 'TakeShortRest',
        decisions: step.decisions,
        pactTome: step.pactTome,
      };
    case 'longRest':
      return {
        ...base,
        type: 'TakeLongRest',
        durationHours: step.durationHours,
        pactTome: step.pactTome,
      };
    case 'swapInitiative':
      return {
        ...base,
        type: 'SwapInitiative',
        allyActorId: step.ally,
        facts: step.facts,
      };
    case 'beginAttack':
      return { ...base, type: 'BeginAttackAction' };
    case 'weaponAttack':
      return {
        ...base,
        type: 'PerformWeaponAttack',
        attackActionId: step.attackActionId ?? openAttackActionId(),
        weaponCardId: step.weaponCardId,
        targetActorId: step.target,
        facts: step.facts,
      };
    case 'unarmedStrike':
      return {
        ...base,
        type: 'PerformUnarmedStrike',
        attackActionId: step.attackActionId ?? openAttackActionId(),
        option: step.option,
        targetActorId: step.target,
        facts: step.facts,
      };
    case 'use':
      return {
        ...base,
        type: 'UseAction',
        actionId: step.actionId,
        targetIds: step.targets,
        factsByTarget: step.factsByTarget,
        choices: step.choices,
        spell: step.spell,
        worldInput: step.worldInput,
      };
    case 'attackReplacement':
      return {
        ...base,
        type: 'UseAttackReplacement',
        actionId: step.actionId,
        targetIds: step.targets,
        factsByTarget: step.factsByTarget,
        choices: step.choices,
      };
    case 'abilityCheck':
      return { ...base, type: 'AbilityCheck', ability: step.ability, skill: step.skill, dc: step.dc };
    case 'donArmor':
      return { ...base, type: 'DonArmor', armorCardId: step.armorCardId };
    case 'moveDancingLights':
      return {
        ...base,
        type: 'MoveDancingLights',
        concentrationId: step.concentrationId
          ?? world.concentrations[step.actor]?.id
          ?? `${spec.id}:missing-concentration`,
        groupId: step.groupId,
        factsSource: step.factsSource,
        boardRevision: step.boardRevision,
        resultingFacts: step.resultingFacts,
      };
    case 'observePoisonDisease':
      return {
        ...base,
        type: 'ObservePoisonDisease',
        concentrationId: step.concentrationId
          ?? world.concentrations[step.actor]?.id
          ?? `${spec.id}:missing-concentration`,
        observations: step.observations,
      };
    case 'studyWorldObject':
      return { ...base, type: 'StudyWorldObject', objectId: step.objectId, facts: step.facts };
    case 'physicalInteractWorldObject':
      return {
        ...base,
        type: 'PhysicallyInteractWorldObject',
        objectId: step.objectId,
        facts: step.facts,
      };
    case 'revealMagicAura':
      return {
        ...base,
        type: 'RevealMagicAura',
        concentrationId: step.concentrationId
          ?? world.concentrations[step.actor]?.id
          ?? `${spec.id}:missing-concentration`,
        observations: step.observations,
      };
    case 'hide':
      return { ...base, type: 'AttemptHide', eligibility: step.eligibility };
    case 'triggerHazard':
      return { ...base, type: 'TriggerHazard', hazardId: step.hazardId, targetActorId: step.targetActor };
    case 'savingThrow':
      return { ...base, type: 'SavingThrow', ability: step.ability, dc: step.dc };
    case 'resolveDecision': {
      const pending = world.pendingResolution;
      return {
        ...base,
        type: 'ResolveDecision',
        resolutionId: pending?.id ?? `${spec.id}:missing-resolution`,
        requestId: pending?.request.id ?? `${spec.id}:missing-request`,
        response: { kind: 'roll', roll: step.roll },
      };
    }
    case 'resolveReaction': {
      const pending = world.pendingResolution;
      return {
        ...base,
        type: 'ResolveDecision',
        resolutionId: pending?.id ?? `${spec.id}:missing-resolution`,
        requestId: pending?.request.id ?? `${spec.id}:missing-request`,
        response: { kind: 'reaction', actionId: step.actionId },
      };
    }
  }
}

function observedTrace(events: readonly UncommittedRuleEvent[]): RequiredScenarioTrace[] {
  const observed = new Set<RequiredScenarioTrace>();
  for (const entry of events) {
    if (entry.payload.type === 'ActionDeclared') {
      observed.add(entry.payload.actionKind === 'spell' ? 'castSpell' : 'nonSpellAction');
      continue;
    }
    if (entry.payload.type !== 'EngineEventRecorded') continue;
    if (entry.payload.event.type === 'condition_applied') observed.add('applyCondition');
    if (entry.payload.event.type === 'roll' && entry.payload.event.roll.kind === 'check') observed.add('abilityCheck');
    if (entry.payload.event.type === 'roll' && entry.payload.event.roll.kind === 'save') observed.add('savingThrow');
  }
  return [...observed].sort();
}

function valueAtPath(world: WorldState, path: string): unknown {
  let current: unknown = world;
  for (const segment of path.split('.')) {
    if (!segment || ['__proto__', 'prototype', 'constructor'].includes(segment)
      || typeof current !== 'object' || current === null || !(segment in current)) {
      throw new Error(`State path does not exist: ${path}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function deepSubsetMatches(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => deepSubsetMatches(value, actual[index]));
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => (
      !['__proto__', 'prototype', 'constructor'].includes(key)
      && key in actual
      && deepSubsetMatches(value, (actual as Record<string, unknown>)[key])
    ));
  }
  return Object.is(actual, expected);
}

function payloadActorId(payload: RuleEventPayload): string | undefined {
  if ('actorId' in payload && typeof payload.actorId === 'string') return payload.actorId;
  return undefined;
}

function payloadTargetIds(payload: RuleEventPayload): string[] | undefined {
  if ('targetIds' in payload && Array.isArray(payload.targetIds)
    && payload.targetIds.every((id) => typeof id === 'string')) {
    return payload.targetIds as string[];
  }
  return undefined;
}

function eventMatches(entry: UncommittedRuleEvent, matcher: ScenarioEventMatcher): boolean {
  const payload = entry.payload;
  if (matcher.payloadType != null && payload.type !== matcher.payloadType) return false;
  if (matcher.sourceActorId != null && entry.sourceActorId !== matcher.sourceActorId) return false;
  if (matcher.actorId != null && payloadActorId(payload) !== matcher.actorId) return false;
  if (matcher.targetIds != null) {
    const actualTargetIds = payloadTargetIds(payload);
    if (!actualTargetIds
      || canonicalStringify(actualTargetIds) !== canonicalStringify(matcher.targetIds)) return false;
  }
  if (matcher.obligationIds != null
    && canonicalStringify(entry.obligationIds) !== canonicalStringify(matcher.obligationIds)) return false;
  if (matcher.includesObligationIds?.some((id) => !entry.obligationIds.includes(id))) return false;
  if (matcher.engineEventType != null) {
    if (payload.type !== 'EngineEventRecorded' || payload.event.type !== matcher.engineEventType) return false;
  }
  if (matcher.roll) {
    if (payload.type !== 'EngineEventRecorded' || payload.event.type !== 'roll') return false;
    if (matcher.roll.kind != null && payload.event.roll.kind !== matcher.roll.kind) return false;
    if (matcher.roll.outcome != null && payload.event.roll.outcome !== matcher.roll.outcome) return false;
  }
  if (matcher.payloadSubset != null && !deepSubsetMatches(matcher.payloadSubset, payload)) return false;
  return true;
}

function orderedEventIndices(
  events: readonly UncommittedRuleEvent[],
  matchers: readonly ScenarioEventMatcher[],
  contiguous: boolean,
  startIndex?: number,
): number[] | null {
  if (contiguous) {
    const starts = startIndex == null
      ? Array.from({ length: Math.max(0, events.length - matchers.length + 1) }, (_, index) => index)
      : [startIndex];
    for (const start of starts) {
      if (matchers.every((matcher, offset) => {
        const event = events[start + offset];
        return !!event && eventMatches(event, matcher);
      })) return matchers.map((_, offset) => start + offset);
    }
    return null;
  }

  const indices: number[] = [];
  let cursor = startIndex ?? 0;
  for (const [matcherIndex, matcher] of matchers.entries()) {
    if (matcherIndex === 0 && startIndex != null) {
      if (!events[startIndex] || !eventMatches(events[startIndex], matcher)) return null;
      indices.push(startIndex);
      cursor = startIndex + 1;
      continue;
    }
    let found = -1;
    for (let eventIndex = cursor; eventIndex < events.length; eventIndex += 1) {
      if (eventMatches(events[eventIndex], matcher)) {
        found = eventIndex;
        break;
      }
    }
    if (found < 0) return null;
    indices.push(found);
    cursor = found + 1;
  }
  return indices;
}

function assertScenarioStep(
  spec: ScenarioSpec,
  assertions: readonly ScenarioAssertion[],
  world: WorldState,
  stepEvents: readonly UncommittedRuleEvent[],
): void {
  for (const assertion of assertions) {
    let passed = false;
    let actual: unknown;
    if (assertion.type === 'equals') {
      actual = valueAtPath(world, assertion.path);
      passed = canonicalStringify(actual) === canonicalStringify(assertion.value);
    } else if (assertion.type === 'condition') {
      const actor = world.actors[assertion.actor];
      actual = actor.runtime.activeEffects.some((effect) => {
        const mechanics = effect.mechanics as Record<string, unknown>;
        return mechanics.kind === 'condition' && String(mechanics.value ?? '') === assertion.condition;
      });
      passed = actual === assertion.present;
    } else if (assertion.type === 'pending') {
      actual = world.pendingResolution?.type ?? null;
      passed = actual === assertion.pendingType;
    } else if (assertion.type === 'event') {
      const matcher: ScenarioEventMatcher = {
        ...(assertion.match ?? {}),
        ...(assertion.eventType ? { engineEventType: assertion.eventType } : {}),
      };
      const count = stepEvents.filter((entry) => eventMatches(entry, matcher)).length;
      actual = count;
      const minimum = assertion.exactly ?? assertion.minimum ?? (assertion.maximum == null ? 1 : 0);
      const maximum = assertion.exactly ?? assertion.maximum ?? Number.POSITIVE_INFINITY;
      passed = count >= minimum && count <= maximum;
    } else {
      actual = orderedEventIndices(
        stepEvents,
        assertion.matchers,
        assertion.contiguous ?? false,
        assertion.startIndex,
      );
      passed = actual !== null;
    }
    if (!passed) {
      throw new Error(`${spec.id}: assertion ${assertion.id} failed; actual=${canonicalStringify(actual)}`);
    }
  }
}

export function runScenario(
  spec: ScenarioSpec,
  fixtures: ScenarioFixtureProvider,
  env: ScenarioEnvironment,
): ScenarioRun {
  validateSpec(spec);
  const scenarioTape = spec.rollTape ? createStrictRngTape(spec.rollTape) : null;
  const rng = scenarioTape?.rng ?? env.rng;
  if (!rng) {
    throw new Error(`${spec.id}: ScenarioSpec.rollTape or an external deterministic RNG is required`);
  }
  const resolvedEnv: DeterministicEnvironment = { ...env, rng };
  const instantiated = instantiateScenarioState(spec, fixtures);
  const initialState = createWorld({
    id: spec.id,
    ruleset: spec.ruleset,
    actors: instantiated.actors,
    objects: instantiated.objects,
  });
  let session = new InMemoryRulesSession(initialState, fixtures.catalog, resolvedEnv);
  const events: UncommittedRuleEvent[] = [];
  const commands: GameCommand[] = [];
  const checkpoints: string[] = [];
  const assertionIds: string[] = [];
  const rejections: ScenarioRun['rejections'] = [];

  if (spec.autoStartEncounter !== false) {
    const startActor = spec.initiative[0];
    const startCommand: GameCommand = {
      ...baseCommand(spec, startActor, `${spec.id}:start`, 0),
      type: 'StartEncounter',
      initiative: spec.initiative,
    };
    commands.push(startCommand);
    const startResult = session.dispatch(startCommand);
    if (startResult.status !== 'accepted') throw new Error(`${spec.id}: StartEncounter rejected: ${startResult.code}`);
    events.push(...startResult.events);
  }

  for (const [index, step] of spec.steps.entries()) {
    assertionIds.push(...step.assertions.map((assertion) => assertion.id));
    if (step.do === 'checkpointReload') {
      const serialized = canonicalStringify(session.getState());
      checkpoints.push(serialized);
      session = new InMemoryRulesSession(JSON.parse(serialized) as WorldState, fixtures.catalog, resolvedEnv);
      assertScenarioStep(spec, step.assertions, session.getState(), []);
      continue;
    }
    const before = canonicalStringify(session.getState());
    const command = commandForStep(spec, step, index, session.getState());
    commands.push(command);
    const result = session.dispatch(command);
    if (result.status !== 'accepted') {
      if (step.expectedResult?.status !== 'rejected') {
        throw new Error(`${spec.id}: step ${index + 1} (${step.do}) rejected: ${result.code} — ${result.message}`);
      }
      if (result.code !== step.expectedResult.code) {
        throw new Error(
          `${spec.id}: step ${index + 1} (${step.do}) expected rejection ${step.expectedResult.code}; got ${result.code}`,
        );
      }
      if (step.expectedResult.messageIncludes != null
        && !result.message.includes(step.expectedResult.messageIncludes)) {
        throw new Error(
          `${spec.id}: step ${index + 1} (${step.do}) rejection message does not include `
          + canonicalStringify(step.expectedResult.messageIncludes),
        );
      }
      const after = canonicalStringify(session.getState());
      if (after !== before || canonicalStringify(result.state) !== before) {
        throw new Error(`${spec.id}: rejected step ${index + 1} mutated authoritative state`);
      }
      rejections.push({
        step: index + 1,
        action: step.do,
        code: result.code,
        message: result.message,
      });
      assertScenarioStep(spec, step.assertions, session.getState(), []);
      continue;
    }
    if (step.expectedResult?.status === 'rejected') {
      throw new Error(
        `${spec.id}: step ${index + 1} (${step.do}) was accepted; expected rejection ${step.expectedResult.code}`,
      );
    }
    events.push(...result.events);
    assertScenarioStep(spec, step.assertions, session.getState(), result.events);
  }

  const finalState = session.getState();
  const trace = observedTrace(events);
  const missingTrace = spec.requiredTrace.filter((required) => !trace.includes(required));
  if (missingTrace.length) throw new Error(`${spec.id}: missing required trace ${missingTrace.join(', ')}`);
  if (finalState.scene.mode !== 'encounter' || finalState.scene.round < 2) {
    throw new Error(`${spec.id}: scenario did not complete a full two-actor round`);
  }
  if (finalState.pendingResolution) {
    throw new Error(`${spec.id}: scenario ended with unresolved ${finalState.pendingResolution.type}`);
  }
  const endedActors = new Set(events.flatMap((entry) => {
    if (entry.payload.type !== 'EngineEventRecorded' || entry.payload.event.type !== 'turn_ended') return [];
    return [entry.payload.actorId];
  }));
  if (spec.initiative.some((actorId) => !endedActors.has(actorId))) {
    throw new Error(`${spec.id}: both actors must end their turn`);
  }
  scenarioTape?.assertExhausted();

  const replayState = foldEvents(initialState, events);
  if (canonicalStringify(replayState) !== canonicalStringify(finalState)) {
    throw new Error(`${spec.id}: event replay diverged from final state`);
  }
  return {
    initialState,
    finalState,
    commands,
    events,
    assertionIds,
    observedTrace: trace,
    checkpoints,
    replayState,
    rejections,
    rngConsumed: scenarioTape?.consumed() ?? null,
  };
}
