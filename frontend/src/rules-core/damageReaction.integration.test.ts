import { describe, expect, it } from 'vitest';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
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

const ACTIONS = [STRIKE, DAMAGE_PULSE, STONE_ENDURANCE, SHIELD];
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

const facts = {
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

function useStrike(session: InMemoryRulesSession, commandId = 'strike') {
  return session.dispatch(base({
    schemaVersion: 1,
    type: 'UseAction',
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: 'attacker',
    actionId: STRIKE.id,
    targetIds: ['defender'],
    factsByTarget: { defender: facts },
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
});
