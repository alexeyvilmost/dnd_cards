import { readFileSync } from 'node:fs';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Action } from '../types';
import { describe, expect, it } from 'vitest';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'damage-reaction-test@1',
  contentHash: 'sha256:damage-reaction-test',
  errataVersion: '2024',
};

const STRIKE: RuleActionDefinition = {
  id: 'action.heavy-strike',
  name: 'Heavy Strike',
  kind: 'nonSpell',
  sourceEntityIds: ['entity:heavy-strike'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Heavy Strike',
    activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
    effects: [{
      resolution: 'attack_roll',
      ability: 'str',
      on_hit: [{ kind: 'damage', dice: '1d8', type: 'bludgeoning', ability: 'none' }],
    }],
  },
};

const DAMAGE_PULSE: RuleActionDefinition = {
  id: 'action.damage-pulse',
  name: 'Damage Pulse',
  kind: 'nonSpell',
  sourceEntityIds: ['entity:damage-pulse'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Damage Pulse',
    activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{ kind: 'damage', dice: '1d6', type: 'force', ability: 'none' }],
    }],
  },
};

const DUAL_DAMAGE_PULSE: RuleActionDefinition = {
  id: 'action.dual-damage-pulse',
  name: 'Dual Damage Pulse',
  kind: 'nonSpell',
  sourceEntityIds: ['entity:dual-damage-pulse'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Dual Damage Pulse',
    activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [
        { kind: 'damage', amount: '3', type: 'fire' },
        { kind: 'damage', amount: '5', type: 'cold' },
      ],
    }],
  },
};

const STONE_ENDURANCE: RuleActionDefinition = {
  id: 'action.stone-endurance',
  name: 'Каменная стойкость',
  kind: 'nonSpell',
  sourceEntityIds: ['ACT-goliath-stone', 'RACE-0011-stone'],
  targeting: {
    minTargets: 0,
    maxTargets: 1,
    rangeFt: 0,
    requiresLineOfSight: false,
    allowedRelations: ['self'],
  },
  mechanics: {
    name: 'Каменная стойкость',
    activation: {
      mode: 'reaction',
      trigger: { event: 'damage_taken', timing: 'before' },
      cost: [
        { resource: 'reaction', amount: 1 },
        { resource: 'giant_legacy', amount: 1 },
      ],
    },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'reduce_damage', amount: '1d12+con' }],
    }],
  },
};

const UNCANNY_DODGE: RuleActionDefinition = {
  id: 'action.uncanny-dodge',
  name: 'Невероятное уклонение',
  kind: 'nonSpell',
  sourceEntityIds: ['ACT-rogue-uncanny-dodge', 'EFF-rogue-uncanny-dodge'],
  targeting: {
    minTargets: 0,
    maxTargets: 1,
    rangeFt: 0,
    requiresLineOfSight: false,
    allowedRelations: ['self'],
  },
  mechanics: {
    name: 'Невероятное уклонение',
    activation: {
      mode: 'reaction',
      trigger: {
        event: 'damage_taken',
        timing: 'before',
        circumstances: [
          { kind: 'event_data_equals', key: 'delivery', value: 'attack' },
          { kind: 'event_data_equals', key: 'source_visible', value: true },
        ],
      },
      cost: [{ resource: 'reaction', amount: 1 }],
    },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'reduce_damage', amount: 'floor(incoming_damage/2)' }],
    }],
  },
};

const SHIELD: RuleActionDefinition = {
  id: 'spell.shield',
  name: 'Щит',
  kind: 'spell',
  sourceEntityIds: ['SPELL-0317'],
  spell: { level: 1, sourceClass: 'wizard' },
  mechanics: {
    name: 'Щит',
    activation: {
      mode: 'reaction',
      trigger: { event: 'hit_by_attack' },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot_1' }],
    },
    effects: [{
      resolution: 'auto',
      result: [{
        kind: 'modifier',
        op: 'add',
        value: '+5',
        applies_to: { roll: 'ac' },
        duration: { type: 'until_start_of_next_turn' },
      }],
    }],
  },
};

const ACTIONS = [STRIKE, DAMAGE_PULSE, DUAL_DAMAGE_PULSE, STONE_ENDURANCE, UNCANNY_DODGE, SHIELD];
const CATALOG: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};

function actor(id: string, actionIds: string[]): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: 12,
    capabilities: { actionIds },
    character: {
      abilityMods: { str: 3, dex: 0, con: 2, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        giant_legacy: 2,
        spell_slot_1: 1,
      },
      maxResources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        giant_legacy: 2,
        spell_slot_1: 1,
      },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
  };
}

const facts: SpatialFacts = {
  factsSource: 'scenario' as const,
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
};

function base<T extends GameCommand>(command: T): T {
  return command;
}

function begin(session: InMemoryRulesSession, defenderActions = [STONE_ENDURANCE.id]) {
  const commands = [
    base({
      schemaVersion: 1 as const,
      type: 'StartEncounter' as const,
      commandId: 'start',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      initiative: ['attacker', 'defender'],
    }),
    base({
      schemaVersion: 1 as const,
      type: 'StartTurn' as const,
      commandId: 'turn',
      expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
    }),
  ];
  commands.forEach((command) => expect(session.dispatch(command).status).toBe('accepted'));
  expect(session.getState().actors.defender.capabilities.actionIds).toEqual(defenderActions);
}

function world(defenderActions = [STONE_ENDURANCE.id]) {
  return createWorld({
    id: 'damage-reaction-world',
    ruleset: RULESET,
    actors: [actor('attacker', [STRIKE.id]), actor('defender', defenderActions)],
  });
}

function useStrike(
  session: InMemoryRulesSession,
  commandId = 'strike',
  strikeFacts = facts,
) {
  return session.dispatch(base({
    schemaVersion: 1,
    type: 'UseAction',
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: 'attacker',
    actionId: STRIKE.id,
    targetIds: ['defender'],
    factsByTarget: { defender: strikeFacts },
  }));
}

function useDamagePulse(session: InMemoryRulesSession) {
  return session.dispatch(base({
    schemaVersion: 1,
    type: 'UseAction',
    commandId: 'pulse',
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: 'attacker',
    actionId: DAMAGE_PULSE.id,
    targetIds: ['defender'],
    factsByTarget: { defender: facts },
  }));
}

function resolveReaction(
  session: InMemoryRulesSession,
  actionId: string | null,
  commandId: string,
) {
  const pending = session.getState().pendingResolution;
  if (!pending || pending.request.type !== 'reaction') throw new Error('Expected reaction');
  return session.dispatch(base({
    schemaVersion: 1,
    type: 'ResolveDecision',
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: 'defender',
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: { kind: 'reaction', actionId },
  }));
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((event) => event.payload.type === 'EngineEventRecorded'
    ? [event.payload.event]
    : []);
}

describe('canonical pre-damage reaction lifecycle', () => {
  it('offers Uncanny Dodge only for a visible attack and halves the held damage', () => {
    const tape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
    ]);
    const session = new InMemoryRulesSession(world([UNCANNY_DODGE.id]), CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('uncanny'),
    });
    begin(session, [UNCANNY_DODGE.id]);

    expect(useStrike(session).status).toBe('accepted');
    expect(session.getState()).toMatchObject({
      actors: { defender: { runtime: { hp: { current: 20 } } } },
      pendingResolution: {
        type: 'damage_reaction',
        request: { options: [{ actionId: UNCANNY_DODGE.id }] },
      },
    });
    expect(resolveReaction(session, UNCANNY_DODGE.id, 'uncanny-dodge').status).toBe('accepted');
    tape.assertExhausted();
    expect(session.getState().actors.defender.runtime.hp.current).toBe(16);
    expect(session.getState().actors.defender.runtime.resources.reaction).toBe(0);
  });

  it('does not offer Uncanny Dodge for an unseen attacker or non-attack damage', () => {
    const unseenTape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
    ]);
    const unseen = new InMemoryRulesSession(world([UNCANNY_DODGE.id]), CATALOG, {
      rng: unseenTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unseen'),
    });
    begin(unseen, [UNCANNY_DODGE.id]);
    expect(useStrike(unseen, 'unseen-strike', { ...facts, targetCanSeeSource: false }).status)
      .toBe('accepted');
    unseenTape.assertExhausted();
    expect(unseen.getState().pendingResolution).toBeNull();
    expect(unseen.getState().actors.defender.runtime.hp.current).toBe(12);
    expect(unseen.getState().actors.defender.runtime.resources.reaction).toBe(1);

    const pulseWorld = world([UNCANNY_DODGE.id]);
    pulseWorld.actors.attacker.capabilities.actionIds.push(DAMAGE_PULSE.id);
    const pulseTape = createStrictRngTape([{ label: 'damage', sides: 6, value: 6 }]);
    const pulse = new InMemoryRulesSession(pulseWorld, CATALOG, {
      rng: pulseTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('uncanny-pulse'),
    });
    begin(pulse, [UNCANNY_DODGE.id]);
    expect(useDamagePulse(pulse).status).toBe('accepted');
    pulseTape.assertExhausted();
    expect(pulse.getState().pendingResolution).toBeNull();
    expect(pulse.getState().actors.defender.runtime.hp.current).toBe(14);
    expect(pulse.getState().actors.defender.runtime.resources.reaction).toBe(1);
  });

  it('uses the same held transition for a non-attack damage source', () => {
    const initial = world();
    initial.actors.attacker.capabilities.actionIds.push(DAMAGE_PULSE.id);
    const tape = createStrictRngTape([
      { label: 'damage', sides: 6, value: 6 },
      { label: 'reduction', sides: 12, value: 2 },
    ]);
    const session = new InMemoryRulesSession(initial, CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('pulse'),
    });
    begin(session);

    expect(useDamagePulse(session).status).toBe('accepted');
    expect(session.getState()).toMatchObject({
      actors: { defender: { runtime: { hp: { current: 20 } } } },
      pendingResolution: {
        type: 'damage_reaction',
        request: { trigger: { type: 'damage_taken', actionId: DAMAGE_PULSE.id, amount: 6 } },
      },
    });
    expect(resolveReaction(session, STONE_ENDURANCE.id, 'pulse-stone').status).toBe('accepted');
    tape.assertExhausted();
    expect(session.getState().actors.defender.runtime.hp.current).toBe(18);
    expect(engineEvents(session.getEvents()).filter((event) => event.type === 'damage')).toEqual([
      expect.objectContaining({ type: 'damage', amount: 2, damageType: 'force' }),
    ]);
  });

  it('holds HP before Stone Endurance, survives JSON reload, pays once, and commits reduced damage once', () => {
    const initial = world();
    const openingTape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
    ]);
    const opening = new InMemoryRulesSession(initial, CATALOG, {
      rng: openingTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('opening'),
    });
    begin(opening);
    expect(useStrike(opening).status).toBe('accepted');
    openingTape.assertExhausted();

    const checkpoint = opening.getState();
    expect(checkpoint.actors.defender.runtime.hp.current).toBe(20);
    expect(checkpoint.pendingResolution).toMatchObject({
      type: 'damage_reaction',
      request: {
        trigger: { type: 'damage_taken', amount: 8, damageTypes: ['bludgeoning'] },
        options: [{ actionId: STONE_ENDURANCE.id }],
      },
      damage: [{ amount: 8, damageType: 'bludgeoning' }],
    });
    expect(JSON.parse(JSON.stringify(checkpoint)).pendingResolution).toEqual(checkpoint.pendingResolution);

    const migrated = migrateWorldState(JSON.parse(JSON.stringify(checkpoint)));
    const reactionTape = createStrictRngTape([{ label: 'reduction', sides: 12, value: 5 }]);
    const restored = new InMemoryRulesSession(migrated, CATALOG, {
      rng: reactionTape.rng,
      clock: createLogicalClock(migrated.logicalClock),
      nextId: createSequentialIdFactory('restored'),
    });
    expect(resolveReaction(restored, STONE_ENDURANCE.id, 'stone').status).toBe('accepted');
    reactionTape.assertExhausted();

    const final = restored.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors.attacker.runtime.resources.action).toBe(0);
    expect(final.actors.defender.runtime.hp.current).toBe(19);
    expect(final.actors.defender.runtime.resources).toMatchObject({ reaction: 0, giant_legacy: 1 });
    const recorded = engineEvents([...opening.getEvents(), ...restored.getEvents()]);
    expect(recorded.filter((event) => event.type === 'damage')).toEqual([
      expect.objectContaining({ type: 'damage', amount: 1, damageType: 'bludgeoning' }),
    ]);
    expect(recorded.filter((event) => event.type === 'damage_reduction')).toEqual([
      expect.objectContaining({ type: 'damage_reduction', amount: 7 }),
    ]);
    expect(foldEvents(initial, [...opening.getEvents(), ...restored.getEvents()])).toEqual(final);
  });

  it('declines without spending resources and applies the exact held damage once', () => {
    const initial = world();
    const tape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
    ]);
    const session = new InMemoryRulesSession(initial, CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('decline'),
    });
    begin(session);
    expect(useStrike(session).status).toBe('accepted');
    expect(resolveReaction(session, null, 'skip').status).toBe('accepted');
    tape.assertExhausted();
    expect(session.getState().actors.defender.runtime.hp.current).toBe(12);
    expect(session.getState().actors.defender.runtime.resources).toMatchObject({
      reaction: 1,
      giant_legacy: 2,
    });
    expect(engineEvents(session.getEvents()).filter((event) => event.type === 'damage')).toHaveLength(1);
  });

  it('chains Shield decline into Stone Endurance without exposing HP between decisions', () => {
    const initial = world([SHIELD.id, STONE_ENDURANCE.id]);
    const tape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
      { label: 'reduction', sides: 12, value: 6 },
    ]);
    const session = new InMemoryRulesSession(initial, CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('chain'),
    });
    begin(session, [SHIELD.id, STONE_ENDURANCE.id]);
    expect(useStrike(session, 'chain-strike').status).toBe('accepted');
    expect(session.getState().pendingResolution?.type).toBe('attack_reaction');
    expect(resolveReaction(session, null, 'skip-shield').status).toBe('accepted');
    expect(session.getState()).toMatchObject({
      actors: { defender: { runtime: { hp: { current: 20 } } } },
      pendingResolution: { type: 'damage_reaction' },
    });
    expect(resolveReaction(session, STONE_ENDURANCE.id, 'use-stone').status).toBe('accepted');
    tape.assertExhausted();
    expect(session.getState().actors.defender.runtime.hp.current).toBe(20);
    expect(session.getState().actors.defender.runtime.resources).toMatchObject({
      reaction: 0,
      giant_legacy: 1,
      spell_slot_1: 1,
    });
  });

  it('names an accepted Shield effect from the canonical action context', () => {
    const tape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
    ]);
    const session = new InMemoryRulesSession(world([SHIELD.id, STONE_ENDURANCE.id]), CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('shield-name'),
    });
    begin(session, [SHIELD.id, STONE_ENDURANCE.id]);
    expect(useStrike(session, 'shielded-strike').status).toBe('accepted');
    expect(resolveReaction(session, SHIELD.id, 'use-shield').status).toBe('accepted');
    tape.assertExhausted();

    expect(engineEvents(session.getEvents())).toContainEqual(expect.objectContaining({
      type: 'effect_applied',
      name: 'Щит · КД',
      sourceAction: 'Щит',
    }));
    expect(engineEvents(session.getEvents())).not.toContainEqual(expect.objectContaining({
      type: 'effect_applied', name: 'Эффект: действие',
    }));
  });

  it('rejects a checkpoint whose request, HP, or trace no longer matches its exact held damage bundle', () => {
    const tape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 8 },
    ]);
    const session = new InMemoryRulesSession(world(), CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('corrupt'),
    });
    begin(session);
    expect(useStrike(session).status).toBe('accepted');
    const checkpoint = JSON.parse(JSON.stringify(session.getState()));

    const corruptRequest = JSON.parse(JSON.stringify(checkpoint));
    corruptRequest.pendingResolution.request.trigger.amount = 999;
    expect(() => migrateWorldState(corruptRequest)).toThrow(/request is inconsistent/);

    const corruptHp = JSON.parse(JSON.stringify(checkpoint));
    corruptHp.pendingResolution.targetRuntimeAfter.hp.current += 1;
    expect(() => migrateWorldState(corruptHp)).toThrow(/HP must match its exact held damage/);

    const corruptTrace = JSON.parse(JSON.stringify(checkpoint));
    const damageEvent = corruptTrace.pendingResolution.attackEvents
      .find((event: { type?: string }) => event.type === 'damage');
    damageEvent.amount -= 1;
    expect(() => migrateWorldState(corruptTrace)).toThrow(/packets must match held engine events/);
  });

  it('fails closed for malformed persisted damage continuations and preserves complete runtime snapshots', () => {
    type MutableJson = Record<string, unknown>;
    type Corruption = {
      name: string;
      expected: RegExp;
      mutate: (worldRecord: MutableJson, pending: MutableJson) => void;
    };
    const record = (value: unknown): MutableJson => value as MutableJson;
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

    const initial = world();
    initial.actors.attacker.capabilities.actionIds.push(DUAL_DAMAGE_PULSE.id);
    initial.actors.defender.runtime = {
      ...initial.actors.defender.runtime,
      equipment: { main_hand: 'card:test-sword', off_hand: null },
      inventory: [
        { cardId: 'card:test-sword', qty: 1, containerId: 'card:test-pack' },
        { cardId: 'card:test-pack', qty: 1 },
      ],
      activeEffects: [{
        id: 'effect:test', name: 'Persisted effect', mechanics: {}, source: 'test',
      }],
      firedThisRest: ['action.stone-endurance'],
      deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    };
    const tape = createStrictRngTape([]);
    const session = new InMemoryRulesSession(initial, CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('persisted-contract'),
    });
    begin(session);
    const targetRuntimeBeforeDamage = clone(session.getState().actors.defender.runtime);
    const opened = session.dispatch(base({
      schemaVersion: 1 as const,
      type: 'UseAction' as const,
      commandId: 'dual-damage-pulse',
      expectedRevision: session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      actionId: DUAL_DAMAGE_PULSE.id,
      targetIds: ['defender'],
      factsByTarget: { defender: facts },
    }));
    expect(opened.status).toBe('accepted');
    tape.assertExhausted();

    const complete = clone(session.getState());
    if (complete.pendingResolution?.type !== 'damage_reaction') {
      throw new Error('Expected an exact pending damage-reaction checkpoint');
    }
    expect(complete.actors.defender.runtime).toEqual(targetRuntimeBeforeDamage);
    expect(complete.pendingResolution).toMatchObject({
      actionId: DUAL_DAMAGE_PULSE.id,
      action: { id: DUAL_DAMAGE_PULSE.id },
      damage: [
        { amount: 3, damageType: 'fire' },
        { amount: 5, damageType: 'cold' },
      ],
      request: {
        trigger: { amount: 8, damageTypes: ['fire', 'cold'] },
      },
      targetRuntimeBeforeDamage,
      targetRuntimeAfter: {
        ...targetRuntimeBeforeDamage,
        hp: { ...targetRuntimeBeforeDamage.hp, current: 12 },
      },
    });

    const migrated = migrateWorldState(clone(complete));
    expect(migrated.pendingResolution).toMatchObject({
      type: 'damage_reaction',
      targetRuntimeBeforeDamage: {
        equipment: { main_hand: 'card:test-sword', off_hand: null },
        inventory: [
          { cardId: 'card:test-sword', qty: 1, containerId: 'card:test-pack' },
          { cardId: 'card:test-pack', qty: 1 },
        ],
        activeEffects: [{ id: 'effect:test', name: 'Persisted effect' }],
        firedThisRest: ['action.stone-endurance'],
        deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
      },
    });
    expect(migrateWorldState(clone(migrated))).toEqual(migrated);

    const corruptions: Corruption[] = [
      {
        name: 'current HP above maximum', expected: /hp.current cannot exceed max/,
        mutate: (_worldRecord, rawPending) => {
          const hp = record(record(rawPending.targetRuntimeBeforeDamage).hp);
          hp.current = Number(hp.max) + 1;
        },
      },
      {
        name: 'missing source actor', expected: /damage continuation actors are invalid/,
        mutate: (worldRecord) => { delete record(worldRecord.actors).attacker; },
      },
      {
        name: 'mismatched action identity', expected: /action must match its exact damage continuation/,
        mutate: (_worldRecord, rawPending) => { record(rawPending.action).id = 'action:other'; },
      },
      {
        name: 'primitive damage packet', expected: /damage must contain positive exact packets/,
        mutate: (_worldRecord, rawPending) => { rawPending.damage = ['invalid']; },
      },
      {
        name: 'empty reaction options', expected: /must retain offered options/,
        mutate: (_worldRecord, rawPending) => { record(rawPending.request).options = []; },
      },
      {
        name: 'duplicate reaction options', expected: /options must be unique/,
        mutate: (_worldRecord, rawPending) => {
          const request = record(rawPending.request);
          request.options = [
            { actionId: STONE_ENDURANCE.id, label: STONE_ENDURANCE.name },
            { actionId: STONE_ENDURANCE.id, label: 'Duplicate' },
          ];
        },
      },
      {
        name: 'array inventory entry', expected: /inventory is invalid/,
        mutate: (_worldRecord, rawPending) => {
          record(rawPending.targetRuntimeBeforeDamage).inventory = [[]];
        },
      },
      {
        name: 'invalid inventory record', expected: /inventory is invalid/,
        mutate: (_worldRecord, rawPending) => {
          record(rawPending.targetRuntimeBeforeDamage).inventory = [{ cardId: ' ', qty: 1 }];
        },
      },
      {
        name: 'array active effect', expected: /activeEffects must contain objects/,
        mutate: (_worldRecord, rawPending) => {
          record(rawPending.targetRuntimeBeforeDamage).activeEffects = [[]];
        },
      },
      {
        name: 'non-array continuation events', expected: /damage continuation arrays are invalid/,
        mutate: (_worldRecord, rawPending) => { rawPending.followUps = null; },
      },
    ];

    for (const { name, expected, mutate } of corruptions) {
      const corrupted = clone(complete) as unknown as MutableJson;
      const rawPending = record(corrupted.pendingResolution);
      mutate(corrupted, rawPending);
      expect(() => migrateWorldState(corrupted), name).toThrow(expected);
    }
  });
});

const parryMechanics = JSON.parse(readFileSync(new URL('../../../backend/migrations/battle_master_parry_216.go', import.meta.url), 'utf8').match(/const battleMasterParry216 = `([^`]+)`/)![1]);
it.each([...['weapon_melee', 'spell_melee', 'unarmed', 'weapon_ranged', 'spell_ranged'].map(attackKind => ({ attackKind, resistant: false })),
  { attackKind: 'weapon_melee', resistant: true }])(
  'Battle Master Parry: $attackKind resistant=$resistant', ({ attackKind, resistant }) => {
    const parry = projectRuleAction({ id: '21600000-0000-4000-8000-000000000001', name: 'Парирование',
      type: 'class_feature', resource: 'reaction', mechanics: parryMechanics } as unknown as Action);
    const strike = structuredClone(STRIKE);
    (strike.mechanics.effects as Record<string, unknown>[])[0].attack_kind = attackKind;
    const catalog: RulesCatalog = { getAction: id => id === parry.id ? parry : id === strike.id ? strike : undefined };
    const initial = world([parry.id]);
    const defender = initial.actors.defender;
    if (resistant) defender.passives = [{ kind: 'resistance', damage_type: 'bludgeoning', value: 'resistance' }];
    defender.character.variables = { superiority_die: { count: 1, sides: 8 } };
    defender.runtime.resources.superiority_die = 4;
    defender.runtime.maxResources.superiority_die = 4;
    const openingTape = createStrictRngTape([{ label: 'attack', sides: 20, value: 15 }, { label: 'damage', sides: 8, value: 8 }]);
    const opening = new InMemoryRulesSession(initial, catalog, { rng: openingTape.rng,
      clock: createLogicalClock(), nextId: createSequentialIdFactory('parry-open') });
    begin(opening, [parry.id]);
    expect(useStrike(opening).status).toBe('accepted');
    openingTape.assertExhausted();
    const eligible = !attackKind.includes('ranged');
    const checkpoint = opening.getState();
    if (!eligible) {
      expect(checkpoint.pendingResolution).toBeNull();
      expect(checkpoint.actors.defender.runtime.hp.current).toBe(12);
      expect(checkpoint.actors.defender.runtime.resources.superiority_die).toBe(4);
      return;
    }
    expect(checkpoint.actors.defender.runtime.hp.current).toBe(20);
    expect(checkpoint.pendingResolution).toMatchObject({ type: 'damage_reaction',
      request: { options: [{ actionId: parry.id }] } });
    const migrated = migrateWorldState(JSON.parse(JSON.stringify(checkpoint)));
    const tape = createStrictRngTape([{ label: 'parry', sides: 8, value: 2 }]);
    const restored = new InMemoryRulesSession(migrated, catalog, { rng: tape.rng,
      clock: createLogicalClock(migrated.logicalClock), nextId: createSequentialIdFactory('parry-resume') });
    expect(resolveReaction(restored, parry.id, 'parry').status).toBe('accepted');
    tape.assertExhausted();
    expect(restored.getState().actors.defender.runtime.hp.current).toBe(resistant ? 19 : 17);
    expect(restored.getState().actors.defender.runtime.resources).toMatchObject({ reaction: 0, superiority_die: 3 });
    expect(restored.getState().pendingResolution).toBeNull();
  });


it.each([true, false])('settles zero-HP survival and damage expiry only after mitigation (reduce=%s)', reduce => {
  const initial = world();
  initial.actors.defender.runtime.hp.current = 4;
  initial.actors.defender.passives = [{ kind: 'zero_hp_save', name: 'Survival', ability: 'con',
    dc_base: 5, remaining_hp: 1 }, {
      id: 'damage-listener', name: 'After damage',
      activation: { mode: 'triggered', trigger: { event: 'damage_taken' } },
      effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }],
    }];
  initial.actors.defender.runtime.activeEffects.push({ id: 'damage-breaks-effect', name: 'Protective effect',
    source: 'test', mechanics: { kind: 'modifier', op: 'add', value: 1,
      applies_to: { roll: 'ability_check' }, end_triggers: ['actor_takes_damage'] } });
  const openingTape = createStrictRngTape([{ label: 'attack', sides: 20, value: 15 },
    { label: 'damage', sides: 8, value: 8 }]);
  const catalog: RulesCatalog = { getAction: id => id === STRIKE.id ? STRIKE : id === STONE_ENDURANCE.id ? STONE_ENDURANCE : undefined };
  const opening = new InMemoryRulesSession(initial, catalog, { rng: openingTape.rng,
    clock: createLogicalClock(), nextId: createSequentialIdFactory('consequences-open') });
  begin(opening);
  expect(useStrike(opening).status).toBe('accepted');
  openingTape.assertExhausted();
  expect(opening.getState().actors.defender.runtime.hp.current).toBe(4);
  expect(opening.getState().pendingResolution?.type).toBe('damage_reaction');
  const checkpoint = migrateWorldState(JSON.parse(JSON.stringify(opening.getState())));
  const tape = createStrictRngTape(reduce
    ? [{ label: 'reduction', sides: 12, value: 8 }]
    : [{ label: 'survival', sides: 20, value: 15 }]);
  const restored = new InMemoryRulesSession(checkpoint, catalog, { rng: tape.rng,
    clock: createLogicalClock(checkpoint.logicalClock), nextId: createSequentialIdFactory('consequences-resume') });
  expect(resolveReaction(restored, reduce ? STONE_ENDURANCE.id : null, 'finish').status).toBe('accepted');
  tape.assertExhausted();
  const after = restored.getState().actors.defender.runtime;
  expect(after.hp.current).toBe(reduce ? 4 : 1);
  expect(after.hp.temp).toBe(reduce ? 0 : 1);
  expect(after.activeEffects.some(effect => effect.id === 'damage-breaks-effect')).toBe(reduce);
});


it.each([1, 8])('concentration uses final damage after a restored reduction roll of %i', reductionDie => {
  const initial = world();
  initial.concentrations.defender = { id: 'concentration:held', sourceActorId: 'defender',
    actionId: 'spell:test', startedAtRevision: 0, effectLinks: [] };
  const catalog: RulesCatalog = { getAction: id => id === STRIKE.id ? STRIKE : id === STONE_ENDURANCE.id ? STONE_ENDURANCE : undefined };
  const openingTape = createStrictRngTape([{ label: 'attack', sides: 20, value: 15 }, { label: 'damage', sides: 8, value: 8 }]);
  const opening = new InMemoryRulesSession(initial, catalog, { rng: openingTape.rng,
    clock: createLogicalClock(), nextId: createSequentialIdFactory('concentration-open') });
  begin(opening);
  expect(useStrike(opening).status).toBe('accepted');
  openingTape.assertExhausted();
  const checkpoint = migrateWorldState(JSON.parse(JSON.stringify(opening.getState())));
  const tape = createStrictRngTape([{ label: 'reduction', sides: 12, value: reductionDie }]);
  const restored = new InMemoryRulesSession(checkpoint, catalog, { rng: tape.rng,
    clock: createLogicalClock(checkpoint.logicalClock), nextId: createSequentialIdFactory('concentration-resume') });
  expect(resolveReaction(restored, STONE_ENDURANCE.id, 'finish').status).toBe('accepted');
  tape.assertExhausted();
  expect(restored.getState().concentrations.defender?.id).toBe('concentration:held');
  if (reductionDie === 8) expect(restored.getState().pendingResolution).toBeNull();
  else expect(restored.getState().pendingResolution).toMatchObject({ type: 'concentration_save', damage: 5, request: { dc: 10 } });
});


const PROTECTIVE_FIELD = projectRuleAction({id:'23200000-0000-4000-8000-000000000001',name:'Protective Field',type:'class_feature',resource:'reaction',mechanics:JSON.parse(readFileSync(new URL('../../../backend/migrations/psi_warrior_protective_field_232.go',import.meta.url),'utf8').match(/const psiWarriorProtectiveField232 = `([^`]+)`/)![1])} as unknown as Action);

describe('Protective Field preserves independent reactor costs and held damage',()=>{
 function make(mode:string){
  const pulse=structuredClone(DAMAGE_PULSE);
  pulse.mechanics.effects=[{resolution:'auto',who:'target',result:[{kind:'damage',amount:'8',type:'force'}]}];
  const initial=world(mode==='self'||mode==='chain'?[PROTECTIVE_FIELD.id]:[]);
  initial.actors.attacker.capabilities.actionIds=mode==='source'?[pulse.id,PROTECTIVE_FIELD.id]:[pulse.id];
  initial.actors.defender.runtime.hp.current=4;
  if(mode!=='self'&&mode!=='source') initial.actors.protector=createWorld({id:'protector-fixture',ruleset:RULESET,actors:[actor('protector',[PROTECTIVE_FIELD.id])]}).actors.protector;
  for(const person of Object.values(initial.actors))if(person.capabilities.actionIds.includes(PROTECTIVE_FIELD.id)){
   person.character.variables={psi_warrior_energy_die:{count:1,sides:6}};
   person.character.abilityMods.int=mode==='self'?-4:2;
   person.runtime.resources.psi_warrior_energy_die=mode==='empty'?0:4;
   person.runtime.maxResources.psi_warrior_energy_die=4;
  }
  if(mode==='resistant')initial.actors.defender.passives=[{kind:'resistance',damage_type:'force',value:'resistance'}];
  const catalog:RulesCatalog={getAction:id=>id===pulse.id?pulse:id===PROTECTIVE_FIELD.id?PROTECTIVE_FIELD:undefined};
  const session=new InMemoryRulesSession(initial,catalog,{rng:()=>0.5,clock:createLogicalClock(),nextId:createSequentialIdFactory('field')});
  begin(session,mode==='self'||mode==='chain'?[PROTECTIVE_FIELD.id]:[]);
  const observed:SpatialFacts={...facts,damageObservers:mode==='missing'?[]:[{actorId:mode==='source'?'attacker':'protector',distanceFt:mode==='far'?35:30,canSeeTarget:mode!=='hidden'}]};
  const result=session.dispatch({schemaVersion:1,type:'UseAction',commandId:'pulse-field',expectedRevision:session.getState().revision,rulesetContentHash:RULESET.contentHash,actorId:'attacker',actionId:pulse.id,targetIds:['defender'],factsByTarget:{defender:observed}});
  return {session,catalog,result};
 }
 function respond(session:InMemoryRulesSession,actionId:string|null,id:string){
  const pending=session.getState().pendingResolution!;
  return session.dispatch({schemaVersion:1,type:'ResolveDecision',commandId:id,expectedRevision:session.getState().revision,rulesetContentHash:RULESET.contentHash,actorId:pending.request.actorId,resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId}});
 }
 it.each(['normal','resistant','self','source'])('holds lethal damage, reloads and resolves: %s',mode=>{
  const {session,catalog,result}=make(mode);expect(result.status).toBe('accepted');
  expect(session.getState().actors.defender.runtime.hp.current).toBe(4);
  const restored=new InMemoryRulesSession(migrateWorldState(JSON.parse(JSON.stringify(session.getState()))),catalog,{rng:()=>0.5,clock:createLogicalClock(),nextId:createSequentialIdFactory('field-reload')});
  expect(respond(restored,PROTECTIVE_FIELD.id,'protect').status).toBe('accepted');
  const final=restored.getState();expect(final.pendingResolution).toBeNull();
  expect(final.actors.defender.runtime.hp.current).toBe(mode==='self'?0:mode==='resistant'?3:2);
  const protector=final.actors[mode==='self'?'defender':mode==='source'?'attacker':'protector'];
  expect(protector.runtime.resources).toMatchObject({reaction:0,psi_warrior_energy_die:3});
  if(mode!=='self'){expect(protector.runtime.hp.current).toBe(20);expect(final.actors.defender.runtime.resources.reaction).toBe(1);}
 });
 it.each(['hidden','far','empty'])('does not offer an unavailable observer: %s',mode=>{
  const {session,result}=make(mode);expect(result.status).toBe('accepted');expect(session.getState().pendingResolution).toBeNull();expect(session.getState().actors.defender.runtime.hp.current).toBe(0);
 });
 it('requires complete observer facts before committing damage',()=>{expect(()=>make('missing')).toThrow(/observation/);});
 it.each([true,false])('retains an independent observer after target response, including reload: %s',accept=>{
  const {session,catalog}=make('chain');
  expect(session.getState().pendingResolution?.request.actorId).toBe('defender');
  expect(respond(session,accept?PROTECTIVE_FIELD.id:null,'first-field').status).toBe('accepted');
  expect(session.getState().actors.defender.runtime.hp.current).toBe(4);
  expect(session.getState().pendingResolution?.request.actorId).toBe('protector');
  const restored=new InMemoryRulesSession(migrateWorldState(JSON.parse(JSON.stringify(session.getState()))),catalog,{rng:()=>0.5,clock:createLogicalClock(),nextId:createSequentialIdFactory('second-field')});
  expect(respond(restored,PROTECTIVE_FIELD.id,'second-field').status).toBe('accepted');
  expect(restored.getState().actors.defender.runtime.hp.current).toBe(accept?4:2);
  expect(restored.getState().actors.protector.runtime.resources.reaction).toBe(0);
  expect(restored.getState().actors.defender.runtime.resources.reaction).toBe(accept?0:1);
 });
});
