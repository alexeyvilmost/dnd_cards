import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1Overlay,
} from '../canon/microMvpL1Overlay';
import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import type { EngineEvent } from '../mvp/contracts';
import type {
  ActorState,
  CommandResult,
  GameCommand,
  RuleActionDefinition,
  SpatialFacts,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createStrictRngTape } from './determinism';
import type { DieTapeEntry, StrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

type AcceptedCommand = Extract<CommandResult, { status: 'accepted' }>;

interface CompiledAreaSpell {
  root: CompiledMicroMvpL1Root;
  entityId: string;
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
}

interface Harness {
  initial: WorldState;
  session: InMemoryRulesSession;
  tape: StrictRngTape;
}

let provider: CompiledMicroMvpL1Provider;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compiledAreaSpell(cardNumber: 'SPELL-0242' | 'SPELL-0171'): CompiledAreaSpell {
  for (const root of [...provider.roots]
    .filter((candidate) => candidate.matrixCase.klass.card_number === 'CLASS-wizard')
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))) {
    const entity = root.assembled.spells.find((spell) => spell.card_number === cardNumber);
    if (!entity) continue;
    const action = root.rulesActions.find((candidate): candidate is Extract<
      RuleActionDefinition,
      { kind: 'spell' }
    > => candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id));
    if (action) return { root, entityId: entity.id, action };
  }
  throw new Error(`No compiled Wizard action for ${cardNumber}`);
}

function actor(
  root: CompiledMicroMvpL1Root,
  id: string,
  actionIds: readonly string[],
  abilityMods: Partial<ActorState['character']['abilityMods']> = {},
): ActorState {
  const result = copy(root.actor);
  result.id = id;
  result.name = id;
  result.controllerId = `${id}:controller`;
  result.capabilities = { actionIds: [...actionIds] };
  result.passives = [];
  result.character = {
    ...result.character,
    abilityMods: { ...result.character.abilityMods, ...abilityMods },
    saveProficiencies: [],
  };
  result.runtime = {
    ...result.runtime,
    hp: { current: 40, max: 40, temp: 0 },
    resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
    maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
    equipment: {},
    inventory: [],
    activeEffects: [],
    firedThisTurn: [],
    firedThisRest: [],
  };
  return result;
}

function areaFacts(relation: SpatialFacts['relation'], distanceFt: number): SpatialFacts {
  return {
    factsSource: 'board',
    boardRevision: 41,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation,
  };
}

function harness(
  id: string,
  spell: CompiledAreaSpell,
  dice: readonly DieTapeEntry[],
  objects: WorldState['objects'][string][],
): Harness {
  const source = actor(spell.root, 'caster', [spell.action.id], { int: 3 });
  source.character.spellcastingMod = 3;
  const initial = createWorld({
    id,
    ruleset: provider.ruleset,
    actors: [
      source,
      actor(spell.root, 'failed-save-target', [], { dex: 0, con: 0 }),
      actor(spell.root, 'successful-save-target', [], { dex: 0, con: 0 }),
      actor(spell.root, 'outside-area-target', [], { dex: 0, con: 0 }),
    ],
    objects,
  });
  const tape = createStrictRngTape(dice);
  return {
    initial: copy(initial),
    tape,
    session: new InMemoryRulesSession(initial, provider.catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: () => {
        throw new Error('Persisted IDs must be command-derived');
      },
    }),
  };
}

function accepted(
  session: InMemoryRulesSession,
  command: Record<string, unknown>,
): AcceptedCommand {
  const result = session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: provider.ruleset.contentHash,
    ...command,
  } as GameCommand);
  if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function resolveSave(
  session: InMemoryRulesSession,
  commandId: string,
  d20: number,
): AcceptedCommand {
  const pending = session.getState().pendingResolution;
  if (!pending || pending.type !== 'target_save') throw new Error('Expected target-save continuation');
  return accepted(session, {
    type: 'ResolveDecision',
    commandId,
    actorId: pending.targetActorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: d20 }] } },
  });
}

function recorded(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded'
      ? [{ envelope: event.payload, event: event.payload.event }]
      : []
  ));
}

function resourceSpendCount(events: readonly UncommittedRuleEvent[], resource: string): number {
  return recorded(events).filter(({ event }) => (
    event.type === 'resource_spent' && event.resource === resource
  )).length;
}

function damageRecords(events: readonly UncommittedRuleEvent[]) {
  return recorded(events).filter((entry): entry is typeof entry & {
    event: Extract<EngineEvent, { type: 'damage' }>;
  } => entry.event.type === 'damage');
}

describe('compiled micro-MVP area spell semantics', () => {
  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
  }, 60_000);

  it('executes compiled Burning Hands once for every explicit area target with one shared 3d6 Fire roll and floor-half success damage across JSON reload', () => {
    const spell = compiledAreaSpell('SPELL-0242');
    expect(spell.action.sourceEntityIds).toContain(spell.entityId);
    expect(spell.action.mechanics).toMatchObject({
      primitive: { type: 'burning_hands_objects' },
      activation: {
        cost: [
          { resource: 'action' },
          { resource: 'spell_slot', level: 1, amount: 1 },
        ],
      },
      effects: [{
        resolution: 'save', who: 'target', ability: 'dex',
        on_fail: [{ kind: 'damage', dice: '3d6', type: 'fire' }],
        on_success: [{ kind: 'damage', dice: '3d6', type: 'fire', on_success: 'half' }],
      }],
    });
    expect(spell.action.targeting).toMatchObject({ minTargets: 0, maxTargets: 8, rangeFt: 15 });

    const test = harness('compiled-burning-hands', spell, [
      { label: 'Burning Hands d6 one', sides: 6, value: 1 },
      { label: 'Burning Hands d6 two', sides: 6, value: 2 },
      { label: 'Burning Hands d6 three', sides: 6, value: 4 },
    ], [
      { id: 'curtain', name: 'Curtain', kind: 'environment', size: 'large', flammable: true },
      { id: 'outside-banner', name: 'Outside banner', kind: 'environment', size: 'large', flammable: true },
    ]);
    const allEvents: UncommittedRuleEvent[] = [];
    const opening = accepted(test.session, {
      type: 'UseAction', commandId: 'burning:cast', actorId: 'caster',
      actionId: spell.action.id,
      targetIds: ['failed-save-target', 'successful-save-target'],
      factsByTarget: {
        'failed-save-target': areaFacts('enemy', 5),
        'successful-save-target': areaFacts('enemy', 15),
      },
      spell: { baseLevel: 1 },
      worldInput: {
        type: 'area_objects',
        factsByObject: {
          curtain: {
            factsSource: 'board', boardRevision: 41, distanceFt: 10,
            lineOfSight: true, inArea: true,
          },
          'outside-banner': {
            factsSource: 'board', boardRevision: 41, distanceFt: 20,
            lineOfSight: true, inArea: false,
          },
        },
      },
    });
    allEvents.push(...opening.events);
    expect(opening.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actionId: spell.action.id,
        targetIds: ['failed-save-target', 'successful-save-target'],
        facts: expect.objectContaining({
          spatialByTarget: {
            'failed-save-target': areaFacts('enemy', 5),
            'successful-save-target': areaFacts('enemy', 15),
          },
        }),
      }),
    }));
    expect(test.session.getState()).toMatchObject({
      actors: {
        caster: { runtime: { resources: { action: 0, spell_slot_1: 0 } } },
        'failed-save-target': { runtime: { hp: { current: 40 } } },
        'successful-save-target': { runtime: { hp: { current: 40 } } },
        'outside-area-target': { runtime: { hp: { current: 40 } } },
      },
      objects: {
        curtain: { ignited: true },
        'outside-banner': { flammable: true },
      },
      pendingResolution: {
        type: 'target_save', targetActorId: 'failed-save-target',
        remainingTargets: [{ targetActorId: 'successful-save-target' }],
        sharedDamageRolls: [],
      },
    });
    expect(test.session.getState().objects['outside-banner'].ignited).toBeUndefined();

    const failed = resolveSave(test.session, 'burning:failed-save', 1);
    allEvents.push(...failed.events);
    expect(test.session.getState().actors['failed-save-target'].runtime.hp.current).toBe(33);
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      targetActorId: 'successful-save-target',
      resolvedTargetIds: ['failed-save-target'],
      remainingTargets: [],
      sharedDamageRolls: [
        { sides: 6, value: 1 },
        { sides: 6, value: 2 },
        { sides: 6, value: 4 },
      ],
    });
    test.tape.assertExhausted();

    const checkpoint = copy(test.session.getState());
    const resumed = new InMemoryRulesSession(copy(checkpoint), provider.catalog, {
      rng: () => { throw new Error('Persisted shared damage must not reroll'); },
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: () => { throw new Error('Persisted IDs must be command-derived'); },
    });
    const succeeded = resolveSave(resumed, 'burning:successful-save', 20);
    allEvents.push(...succeeded.events);
    expect(resumed.getState().pendingResolution).toBeNull();
    expect(resumed.getState().actors['successful-save-target'].runtime.hp.current).toBe(37);
    expect(resumed.getState().actors['outside-area-target'].runtime.hp.current).toBe(40);

    const damages = damageRecords(allEvents);
    expect(damages.map(({ envelope }) => envelope.targetIds)).toEqual([
      ['failed-save-target'],
      ['successful-save-target'],
    ]);
    expect(damages.map(({ event }) => ({
      amount: event.amount,
      type: event.damageType,
      dice: event.roll?.dice,
    }))).toEqual([
      {
        amount: 7,
        type: 'fire',
        dice: [{ sides: 6, result: 1 }, { sides: 6, result: 2 }, { sides: 6, result: 4 }],
      },
      {
        amount: 3,
        type: 'fire',
        dice: [{ sides: 6, result: 1 }, { sides: 6, result: 2 }, { sides: 6, result: 4 }],
      },
    ]);
    expect(resourceSpendCount(allEvents, 'action')).toBe(1);
    expect(resourceSpendCount(allEvents, 'spell_slot_1')).toBe(1);
    expect(recorded(allEvents).filter(({ event }) => (
      event.type === 'roll' && event.roll.kind === 'save'
    ))).toHaveLength(2);

    const replay = new InMemoryRulesSession(copy(checkpoint), provider.catalog, {
      rng: () => { throw new Error('Replay must use persisted shared damage'); },
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: () => { throw new Error('Persisted IDs must be command-derived'); },
    });
    const replayed = resolveSave(replay, 'burning:successful-save', 20);
    expect(copy(replayed.events)).toEqual(copy(succeeded.events));
    expect(copy(replay.getState())).toEqual(copy(resumed.getState()));
    expect(foldEvents(copy(test.initial), copy(allEvents))).toEqual(copy(resumed.getState()));
  });

  it('executes compiled Thunderwave as one shared 2d8 Thunder roll and pushes only creatures that fail the Constitution save', () => {
    const spell = compiledAreaSpell('SPELL-0171');
    expect(spell.action.sourceEntityIds).toContain(spell.entityId);
    expect(spell.action.mechanics).toMatchObject({
      primitive: {
        type: 'area_object_push',
        object_push_distance_ft: 10,
        object_max_distance_ft: 15,
        object_area_requirement: 'entirely_in_area',
        exclude_secured_objects: true,
        exclude_carried_objects: true,
      },
      effects: [{
        resolution: 'save', who: 'target', ability: 'con',
        on_fail: [
          {
            kind: 'damage', dice: '2d8', type: 'thunder',
            scaling: { dice: '1d8', per: 'spell_slot_above' },
          },
          { kind: 'movement', value: 'push', distance: 10 },
        ],
        on_success: [{ kind: 'damage', dice: '2d8', type: 'thunder', on_success: 'half' }],
      }],
    });

    const test = harness('compiled-thunderwave', spell, [
      { label: 'Thunderwave d8 one', sides: 8, value: 4 },
      { label: 'Thunderwave d8 two', sides: 8, value: 5 },
    ], [
      { id: 'crate', name: 'Crate', kind: 'environment', size: 'medium', secured: false },
      { id: 'outside-crate', name: 'Outside crate', kind: 'environment', size: 'medium', secured: false },
    ]);
    const allEvents: UncommittedRuleEvent[] = [];
    const opening = accepted(test.session, {
      type: 'UseAction', commandId: 'thunder:cast', actorId: 'caster',
      actionId: spell.action.id,
      targetIds: ['failed-save-target', 'successful-save-target'],
      factsByTarget: {
        'failed-save-target': areaFacts('enemy', 10),
        'successful-save-target': areaFacts('ally', 15),
      },
      spell: { baseLevel: 1 },
      worldInput: {
        type: 'area_objects',
        factsByObject: {
          crate: {
            factsSource: 'gm_ruling', boardRevision: 41, distanceFt: 10,
            lineOfSight: true, entirelyInArea: true,
          },
          'outside-crate': {
            factsSource: 'gm_ruling', boardRevision: 41, distanceFt: 15,
            lineOfSight: true, entirelyInArea: false,
          },
        },
      },
    });
    allEvents.push(...opening.events);
    expect(test.session.getState().objects.crate.displacementFt).toBe(10);
    expect(test.session.getState().objects['outside-crate'].displacementFt).toBeUndefined();
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      request: { actorId: 'failed-save-target', ability: 'con', dc: 13 },
      remainingTargets: [{ targetActorId: 'successful-save-target' }],
    });

    const failed = resolveSave(test.session, 'thunder:failed-save', 1);
    allEvents.push(...failed.events);
    const succeeded = resolveSave(test.session, 'thunder:successful-save', 20);
    allEvents.push(...succeeded.events);
    test.tape.assertExhausted();

    expect(test.session.getState().actors['failed-save-target'].runtime.hp.current).toBe(31);
    expect(test.session.getState().actors['successful-save-target'].runtime.hp.current).toBe(36);
    expect(test.session.getState().actors['outside-area-target'].runtime.hp.current).toBe(40);
    const damages = damageRecords(allEvents);
    expect(damages.map(({ envelope }) => envelope.targetIds)).toEqual([
      ['failed-save-target'],
      ['successful-save-target'],
    ]);
    expect(damages.map(({ event }) => ({
      amount: event.amount,
      type: event.damageType,
      dice: event.roll?.dice,
    }))).toEqual([
      {
        amount: 9,
        type: 'thunder',
        dice: [{ sides: 8, result: 4 }, { sides: 8, result: 5 }],
      },
      {
        amount: 4,
        type: 'thunder',
        dice: [{ sides: 8, result: 4 }, { sides: 8, result: 5 }],
      },
    ]);
    const pushes = recorded(allEvents).filter(({ event }) => (
      event.type === 'movement' && event.mode === 'push' && event.distanceFt === 10
    ));
    expect(pushes.map(({ envelope }) => envelope.targetIds)).toEqual([['failed-save-target']]);
    expect(resourceSpendCount(allEvents, 'action')).toBe(1);
    expect(resourceSpendCount(allEvents, 'spell_slot_1')).toBe(1);
    expect(recorded(allEvents).filter(({ event }) => (
      event.type === 'roll' && event.roll.kind === 'save'
    ))).toHaveLength(2);
    expect(foldEvents(copy(test.initial), copy(allEvents))).toEqual(copy(test.session.getState()));
  });

  it('rejects duplicate compiled area targets before spending action or spell slot', () => {
    const spell = compiledAreaSpell('SPELL-0242');
    const test = harness('compiled-area-duplicate', spell, [], []);
    const result = test.session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'burning:duplicate',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'caster',
      actionId: spell.action.id,
      targetIds: ['failed-save-target', 'failed-save-target'],
      factsByTarget: { 'failed-save-target': areaFacts('enemy', 5) },
      spell: { baseLevel: 1 },
      worldInput: { type: 'area_objects', factsByObject: {} },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'InvalidTargets' });
    expect(test.session.getState()).toEqual(test.initial);
    expect(test.session.getEvents()).toEqual([]);
    test.tape.assertExhausted();
  });
});
