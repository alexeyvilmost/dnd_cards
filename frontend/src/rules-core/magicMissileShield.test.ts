import { describe, expect, it } from 'vitest';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { managedWorldSpellMechanics } from './testing/worldSpellPolicyFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'magic-missile-shield@1',
  contentHash: 'sha256:magic-missile-shield',
  errataVersion: 'PHB-2024',
};

const MAGIC_MISSILE: RuleActionDefinition = {
  id: 'spell.phb24.magic-missile',
  name: 'Magic Missile',
  kind: 'spell',
  sourceEntityIds: ['PHB24:SPELL-0174'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 3,
    rangeFt: 120,
    requiresLineOfSight: true,
    allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
  },
  mechanics: {
    name: 'Magic Missile',
    activation: {
      mode: 'active',
      cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    ...managedWorldSpellMechanics('magic_missile'),
    effects: [],
  },
};

const SHIELD: RuleActionDefinition = {
  id: 'spell.phb24.shield',
  name: 'Shield',
  kind: 'spell',
  sourceEntityIds: ['PHB24:SPELL-0317'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  mechanics: {
    name: 'Shield',
    activation: {
      mode: 'reaction',
      trigger: {
        event: 'hit_by_attack',
        events: ['hit_by_attack', 'targeted_by_magic_missile'],
      },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    effects: [{
      resolution: 'auto',
      who: 'self',
      result: [{
        kind: 'modifier',
        applies_to: { roll: 'ac' },
        op: 'add',
        value: '+5',
        duration: { type: 'until_start_of_next_turn' },
        magic_missile_immunity: true,
      }],
    }],
  },
};

const ACTIONS = [MAGIC_MISSILE, SHIELD];
const catalog: RulesCatalog = { getAction: (id) => ACTIONS.find((action) => action.id === id) };

function spellCastAuditPassive() {
  return {
    id: 'test:spell-cast-audit',
    name: 'Spell cast audit',
    activation: { mode: 'triggered', trigger: { event: 'spell_cast' } },
    effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }],
  };
}

function actor(id: string, options: {
  actionIds?: string[];
  passives?: Record<string, unknown>[];
  actionCount?: number;
  reactionCount?: number;
  slotCount?: number;
  hp?: number;
} = {}): ActorState {
  const actionCount = options.actionCount ?? 1;
  const reactionCount = options.reactionCount ?? 1;
  const slotCount = options.slotCount ?? 1;
  const hp = options.hp ?? 20;
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: 12,
    capabilities: { actionIds: options.actionIds ?? [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: hp, max: hp, temp: 0 },
      resources: {
        action: actionCount,
        bonus_action: 1,
        reaction: reactionCount,
        spell_slot_1: slotCount,
      },
      maxResources: {
        action: actionCount,
        bonus_action: 1,
        reaction: reactionCount,
        spell_slot_1: slotCount,
      },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    ...(options.passives ? { passives: options.passives } : {}),
  };
}

function enemyFacts(boardRevision = 1, distanceFt = 30): SpatialFacts {
  return {
    factsSource: 'board',
    boardRevision,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation: 'enemy',
  };
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

function acceptedEvents(result: ReturnType<InMemoryRulesSession['dispatch']>): UncommittedRuleEvent[] {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result.events;
}

function engineEntries(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [{ envelope: entry.payload, event: entry.payload.event }] : []
  ));
}

function resourceSpendCount(
  events: readonly UncommittedRuleEvent[],
  resource: string,
  actorId?: string,
): number {
  return engineEntries(events).filter(({ envelope, event }) => (
    (!actorId || envelope.actorId === actorId)
    && event.type === 'resource_spent'
    && event.resource === resource
  )).length;
}

function damageEntries(events: readonly UncommittedRuleEvent[]) {
  return engineEntries(events).flatMap(({ envelope, event }) => (
    event.type === 'damage' ? [{ envelope, event }] : []
  ));
}

function castCommand(input: {
  commandId: string;
  expectedRevision: number;
  actorId: string;
  targetIds: string[];
  dartTargetIds: string[];
  factsByTarget?: Record<string, SpatialFacts>;
  castLevel?: number;
}): Extract<GameCommand, { type: 'UseAction' }> {
  return {
    schemaVersion: 1,
    type: 'UseAction',
    commandId: input.commandId,
    expectedRevision: input.expectedRevision,
    rulesetContentHash: RULESET.contentHash,
    actorId: input.actorId,
    actionId: MAGIC_MISSILE.id,
    targetIds: input.targetIds,
    ...(input.factsByTarget ? { factsByTarget: input.factsByTarget } : {}),
    choices: { magic_missile_dart_targets: input.dartTargetIds },
    spell: { baseLevel: 1, castLevel: input.castLevel ?? 1, sourceClass: 'wizard' },
  };
}

function resolveReactionCommand(
  world: WorldState,
  commandId: string,
  actionId: string | null,
): Extract<GameCommand, { type: 'ResolveDecision' }> {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'magic_missile_reaction') {
    throw new Error('Expected a Magic Missile reaction');
  }
  return {
    schemaVersion: 1,
    type: 'ResolveDecision',
    commandId,
    expectedRevision: world.revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: pending.targetActorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: { kind: 'reaction', actionId },
  };
}

describe('PHB 2024 Magic Missile and Shield primitive', () => {
  it('changes dart count, damage formula, and damage type from policy without action identity dispatch', () => {
    const mutated = JSON.parse(JSON.stringify(MAGIC_MISSILE)) as RuleActionDefinition;
    const declared = managedWorldSpellMechanics('magic_missile');
    const policy = ((declared.primitive as Record<string, unknown>).policy as Record<string, unknown>);
    policy.max_slot_level = 1;
    policy.base_dart_count = 2;
    policy.per_dart_effect = {
      resolution: 'auto', who: 'target',
      result: [{ kind: 'damage', dice: '1d6 + 2', type: 'acid' }],
    };
    (declared.targeting as Record<string, unknown>).max_targets = 2;
    mutated.mechanics = { ...mutated.mechanics, ...declared };
    mutated.targeting = { ...mutated.targeting!, maxTargets: 2 };
    const mutatedCatalog: RulesCatalog = {
      getAction: (id) => (id === mutated.id ? mutated : undefined),
    };
    const wizard = actor('wizard', { actionIds: [mutated.id] });
    const target = actor('target');
    const initial = createWorld({
      id: 'missile-policy-mutation', ruleset: RULESET, actors: [wizard, target],
    });
    const tape = createStrictRngTape([
      { label: 'mutated dart 1', sides: 6, value: 1 },
      { label: 'mutated dart 2', sides: 6, value: 4 },
    ]);
    const session = new InMemoryRulesSession(initial, mutatedCatalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('mutated-missile'),
    });
    const result = acceptedEvents(session.dispatch(castCommand({
      commandId: 'mutated-missile-cast', expectedRevision: 0, actorId: wizard.id,
      targetIds: [target.id], dartTargetIds: [target.id, target.id],
      factsByTarget: { [target.id]: enemyFacts() },
    })));
    tape.assertExhausted();
    expect(session.getState().actors.target.runtime.hp.current).toBe(11);
    expect(damageEntries(result).map(({ event }) => ({
      amount: event.amount, damageType: event.damageType,
    }))).toEqual([
      { amount: 3, damageType: 'acid' },
      { amount: 6, damageType: 'acid' },
    ]);
  });

  it('auto-hits one target with three separate simultaneous d4+1 darts and pays/casts once', () => {
    const wizard = actor('wizard', {
      actionIds: [MAGIC_MISSILE.id],
      passives: [spellCastAuditPassive()],
    });
    const target = actor('target');
    const initial = createWorld({ id: 'missile-one-target', ruleset: RULESET, actors: [wizard, target] });
    const tape = createStrictRngTape([
      { label: 'dart 1', sides: 4, value: 1 },
      { label: 'dart 2', sides: 4, value: 2 },
      { label: 'dart 3', sides: 4, value: 4 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const spatial = { target: enemyFacts() };
    const events = acceptedEvents(session.dispatch(castCommand({
      commandId: 'missile-all-one',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [target.id],
      dartTargetIds: [target.id, target.id, target.id],
      factsByTarget: spatial,
    })));

    tape.assertExhausted();
    expect(session.getState().actors.target.runtime.hp.current).toBe(10);
    expect(session.getState().actors.wizard.runtime.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    expect(session.getState().actors.wizard.runtime.hp.temp).toBe(1);
    expect(resourceSpendCount(events, 'action', wizard.id)).toBe(1);
    expect(resourceSpendCount(events, 'spell_slot_1', wizard.id)).toBe(1);
    expect(engineEntries(events).filter(({ event }) => (
      event.type === 'narrative' && event.text === 'Сработало: Spell cast audit'
    ))).toHaveLength(1);
    expect(damageEntries(events).map(({ envelope, event }) => ({
      targets: envelope.targetIds,
      amount: event.amount,
      die: event.roll?.dice[0]?.result,
      facts: envelope.facts,
    }))).toEqual([
      {
        targets: ['target'], amount: 2, die: 1,
        facts: expect.objectContaining({
          magicMissile: { dartOrdinal: 1, simultaneous: true, shielded: false },
        }),
      },
      {
        targets: ['target'], amount: 3, die: 2,
        facts: expect.objectContaining({
          magicMissile: { dartOrdinal: 2, simultaneous: true, shielded: false },
        }),
      },
      {
        targets: ['target'], amount: 5, die: 4,
        facts: expect.objectContaining({
          magicMissile: { dartOrdinal: 3, simultaneous: true, shielded: false },
        }),
      },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actionId: MAGIC_MISSILE.id,
        targetIds: ['target'],
        facts: {
          spatialByTarget: spatial,
          magicMissileDartTargetIds: ['target', 'target', 'target'],
          simultaneous: true,
        },
      }),
    }));
    expect(foldEvents(initial, events)).toEqual(session.getState());
  });

  it('keeps the explicit 2+1 allocation order while accumulating each target state', () => {
    const wizard = actor('wizard', { actionIds: [MAGIC_MISSILE.id] });
    const targetA = actor('target-a');
    const targetB = actor('target-b');
    const initial = createWorld({ id: 'missile-two-plus-one', ruleset: RULESET, actors: [wizard, targetA, targetB] });
    const tape = createStrictRngTape([
      { label: 'target A dart 1', sides: 4, value: 1 },
      { label: 'target A dart 2', sides: 4, value: 2 },
      { label: 'target B dart', sides: 4, value: 3 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const events = acceptedEvents(session.dispatch(castCommand({
      commandId: 'missile-two-plus-one',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [targetA.id, targetB.id],
      dartTargetIds: [targetA.id, targetA.id, targetB.id],
      factsByTarget: { [targetA.id]: enemyFacts(4, 40), [targetB.id]: enemyFacts(4, 80) },
    })));

    tape.assertExhausted();
    expect(session.getState().actors[targetA.id].runtime.hp.current).toBe(15);
    expect(session.getState().actors[targetB.id].runtime.hp.current).toBe(16);
    expect(damageEntries(events).map(({ envelope, event }) => [envelope.targetIds[0], event.amount]))
      .toEqual([[targetA.id, 2], [targetA.id, 3], [targetB.id, 4]]);
    expect(resourceSpendCount(events, 'action')).toBe(1);
    expect(resourceSpendCount(events, 'spell_slot_1')).toBe(1);
  });

  it('lets one target decline Shield, then rolls and applies every allocated dart without reaction cost', () => {
    const wizard = actor('wizard', { actionIds: [MAGIC_MISSILE.id] });
    const defender = actor('defender', { actionIds: [SHIELD.id] });
    const initial = createWorld({ id: 'missile-decline', ruleset: RULESET, actors: [wizard, defender] });
    const tape = createStrictRngTape([
      { label: 'declined dart 1', sides: 4, value: 1 },
      { label: 'declined dart 2', sides: 4, value: 2 },
      { label: 'declined dart 3', sides: 4, value: 3 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const openingEvents = acceptedEvents(session.dispatch(castCommand({
      commandId: 'missile-decline-open',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [defender.id],
      dartTargetIds: [defender.id, defender.id, defender.id],
      factsByTarget: { [defender.id]: enemyFacts() },
    })));

    expect(tape.consumed()).toBe(0);
    expect(session.getState().actors[defender.id].runtime.hp.current).toBe(20);
    expect(session.getState().pendingResolution).toMatchObject({
      type: 'magic_missile_reaction',
      targetActorId: defender.id,
      request: {
        actorId: defender.id,
        trigger: { type: 'targeted_by_magic_missile', dartCount: 3 },
        options: [{ actionId: SHIELD.id }],
      },
    });
    const defenderResources = { ...session.getState().actors[defender.id].runtime.resources };
    const declineEvents = acceptedEvents(session.dispatch(resolveReactionCommand(
      session.getState(),
      'missile-decline-response',
      null,
    )));

    tape.assertExhausted();
    expect(session.getState().pendingResolution).toBeNull();
    expect(session.getState().actors[defender.id].runtime.hp.current).toBe(11);
    expect(session.getState().actors[defender.id].runtime.resources).toEqual(defenderResources);
    expect(session.getState().actors[defender.id].runtime.activeEffects).toEqual([]);
    expect(damageEntries(declineEvents).map(({ event }) => event.amount)).toEqual([2, 3, 4]);
    expect(resourceSpendCount([...openingEvents, ...declineEvents], 'reaction', defender.id)).toBe(0);
    expect(resourceSpendCount([...openingEvents, ...declineEvents], 'spell_slot_1', defender.id)).toBe(0);
  });

  it('honors an already-active Shield without reopening a reaction or consuming damage RNG', () => {
    const wizard = actor('wizard', { actionIds: [MAGIC_MISSILE.id] });
    const protectedTarget = actor('protected');
    protectedTarget.runtime.activeEffects = [{
      id: 'shield:active',
      name: 'Shield',
      mechanics: {
        kind: 'modifier',
        applies_to: { roll: 'ac' },
        op: 'add',
        value: '+5',
        magic_missile_immunity: true,
      },
      expiry: 'start_of_next_turn',
      source: SHIELD.id,
      sourceId: protectedTarget.id,
      ownerId: protectedTarget.id,
    }];
    const initial = createWorld({
      id: 'missile-existing-shield',
      ruleset: RULESET,
      actors: [wizard, protectedTarget],
    });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('an active Shield must block before damage RNG'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const events = acceptedEvents(session.dispatch(castCommand({
      commandId: 'missile-existing-shield',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [protectedTarget.id],
      dartTargetIds: [protectedTarget.id, protectedTarget.id, protectedTarget.id],
      factsByTarget: { [protectedTarget.id]: enemyFacts() },
    })));

    expect(session.getState().pendingResolution).toBeNull();
    expect(session.getState().actors[protectedTarget.id].runtime.hp.current).toBe(20);
    expect(damageEntries(events)).toEqual([]);
    expect(engineEntries(events).filter(({ event }) => (
      event.type === 'narrative' && event.text.startsWith('Shield blocks Magic Missile dart')
    ))).toHaveLength(3);
    expect(resourceSpendCount(events, 'action', wizard.id)).toBe(1);
    expect(resourceSpendCount(events, 'spell_slot_1', wizard.id)).toBe(1);
  });

  it('applies unshielded Magic Missile damage when the caster allocates darts to self', () => {
    const wizard = actor('wizard', { actionIds: [MAGIC_MISSILE.id] });
    const initial = createWorld({ id: 'missile-unshielded-self', ruleset: RULESET, actors: [wizard] });
    const tape = createStrictRngTape([
      { label: 'self dart 1', sides: 4, value: 1 },
      { label: 'self dart 2', sides: 4, value: 2 },
      { label: 'self dart 3', sides: 4, value: 3 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const events = acceptedEvents(session.dispatch(castCommand({
      commandId: 'missile-unshielded-self',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [wizard.id],
      dartTargetIds: [wizard.id, wizard.id, wizard.id],
      factsByTarget: {
        [wizard.id]: { ...enemyFacts(), distanceFt: 0, relation: 'self' },
      },
    })));

    tape.assertExhausted();
    expect(session.getState().actors[wizard.id].runtime.hp.current).toBe(11);
    expect(session.getState().actors[wizard.id].runtime.resources).toMatchObject({
      action: 0,
      spell_slot_1: 0,
    });
    expect(damageEntries(events).map(({ event }) => event.amount)).toEqual([2, 3, 4]);
    expect(resourceSpendCount(events, 'action', wizard.id)).toBe(1);
    expect(resourceSpendCount(events, 'spell_slot_1', wizard.id)).toBe(1);
  });

  it('serializes two Shield choices, blocks every dart on accept, damages declined targets, and replays byte-identically', () => {
    const wizard = actor('wizard', {
      actionIds: [MAGIC_MISSILE.id],
      passives: [spellCastAuditPassive()],
    });
    const shielded = actor('shielded', { actionIds: [SHIELD.id] });
    const declined = actor('declined', { actionIds: [SHIELD.id] });
    const initial = createWorld({
      id: 'missile-serial-shields',
      ruleset: RULESET,
      actors: [wizard, shielded, declined],
    });
    const tape = createStrictRngTape([{ label: 'declined target dart', sides: 4, value: 4 }]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused-before-reload'),
    });
    const openingEvents = acceptedEvents(session.dispatch(castCommand({
      commandId: 'missile-serial-open',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [shielded.id, declined.id],
      dartTargetIds: [shielded.id, shielded.id, declined.id],
      factsByTarget: { [shielded.id]: enemyFacts(8, 20), [declined.id]: enemyFacts(8, 60) },
    })));
    expect(tape.consumed()).toBe(0);
    expect(session.getState().pendingResolution).toMatchObject({
      type: 'magic_missile_reaction',
      targetActorId: shielded.id,
      request: { trigger: { type: 'targeted_by_magic_missile', dartCount: 2 } },
      remainingReactions: [{ targetActorId: declined.id }],
    });
    expect(openingEvents).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actionId: MAGIC_MISSILE.id,
        targetIds: [shielded.id, declined.id],
        facts: expect.objectContaining({
          magicMissileDartTargetIds: [shielded.id, shielded.id, declined.id],
          simultaneous: true,
        }),
      }),
    }));

    const acceptedShieldEvents = acceptedEvents(session.dispatch(resolveReactionCommand(
      session.getState(),
      'missile-serial-accept',
      SHIELD.id,
    )));
    expect(tape.consumed()).toBe(0);
    expect(session.getState().actors[shielded.id].runtime.resources).toMatchObject({
      reaction: 0,
      spell_slot_1: 0,
    });
    expect(session.getState().actors[shielded.id].runtime.activeEffects).toEqual([
      expect.objectContaining({
        expiry: 'start_of_next_turn',
        mechanics: expect.objectContaining({
          applies_to: { roll: 'ac' },
          op: 'add',
          value: '+5',
          magic_missile_immunity: true,
        }),
      }),
    ]);
    expect(session.getState().pendingResolution).toMatchObject({
      type: 'magic_missile_reaction',
      targetActorId: declined.id,
      protectedTargetIds: [shielded.id],
      request: { trigger: { type: 'targeted_by_magic_missile', dartCount: 1 } },
    });

    const checkpoint = JSON.parse(JSON.stringify(session.getState())) as WorldState;
    const beforeStale = session.getState();
    const currentPending = beforeStale.pendingResolution;
    if (!currentPending || currentPending.type !== 'magic_missile_reaction') {
      throw new Error('Expected the second serialized reaction');
    }
    const stale = session.dispatch(command({
      ...resolveReactionCommand(beforeStale, 'missile-serial-stale', null),
      requestId: `${currentPending.request.id}:stale`,
    }));
    expect(stale).toMatchObject({ status: 'rejected', code: 'StaleDecision' });
    expect(session.getState()).toBe(beforeStale);
    expect(tape.consumed()).toBe(0);

    const declineCommand = resolveReactionCommand(session.getState(), 'missile-serial-decline', null);
    const declinedEvents = acceptedEvents(session.dispatch(declineCommand));
    tape.assertExhausted();
    const final = session.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors[shielded.id].runtime.hp.current).toBe(20);
    expect(final.actors[declined.id].runtime.hp.current).toBe(15);
    expect(final.actors[declined.id].runtime.resources).toMatchObject({ reaction: 1, spell_slot_1: 1 });
    expect(damageEntries(declinedEvents).map(({ envelope, event }) => ({
      targetIds: envelope.targetIds,
      amount: event.amount,
      damageType: event.damageType,
      dice: event.roll?.dice,
      facts: envelope.facts,
    }))).toEqual([{
      targetIds: [declined.id],
      amount: 5,
      damageType: 'force',
      dice: [expect.objectContaining({ sides: 4, result: 4 })],
      facts: expect.objectContaining({
        magicMissile: { dartOrdinal: 3, simultaneous: true, shielded: false },
      }),
    }]);
    const blockedDarts = engineEntries(declinedEvents).filter(({ envelope, event }) => (
      envelope.targetIds[0] === shielded.id
      && event.type === 'narrative'
      && event.text.startsWith('Shield blocks Magic Missile dart')
    ));
    expect(blockedDarts).toHaveLength(2);
    expect(blockedDarts.map(({ envelope }) => envelope.facts)).toEqual([
      expect.objectContaining({
        magicMissile: { dartOrdinal: 1, simultaneous: true, shielded: true },
      }),
      expect.objectContaining({
        magicMissile: { dartOrdinal: 2, simultaneous: true, shielded: true },
      }),
    ]);

    const allEvents = [...openingEvents, ...acceptedShieldEvents, ...declinedEvents];
    expect(resourceSpendCount(allEvents, 'action', wizard.id)).toBe(1);
    expect(resourceSpendCount(allEvents, 'spell_slot_1', wizard.id)).toBe(1);
    expect(resourceSpendCount(allEvents, 'reaction', shielded.id)).toBe(1);
    expect(resourceSpendCount(allEvents, 'spell_slot_1', shielded.id)).toBe(1);
    expect(resourceSpendCount(allEvents, 'reaction', declined.id)).toBe(0);
    expect(engineEntries(allEvents).filter(({ event }) => (
      event.type === 'narrative' && event.text === 'Сработало: Spell cast audit'
    ))).toHaveLength(1);
    expect(allEvents.filter((event) => event.payload.type === 'ActionDeclared')).toHaveLength(2);
    expect(allEvents.filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(2);
    expect(allEvents.filter((event) => event.payload.type === 'ResolutionClosed')).toHaveLength(2);
    expect(foldEvents(initial, allEvents)).toEqual(final);

    const duplicateState = session.getState();
    const duplicate = session.dispatch(declineCommand);
    expect(duplicate).toMatchObject({ status: 'rejected', code: 'DuplicateCommand' });
    expect(session.getState()).toBe(duplicateState);

    const replayTape = createStrictRngTape([{ label: 'replayed declined target dart', sides: 4, value: 4 }]);
    const replay = new InMemoryRulesSession(JSON.parse(JSON.stringify(checkpoint)) as WorldState, catalog, {
      rng: replayTape.rng,
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: createSequentialIdFactory('different-hidden-id-state'),
    });
    const replayEvents = acceptedEvents(replay.dispatch(resolveReactionCommand(
      replay.getState(),
      'missile-serial-decline',
      null,
    )));
    replayTape.assertExhausted();
    expect(replayEvents).toEqual(declinedEvents);
    expect(replay.getState()).toEqual(final);
    expect(JSON.stringify(replayEvents)).toBe(JSON.stringify(declinedEvents));
    expect(JSON.stringify(replay.getState())).toBe(JSON.stringify(final));

    const corruptCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as WorldState;
    if (!corruptCheckpoint.pendingResolution
      || corruptCheckpoint.pendingResolution.type !== 'magic_missile_reaction') {
      throw new Error('Expected checkpointed Magic Missile reaction');
    }
    corruptCheckpoint.pendingResolution.protectedTargetIds.push(shielded.id);
    const corrupt = new InMemoryRulesSession(corruptCheckpoint, catalog, {
      rng: () => { throw new Error('corrupt continuation must not consume RNG'); },
      clock: createLogicalClock(corruptCheckpoint.logicalClock),
      nextId: createSequentialIdFactory('unused-corrupt'),
    });
    const corruptBefore = corrupt.getState();
    const corruptResult = corrupt.dispatch(resolveReactionCommand(
      corruptBefore,
      'missile-serial-corrupt',
      null,
    ));
    expect(corruptResult).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    expect(corrupt.getState()).toBe(corruptBefore);
  });

  it('rejects invalid allocation, target sets, and spatial facts before costs or RNG', () => {
    const wizard = actor('wizard', { actionIds: [MAGIC_MISSILE.id] });
    const targetA = actor('target-a');
    const targetB = actor('target-b');
    const baseFacts = { [targetA.id]: enemyFacts(), [targetB.id]: enemyFacts() };
    const base = castCommand({
      commandId: 'invalid-base',
      expectedRevision: 0,
      actorId: wizard.id,
      targetIds: [targetA.id, targetB.id],
      dartTargetIds: [targetA.id, targetA.id, targetB.id],
      factsByTarget: baseFacts,
    });
    const cases: Array<{
      name: string;
      expectedCode: string;
      command: Extract<GameCommand, { type: 'UseAction' }>;
    }> = [
      {
        name: 'missing allocation',
        expectedCode: 'InvalidTargets',
        command: { ...base, commandId: 'invalid-missing-allocation', choices: {} },
      },
      {
        name: 'wrong dart count',
        expectedCode: 'InvalidTargets',
        command: {
          ...base,
          commandId: 'invalid-dart-count',
          choices: { magic_missile_dart_targets: [targetA.id, targetB.id] },
        },
      },
      {
        name: 'allocation and unique target order disagree',
        expectedCode: 'InvalidTargets',
        command: {
          ...base,
          commandId: 'invalid-order',
          targetIds: [targetB.id, targetA.id],
        },
      },
      {
        name: 'duplicate unique target ids',
        expectedCode: 'InvalidTargets',
        command: { ...base, commandId: 'invalid-duplicate-target', targetIds: [targetA.id, targetA.id] },
      },
      {
        name: 'unknown allocated target',
        expectedCode: 'ActorNotFound',
        command: {
          ...base,
          commandId: 'invalid-unknown',
          targetIds: [targetA.id, 'missing'],
          choices: { magic_missile_dart_targets: [targetA.id, targetA.id, 'missing'] },
          factsByTarget: { ...baseFacts, missing: enemyFacts() },
        },
      },
      {
        name: 'missing target facts',
        expectedCode: 'MissingSpatialFacts',
        command: {
          ...base,
          commandId: 'invalid-missing-facts',
          factsByTarget: { [targetA.id]: enemyFacts() },
        },
      },
      {
        name: 'out of range',
        expectedCode: 'OutOfRange',
        command: {
          ...base,
          commandId: 'invalid-range',
          factsByTarget: { ...baseFacts, [targetB.id]: enemyFacts(1, 125) },
        },
      },
      {
        name: 'line of sight blocked',
        expectedCode: 'LineOfSightBlocked',
        command: {
          ...base,
          commandId: 'invalid-los',
          factsByTarget: {
            ...baseFacts,
            [targetB.id]: { ...enemyFacts(), lineOfSight: false, cover: 'total' },
          },
        },
      },
      {
        name: 'upcast outside micro-MVP',
        expectedCode: 'InvalidTargets',
        command: { ...base, commandId: 'invalid-upcast', spell: { baseLevel: 1, castLevel: 2 } },
      },
    ];

    for (const scenario of cases) {
      const initial = createWorld({
        id: `missile-${scenario.name}`,
        ruleset: RULESET,
        actors: [wizard, targetA, targetB],
      });
      const session = new InMemoryRulesSession(initial, catalog, {
        rng: () => { throw new Error(`${scenario.name} must not consume RNG`); },
        clock: createLogicalClock(),
        nextId: createSequentialIdFactory('unused'),
      });
      const result = session.dispatch(scenario.command);
      expect(result, scenario.name).toMatchObject({ status: 'rejected', code: scenario.expectedCode });
      expect(session.getState(), scenario.name).toBe(initial);
      expect(session.getEvents(), scenario.name).toEqual([]);
      expect(session.getState().actors.wizard.runtime.resources, scenario.name)
        .toMatchObject({ action: 1, spell_slot_1: 1 });
    }
  });
});
