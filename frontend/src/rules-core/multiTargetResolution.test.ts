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

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'multi-target@1',
  contentHash: 'sha256:multi-target',
  errataVersion: 'test-1',
};

const BLESS: RuleActionDefinition = {
  id: 'spell.test.multi-bless',
  name: 'Bless',
  kind: 'spell',
  sourceEntityIds: ['PHB24:spell:bless'],
  spell: {
    level: 1,
    sourceClass: 'cleric',
    components: { verbal: true, somatic: true, material: true },
  },
  concentration: true,
  targeting: {
    minTargets: 1,
    maxTargets: 3,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['self', 'ally'],
  },
  mechanics: {
    name: 'Bless',
    activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [
        {
          kind: 'modifier', op: 'bonus_die', faces: 4, source: 'Bless',
          applies_to: { roll: 'attack' },
          duration: { type: 'rounds', amount: 10, concentration: true },
        },
        {
          kind: 'modifier', op: 'bonus_die', faces: 4, source: 'Bless',
          applies_to: { roll: 'saving_throw' },
          duration: { type: 'rounds', amount: 10, concentration: true },
        },
      ],
    }],
  },
};

const AREA_SAVE: RuleActionDefinition = {
  id: 'spell.test.area-save',
  name: 'Test Burning Wave',
  kind: 'spell',
  sourceEntityIds: ['PHB24:spell:burning-hands', 'PHB24:spell:thunderwave'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 3,
    rangeFt: 15,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Test Burning Wave',
    activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'dex',
      dc: '12',
      on_fail: [
        { kind: 'damage', dice: '1d6', type: 'fire' },
        { kind: 'condition', value: 'prone', op: 'apply', duration: { type: 'rounds', amount: 1 } },
      ],
      on_success: [{ kind: 'damage', dice: '1d6', type: 'fire', on_success: 'half' }],
    }],
  },
};

const DAMAGE: RuleActionDefinition = {
  id: 'action.test.damage',
  name: 'Damage concentration',
  kind: 'nonSpell',
  sourceEntityIds: ['test:damage'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Damage concentration',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{ kind: 'damage', dice: '1d4', type: 'force' }],
    }],
  },
};

const ACTIONS = [BLESS, AREA_SAVE, DAMAGE];
const catalog: RulesCatalog = { getAction: (id) => ACTIONS.find((action) => action.id === id) };

function spellCastAuditPassive() {
  return {
    id: 'test:spell-cast-audit',
    name: 'Cast audit',
    activation: { mode: 'triggered', trigger: { event: 'spell_cast' } },
    effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }],
  };
}

function actor(id: string, options: {
  actionIds?: string[];
  passives?: Record<string, unknown>[];
  actionCount?: number;
  slotCount?: number;
} = {}): ActorState {
  const actionCount = options.actionCount ?? 1;
  const slotCount = options.slotCount ?? 1;
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: 12,
    capabilities: { actionIds: options.actionIds ?? [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 3, cha: 0 },
      profBonus: 2,
      level: 1,
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: {
        action: actionCount,
        bonus_action: 1,
        reaction: 1,
        spell_slot_1: slotCount,
      },
      maxResources: {
        action: actionCount,
        bonus_action: 1,
        reaction: 1,
        spell_slot_1: slotCount,
      },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    ...(options.passives ? { passives: options.passives } : {}),
  };
}

function facts(relation: SpatialFacts['relation'], boardRevision: number, distanceFt = 10): SpatialFacts {
  return {
    factsSource: 'board',
    boardRevision,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation,
  };
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

function acceptedEvents(result: ReturnType<InMemoryRulesSession['dispatch']>): UncommittedRuleEvent[] {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  expect(result).toMatchObject({ status: 'accepted' });
  return result.status === 'accepted' ? result.events : [];
}

function engineEntries(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [{ envelope: entry.payload, event: entry.payload.event }] : []
  ));
}

function resourceSpendCount(events: readonly UncommittedRuleEvent[], resource: string): number {
  return engineEntries(events).filter(({ event }) => (
    event.type === 'resource_spent' && event.resource === resource
  )).length;
}

describe('deterministic multi-target rules-core actions', () => {
  it('applies one Bless cast to three targets, creates one ledger, and removes every link on replacement/failure', () => {
    const caster = actor('cleric', {
      actionIds: [BLESS.id],
      passives: [spellCastAuditPassive()],
      actionCount: 2,
      slotCount: 2,
    });
    const ally = actor('ally');
    const summon = actor('summon');
    summon.kind = 'summonedActor';
    const attacker = actor('attacker', { actionIds: [DAMAGE.id] });
    const initial = createWorld({ id: 'multi-bless', ruleset: RULESET, actors: [caster, ally, summon, attacker] });
    const damageTape = createStrictRngTape([{ label: 'damage concentration', sides: 4, value: 4 }]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: damageTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const spatialByTarget = {
      cleric: facts('self', 11, 0),
      ally: facts('ally', 11, 15),
      summon: facts('ally', 11, 25),
    };

    const first = session.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'bless-one',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'cleric',
      actionId: BLESS.id,
      targetIds: ['cleric', 'ally', 'summon'],
      factsByTarget: spatialByTarget,
      spell: { baseLevel: 1 },
    }));
    const firstEvents = acceptedEvents(first);
    expect(resourceSpendCount(firstEvents, 'action')).toBe(1);
    expect(resourceSpendCount(firstEvents, 'spell_slot_1')).toBe(1);
    expect(engineEntries(firstEvents).filter(({ event }) => (
      event.type === 'narrative' && event.text === 'Сработало: Cast audit'
    ))).toHaveLength(1);
    expect(firstEvents).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        targetIds: ['cleric', 'ally', 'summon'],
        facts: { spatialByTarget },
      }),
    }));
    expect(firstEvents.filter((event) => event.payload.type === 'ConcentrationSet')).toHaveLength(1);
    expect(session.getState().concentrations.cleric).toMatchObject({
      id: 'bless-one:concentration',
      actionId: BLESS.id,
      effectLinks: [
        { actorId: 'ally', effectId: 'bless-one:id:3' },
        { actorId: 'ally', effectId: 'bless-one:id:4' },
        { actorId: 'cleric', effectId: 'bless-one:id:1' },
        { actorId: 'cleric', effectId: 'bless-one:id:2' },
        { actorId: 'summon', effectId: 'bless-one:id:5' },
        { actorId: 'summon', effectId: 'bless-one:id:6' },
      ],
    });
    for (const actorId of ['cleric', 'ally', 'summon']) {
      expect(session.getState().actors[actorId].runtime.activeEffects).toHaveLength(2);
    }

    const second = session.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'bless-two',
      expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'cleric',
      actionId: BLESS.id,
      targetIds: ['cleric', 'ally', 'summon'],
      factsByTarget: spatialByTarget,
      spell: { baseLevel: 1 },
    }));
    const secondEvents = acceptedEvents(second);
    expect(secondEvents.filter((event) => event.payload.type === 'ConcentrationSet')).toHaveLength(1);
    expect(secondEvents.filter((event) => (
      event.payload.type === 'ConcentrationCleared' && event.payload.reason === 'replaced'
    ))).toHaveLength(1);
    expect(engineEntries(secondEvents).filter(({ event }) => event.type === 'effect_expired')).toHaveLength(6);
    expect(session.getState().concentrations.cleric.effectLinks).toHaveLength(6);
    for (const actorId of ['cleric', 'ally', 'summon']) {
      const ids = session.getState().actors[actorId].runtime.activeEffects.map((effect) => effect.id);
      expect(ids).toHaveLength(2);
      expect(ids.every((id) => id.startsWith('bless-two:'))).toBe(true);
    }

    acceptedEvents(session.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'damage-caster',
      expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      actionId: DAMAGE.id,
      targetIds: ['cleric'],
      factsByTarget: { cleric: facts('enemy', 12) },
    })));
    damageTape.assertExhausted();
    const pending = session.getState().pendingResolution;
    expect(pending).toMatchObject({ type: 'concentration_save', actorId: 'cleric', damage: 4 });
    if (!pending || pending.type !== 'concentration_save') throw new Error('Expected concentration save');
    acceptedEvents(session.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'fail-multi-concentration',
      expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'cleric',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: {
        kind: 'roll',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }, { sides: 4, value: 1 }] },
      },
    })));
    expect(session.getState().concentrations.cleric).toBeUndefined();
    for (const actorId of ['cleric', 'ally', 'summon']) {
      expect(session.getState().actors[actorId].runtime.activeEffects).toEqual([]);
    }
    expect(foldEvents(initial, session.getEvents())).toEqual(session.getState());
  });

  it('serializes three area saves in declaration order across JSON reload with mixed manual/system outcomes', () => {
    const wizard = actor('wizard', {
      actionIds: [AREA_SAVE.id],
      passives: [spellCastAuditPassive()],
    });
    const initial = createWorld({
      id: 'serial-area-save',
      ruleset: RULESET,
      actors: [wizard, actor('target-a'), actor('target-b'), actor('target-c')],
    });
    const firstEffectTape = createStrictRngTape([{ label: 'target-b damage', sides: 6, value: 6 }]);
    const opening = new InMemoryRulesSession(initial, catalog, {
      rng: firstEffectTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const spatialByTarget = {
      'target-b': facts('enemy', 21, 5),
      'target-a': facts('enemy', 21, 10),
      'target-c': facts('enemy', 21, 15),
    };
    const openedEvents = acceptedEvents(opening.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'area-open',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      actionId: AREA_SAVE.id,
      targetIds: ['target-b', 'target-a', 'target-c'],
      factsByTarget: spatialByTarget,
      spell: { baseLevel: 1 },
    })));
    expect(resourceSpendCount(openedEvents, 'action')).toBe(1);
    expect(resourceSpendCount(openedEvents, 'spell_slot_1')).toBe(1);
    expect(opening.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      targetActorId: 'target-b',
      facts: spatialByTarget['target-b'],
      resolvedTargetIds: [],
      remainingTargets: [
        expect.objectContaining({ targetActorId: 'target-a', facts: spatialByTarget['target-a'] }),
        expect.objectContaining({ targetActorId: 'target-c', facts: spatialByTarget['target-c'] }),
      ],
      sharedDamageRolls: [],
    });
    const firstPending = opening.getState().pendingResolution;
    if (!firstPending || firstPending.type !== 'target_save') throw new Error('Expected first target save');
    const firstResolutionEvents = acceptedEvents(opening.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'save-target-b',
      expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target-b',
      resolutionId: firstPending.id,
      requestId: firstPending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] } },
    })));
    firstEffectTape.assertExhausted();
    expect(opening.getState().actors['target-b'].runtime.hp.current).toBe(14);
    expect(opening.getState().actors['target-b'].runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }) }),
    ]);
    expect(engineEntries(firstResolutionEvents).filter(({ event }) => (
      event.type === 'narrative' && event.text === 'Сработало: Cast audit'
    ))).toHaveLength(1);
    expect(opening.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      targetActorId: 'target-a',
      facts: spatialByTarget['target-a'],
      resolvedTargetIds: ['target-b'],
      remainingTargets: [expect.objectContaining({ targetActorId: 'target-c' })],
      spellCastEmitted: true,
      sharedDamageRolls: [{ sides: 6, value: 6 }],
    });

    const checkpoint = JSON.parse(JSON.stringify(opening.getState())) as ReturnType<typeof opening.getState>;
    const remainingTape = createStrictRngTape([
      { label: 'target-a system save', sides: 20, value: 18 },
    ]);
    const restored = new InMemoryRulesSession(checkpoint, catalog, {
      rng: remainingTape.rng,
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: createSequentialIdFactory('unused-after-reload'),
    });
    const secondPending = restored.getState().pendingResolution;
    if (!secondPending || secondPending.type !== 'target_save') throw new Error('Expected second target save');
    const secondEvents = acceptedEvents(restored.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'save-target-a',
      expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target-a',
      resolutionId: secondPending.id,
      requestId: secondPending.request.id,
      response: { kind: 'roll', roll: { mode: 'system' } },
    })));
    expect(restored.getState().actors['target-a'].runtime.hp.current).toBe(17);
    expect(restored.getState().actors['target-a'].runtime.activeEffects).toEqual([]);
    expect(restored.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      targetActorId: 'target-c',
      facts: spatialByTarget['target-c'],
      resolvedTargetIds: ['target-b', 'target-a'],
      remainingTargets: [],
    });
    const thirdPending = restored.getState().pendingResolution;
    if (!thirdPending || thirdPending.type !== 'target_save') throw new Error('Expected third target save');
    const thirdEvents = acceptedEvents(restored.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'save-target-c',
      expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target-c',
      resolutionId: thirdPending.id,
      requestId: thirdPending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] } },
    })));
    remainingTape.assertExhausted();

    const final = restored.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors['target-a'].runtime.hp.current).toBe(17);
    expect(final.actors['target-b'].runtime.hp.current).toBe(14);
    expect(final.actors['target-c'].runtime.hp.current).toBe(14);
    expect(final.actors['target-c'].runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }) }),
    ]);
    expect(final.actors.wizard.runtime.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    expect(final.actors.wizard.runtime.hp.temp).toBe(1);

    const allEvents = [...openedEvents, ...firstResolutionEvents, ...secondEvents, ...thirdEvents];
    expect(resourceSpendCount(allEvents, 'action')).toBe(1);
    expect(resourceSpendCount(allEvents, 'spell_slot_1')).toBe(1);
    expect(engineEntries(allEvents).filter(({ event }) => (
      event.type === 'narrative' && event.text === 'Сработало: Cast audit'
    ))).toHaveLength(1);
    expect(engineEntries(allEvents).filter(({ event }) => event.type === 'roll' && event.roll.kind === 'save')).toHaveLength(3);
    const damageTargets = engineEntries(allEvents).flatMap(({ envelope, event }) => (
      event.type === 'damage' ? envelope.targetIds : []
    ));
    expect(damageTargets).toEqual(['target-b', 'target-a', 'target-c']);
    expect(engineEntries(allEvents).flatMap(({ event }) => (
      event.type === 'damage' ? event.roll?.dice.map((die) => die.result) ?? [] : []
    ))).toEqual([6, 6, 6]);
    expect(allEvents.filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(3);
    expect(allEvents.filter((event) => event.payload.type === 'ResolutionClosed')).toHaveLength(3);
    expect(allEvents.filter((event) => event.payload.type === 'DecisionRecorded')).toHaveLength(3);
    expect(allEvents).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        targetIds: ['target-b', 'target-a', 'target-c'],
        facts: { spatialByTarget },
      }),
    }));
    expect(foldEvents(initial, allEvents)).toEqual(final);

    const replayTape = createStrictRngTape([
      { label: 'replay target-a system save', sides: 20, value: 18 },
    ]);
    const replay = new InMemoryRulesSession(JSON.parse(JSON.stringify(checkpoint)), catalog, {
      rng: replayTape.rng,
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: createSequentialIdFactory('different-hidden-id-state'),
    });
    const replaySecondPending = replay.getState().pendingResolution;
    if (!replaySecondPending || replaySecondPending.type !== 'target_save') throw new Error('Expected replay save');
    const replaySecondEvents = acceptedEvents(replay.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'save-target-a',
      expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target-a',
      resolutionId: replaySecondPending.id,
      requestId: replaySecondPending.request.id,
      response: { kind: 'roll', roll: { mode: 'system' } },
    })));
    const replayThirdPending = replay.getState().pendingResolution;
    if (!replayThirdPending || replayThirdPending.type !== 'target_save') throw new Error('Expected replay final save');
    const replayThirdEvents = acceptedEvents(replay.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'save-target-c',
      expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target-c',
      resolutionId: replayThirdPending.id,
      requestId: replayThirdPending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] } },
    })));
    replayTape.assertExhausted();
    expect([...replaySecondEvents, ...replayThirdEvents]).toEqual([...secondEvents, ...thirdEvents]);
    expect(replay.getState()).toEqual(final);
  });

  it('rejects duplicate, unknown, missing-fact, and invalid-fact targets before cost or RNG', () => {
    const wizard = actor('wizard', { actionIds: [AREA_SAVE.id] });
    const initial = createWorld({
      id: 'invalid-area-targets',
      ruleset: RULESET,
      actors: [wizard, actor('target-a'), actor('target-b')],
    });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('invalid target declarations must not consume RNG'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const base = {
      schemaVersion: 1 as const,
      type: 'UseAction' as const,
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      actionId: AREA_SAVE.id,
      spell: { baseLevel: 1 },
    };

    expect(session.dispatch(command({
      ...base,
      commandId: 'duplicate-target',
      targetIds: ['target-a', 'target-a'],
      factsByTarget: { 'target-a': facts('enemy', 30) },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidTargets' });
    expect(session.dispatch(command({
      ...base,
      commandId: 'unknown-target',
      targetIds: ['missing'],
      factsByTarget: { missing: facts('enemy', 30) },
    }))).toMatchObject({ status: 'rejected', code: 'ActorNotFound' });
    expect(session.dispatch(command({
      ...base,
      commandId: 'missing-facts',
      targetIds: ['target-a', 'target-b'],
      factsByTarget: { 'target-a': facts('enemy', 30) },
    }))).toMatchObject({ status: 'rejected', code: 'MissingSpatialFacts' });
    expect(session.dispatch(command({
      ...base,
      commandId: 'invalid-facts',
      targetIds: ['target-a'],
      factsByTarget: { 'target-a': facts('enemy', 30, 20) },
    }))).toMatchObject({ status: 'rejected', code: 'OutOfRange' });
    expect(session.getState()).toBe(initial);
    expect(session.getEvents()).toEqual([]);
  });
});
