import { describe, expect, it } from 'vitest';
import type { ActorState, GameCommand, RuleActionDefinition, RulesCatalog } from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'micro-mvp-test@1',
  contentHash: 'sha256:test-release',
  errataVersion: 'test-1',
};

function actor(id: string, overrides: Partial<ActorState> = {}): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}-controller`,
    ac: 12,
    capabilities: { actionIds: ACTIONS.filter((action) => (
      (action.mechanics.activation as { mode?: string } | undefined)?.mode !== 'reaction'
    )).map((action) => action.id) },
    character: {
      abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 1, cha: 0 },
      profBonus: 2,
      level: 1,
      skillProficiencies: ['athletics'],
      saveProficiencies: ['con'],
    },
    runtime: {
      hp: { current: 12, max: 12, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    ...overrides,
  };
}

const ACTIONS: RuleActionDefinition[] = [
  {
    id: 'action.test-strike',
    name: 'Проверочный удар',
    kind: 'nonSpell',
    sourceEntityIds: ['action.test-strike'],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 5,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      name: 'Проверочный удар',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', ability: 'str',
        on_hit: [{ kind: 'damage', dice: '1d6', type: 'bludgeoning', ability: 'none' }],
      }],
    },
  },
  {
    id: 'spell.test-poison',
    name: 'Проверочное отравление',
    kind: 'spell',
    sourceEntityIds: ['spell.test-poison'],
    spell: { level: 1, sourceClass: 'test-caster' },
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      name: 'Проверочное отравление',
      activation: { mode: 'active', cost: [{ resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'auto', who: 'target',
        result: [{ kind: 'condition', value: 'poisoned', op: 'apply', duration: { type: 'rounds', amount: 1 } }],
      }],
    },
  },
  {
    id: 'spell.test-save-poison',
    name: 'Проверочный ядовитый импульс',
    kind: 'spell',
    sourceEntityIds: ['spell.test-save-poison'],
    spell: { level: 1, sourceClass: 'test-caster' },
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      name: 'Проверочный ядовитый импульс',
      activation: { mode: 'active', cost: [{ resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'con', dc: '15',
        on_fail: [
          { kind: 'damage', dice: '1d6', type: 'poison' },
          { kind: 'condition', value: 'poisoned', op: 'apply', duration: { type: 'rounds', amount: 1 } },
        ],
        on_success: [],
      }],
    },
  },
  {
    id: 'spell.test-shield',
    name: 'Щит',
    kind: 'spell',
    sourceEntityIds: ['spell.test-shield'],
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
          kind: 'modifier', op: 'add', value: '+5',
          applies_to: { roll: 'ac' },
          duration: { type: 'until_start_of_next_turn' },
        }],
      }],
    },
  },
  {
    id: 'spell.test-bless',
    name: 'Благословение',
    kind: 'spell',
    sourceEntityIds: ['spell.test-bless'],
    spell: { level: 1, sourceClass: 'cleric' },
    concentration: true,
    targeting: {
      minTargets: 1, maxTargets: 1, rangeFt: 30, requiresLineOfSight: true,
      allowedRelations: ['ally'],
    },
    mechanics: {
      name: 'Благословение',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'auto', who: 'target',
        result: [{
          kind: 'modifier', op: 'add', value: '1d4',
          applies_to: { roll: 'saving_throw' },
          duration: { type: 'rounds', amount: 10, concentration: true },
        }],
      }],
    },
  },
];

const catalog: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};

function command<T extends GameCommand>(value: T): T {
  return value;
}

const facts = (distanceFt: number) => ({
  factsSource: 'scenario' as const,
  boardRevision: 1,
  distanceFt,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
});

describe('WorldState command/event facade', () => {
  it('evaluates formula-backed passive modifiers against the acting character', () => {
    const druid = actor('druid', {
      character: {
        ...actor('druid').character,
        abilityMods: { str: 0, dex: 1, con: 2, int: 0, wis: 3, cha: 0 },
      },
      passives: [{
        kind: 'modifier',
        op: 'add',
        value: 'max(1,wis)',
        source: 'Primal Order: Magician',
        applies_to: { roll: 'ability_check', filter: { skill: 'arcana' } },
      }],
    });
    const tape = createStrictRngTape([{ label: 'Arcana', sides: 20, value: 10 }]);
    const session = new InMemoryRulesSession(
      createWorld({ id: 'world-formula-passive', ruleset: RULESET, actors: [druid, actor('fighter')] }),
      catalog,
      { rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory() },
    );

    expect(session.dispatch(command({
      schemaVersion: 1, type: 'AbilityCheck', commandId: 'magician-arcana', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'druid', ability: 'int', skill: 'arcana', dc: 12,
    })).status).toBe('accepted');
    tape.assertExhausted();
    const roll = session.getEvents().flatMap((event) => (
      event.payload.type === 'EngineEventRecorded' && event.payload.event.type === 'roll'
        ? [event.payload.event.roll]
        : []
    )).at(-1);
    expect(roll).toMatchObject({
      total: 13,
      outcome: 'success',
      modifiers: [
        { value: 0, source: 'ИНТ' },
        { value: 3, source: 'Primal Order: Magician' },
      ],
    });
  });

  it('runs one strict round for two player characters and replays to the same state', () => {
    const initial = createWorld({ id: 'world-1', ruleset: RULESET, actors: [actor('fighter'), actor('wizard')] });
    const initialJson = JSON.stringify(initial);
    const tape = createStrictRngTape([
      { label: 'fighter athletics', sides: 20, value: 14 },
      { label: 'fighter attack', sides: 20, value: 15 },
      { label: 'fighter damage', sides: 6, value: 4 },
      { label: 'wizard constitution save', sides: 20, value: 12 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('event'),
    });

    const dispatch = (make: (revision: number) => GameCommand) => {
      const result = session.dispatch(make(session.getState().revision));
      expect(result.status).toBe('accepted');
      return result;
    };

    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'c1', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', initiative: ['fighter', 'wizard'],
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'c2', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'AbilityCheck', commandId: 'c3', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', ability: 'str', skill: 'athletics', dc: 15,
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'UseAction', commandId: 'c4', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['wizard'], factsByTarget: { wizard: facts(5) },
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'c5', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'c6', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard',
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'SavingThrow', commandId: 'c7', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', ability: 'con', dc: 13,
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'UseAction', commandId: 'c8', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', actionId: 'spell.test-poison',
      targetIds: ['fighter'], factsByTarget: { fighter: facts(30) }, spell: { baseLevel: 1 },
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'c9', expectedRevision: revision,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard',
    }));

    tape.assertExhausted();
    const final = session.getState();
    expect(JSON.stringify(initial)).toBe(initialJson);
    expect(final.revision).toBe(9);
    expect(final.scene).toMatchObject({ mode: 'encounter', activeIndex: 0, round: 2, turnStarted: false });
    expect(final.actors.wizard.runtime.hp.current).toBe(8);
    expect(final.actors.fighter.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'poisoned' }) }),
    ]);
    expect(final.actors.fighter.runtime.resources.action).toBe(0);
    expect(final.actors.wizard.runtime.resources.spell_slot_1).toBe(0);

    const traceTypes = session.getEvents()
      .filter((event) => event.payload.type === 'EngineEventRecorded')
      .map((event) => event.payload.type === 'EngineEventRecorded' ? event.payload.event.type : '');
    expect(traceTypes).toEqual(expect.arrayContaining([
      'turn_started', 'roll', 'damage', 'turn_ended', 'condition_applied', 'resource_spent',
    ]));
    const declarations = session.getEvents().flatMap((event) => (
      event.payload.type === 'ActionDeclared' ? [event.payload] : []
    ));
    expect(declarations).toEqual([
      expect.objectContaining({
        actorId: 'fighter', actionId: 'action.test-strike', actionKind: 'nonSpell',
        sourceEntityIds: ['action.test-strike'], targetIds: ['wizard'], timing: 'active',
      }),
      expect.objectContaining({
        actorId: 'wizard', actionId: 'spell.test-poison', actionKind: 'spell',
        sourceEntityIds: ['spell.test-poison'], targetIds: ['fighter'], timing: 'active',
        spell: { baseLevel: 1, castLevel: 1, sourceClass: 'test-caster' },
      }),
    ]);
    expect(foldEvents(initial, session.getEvents())).toEqual(final);
  });

  it('derives spell identity from the catalog and rejects forged or malformed metadata', () => {
    const initial = createWorld({ id: 'world-provenance', ruleset: RULESET, actors: [actor('wizard'), actor('fighter')] });
    const noRoll = () => { throw new Error('metadata rejection must happen before any roll'); };
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: noRoll, clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });

    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'forged-level', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', actionId: 'spell.test-poison',
      targetIds: ['fighter'], factsByTarget: { fighter: facts(30) }, spell: { baseLevel: 2 },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidSpellDeclaration' });
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'forged-kind', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', actionId: 'spell.test-poison',
      targetIds: ['fighter'], factsByTarget: { fighter: facts(30) }, spell: { baseLevel: 1, castLevel: 0 },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidSpellDeclaration' });

    const fighterWorld = createWorld({ id: 'world-nonspell', ruleset: RULESET, actors: [actor('fighter'), actor('wizard')] });
    const fighterSession = new InMemoryRulesSession(fighterWorld, catalog, {
      rng: noRoll, clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(fighterSession.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'forged-spell', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['wizard'], factsByTarget: { wizard: facts(5) }, spell: { baseLevel: 0 },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidSpellDeclaration' });

    const malformed = { ...ACTIONS[0], sourceEntityIds: [] } as unknown as RuleActionDefinition;
    const malformedCatalog: RulesCatalog = { getAction: (id) => id === malformed.id ? malformed : undefined };
    const malformedSession = new InMemoryRulesSession(fighterWorld, malformedCatalog, {
      rng: noRoll, clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(malformedSession.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'missing-provenance', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: malformed.id,
      targetIds: ['wizard'], factsByTarget: { wizard: facts(5) },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidActionDefinition' });
    expect(session.getState()).toBe(initial);
    expect(fighterSession.getState()).toBe(fighterWorld);
    expect(malformedSession.getState()).toBe(fighterWorld);
  });

  it('fails closed for turn, facts and ruleset violations without mutating state', () => {
    const initial = createWorld({ id: 'world-2', ruleset: RULESET, actors: [actor('fighter'), actor('wizard')] });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('invalid commands must not roll'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(),
    });
    const start = session.dispatch(command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'start', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', initiative: ['fighter', 'wizard'],
    }));
    expect(start.status).toBe('accepted');
    const started = session.dispatch(command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'turn', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
    }));
    expect(started.status).toBe('accepted');
    const before = session.getState();

    const wrongActor = session.dispatch(command({
      schemaVersion: 1, type: 'AbilityCheck', commandId: 'wrong-actor', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', ability: 'int',
    }));
    expect(wrongActor).toMatchObject({ status: 'rejected', code: 'NotActorsTurn' });

    const missingFacts = session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'missing-facts', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike', targetIds: ['wizard'],
    }));
    expect(missingFacts).toMatchObject({ status: 'rejected', code: 'MissingSpatialFacts' });

    const outOfRange = session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'range', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['wizard'], factsByTarget: { wizard: facts(10) },
    }));
    expect(outOfRange).toMatchObject({ status: 'rejected', code: 'OutOfRange' });

    const wrongRules = session.dispatch(command({
      schemaVersion: 1, type: 'AbilityCheck', commandId: 'wrong-rules', expectedRevision: 2,
      rulesetContentHash: 'sha256:other', actorId: 'fighter', ability: 'str',
    }));
    expect(wrongRules).toMatchObject({ status: 'rejected', code: 'RulesetMismatch' });
    expect(session.getState()).toBe(before);
  });

  it('checks duplicate command identity before revision conflicts', () => {
    const world = createWorld({ id: 'world-3', ruleset: RULESET, actors: [actor('fighter'), actor('wizard')] });
    const session = new InMemoryRulesSession(world, catalog, {
      rng: () => 0.5,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(),
    });
    const original = command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'same-command', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', initiative: ['fighter', 'wizard'],
    });
    expect(session.dispatch(original).status).toBe('accepted');
    expect(session.dispatch(original)).toMatchObject({ status: 'rejected', code: 'DuplicateCommand' });
  });

  it('pauses a target save before effects, survives JSON reload and resumes without paying twice', () => {
    const initial = createWorld({ id: 'world-save', ruleset: RULESET, actors: [actor('wizard'), actor('fighter')] });
    const opening = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('opening a save must not roll'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('decision'),
    });
    expect(opening.dispatch(command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'save-c1', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', initiative: ['wizard', 'fighter'],
    })).status).toBe('accepted');
    expect(opening.dispatch(command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'save-c2', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard',
    })).status).toBe('accepted');

    const opened = opening.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'save-c3', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', actionId: 'spell.test-save-poison',
      targetIds: ['fighter'], factsByTarget: { fighter: facts(30) }, spell: { baseLevel: 1 },
    }));
    expect(opened.status).toBe('accepted');
    const paused = opening.getState();
    expect(paused.actors.wizard.runtime.resources.spell_slot_1).toBe(0);
    expect(paused.actors.fighter.runtime.hp.current).toBe(12);
    expect(paused.actors.fighter.runtime.activeEffects).toEqual([]);
    expect(paused.pendingResolution).toMatchObject({
      id: 'save-c3:id:1', targetActorId: 'fighter', actionId: 'spell.test-save-poison',
      request: { id: 'save-c3:id:2', type: 'saving_throw', ability: 'con', dc: 15 },
    });

    const blocked = opening.dispatch(command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'save-blocked', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard',
    }));
    expect(blocked).toMatchObject({ status: 'rejected', code: 'ResolutionInProgress' });

    const stale = opening.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'save-stale', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
      resolutionId: 'save-c3:id:1', requestId: 'tampered', response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 5 }] } },
    }));
    expect(stale).toMatchObject({ status: 'rejected', code: 'StaleDecision' });

    const invalid = opening.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'save-invalid', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
      resolutionId: 'save-c3:id:1', requestId: 'save-c3:id:2', response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 21 }] } },
    }));
    expect(invalid).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    expect(opening.getState()).toBe(paused);

    const restoredWorld = JSON.parse(JSON.stringify(paused)) as typeof paused;
    const effectTape = createStrictRngTape([{ label: 'poison damage', sides: 6, value: 6 }]);
    const restored = new InMemoryRulesSession(restoredWorld, catalog, {
      rng: effectTape.rng,
      clock: createLogicalClock(paused.logicalClock),
      nextId: createSequentialIdFactory('decision', 2),
    });
    const resolved = restored.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'save-c4', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
      resolutionId: 'save-c3:id:1', requestId: 'save-c3:id:2', response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 5 }] } },
    }));
    expect(resolved.status).toBe('accepted');
    effectTape.assertExhausted();

    const final = restored.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors.wizard.runtime.resources.spell_slot_1).toBe(0);
    expect(final.actors.fighter.runtime.hp.current).toBe(6);
    expect(final.actors.fighter.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'poisoned' }) }),
    ]);
    const combined = [...opening.getEvents(), ...restored.getEvents()];
    expect(foldEvents(initial, combined)).toEqual(final);
    const slotSpendCount = combined.filter((event) => event.payload.type === 'EngineEventRecorded'
      && event.payload.event.type === 'resource_spent'
      && event.payload.event.resource === 'spell_slot_1').length;
    expect(slotSpendCount).toBe(1);
  });

  it('pauses a hit before damage and lets Shield turn it into a miss after JSON reload', () => {
    const defender = actor('wizard', {
      capabilities: { actionIds: ['spell.test-shield'] },
    });
    const initial = createWorld({ id: 'world-shield', ruleset: RULESET, actors: [actor('fighter'), defender] });
    const openingTape = createStrictRngTape([{ label: 'attack roll', sides: 20, value: 10 }]);
    const opening = new InMemoryRulesSession(initial, catalog, {
      rng: openingTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('interrupt'),
    });
    expect(opening.dispatch(command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'shield-start', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', initiative: ['fighter', 'wizard'],
    })).status).toBe('accepted');
    expect(opening.dispatch(command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'shield-turn', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
    })).status).toBe('accepted');
    const declared = opening.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'shield-hit', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['wizard'], factsByTarget: { wizard: facts(5) },
    }));
    expect(declared.status).toBe('accepted');
    openingTape.assertExhausted();
    const paused = opening.getState();
    expect(paused.actors.fighter.runtime.resources.action).toBe(0);
    expect(paused.actors.wizard.runtime.hp.current).toBe(12);
    expect(paused.pendingResolution).toMatchObject({
      id: 'shield-hit:id:1', type: 'attack_reaction',
      request: {
        id: 'shield-hit:id:2', type: 'reaction', actorId: 'wizard',
        trigger: { attackTotal: 15, originalAc: 12 },
        options: [{ actionId: 'spell.test-shield', label: 'Щит' }],
      },
    });

    const restored = new InMemoryRulesSession(JSON.parse(JSON.stringify(paused)), catalog, {
      rng: () => { throw new Error('Shielded miss must not roll damage'); },
      clock: createLogicalClock(paused.logicalClock),
      nextId: createSequentialIdFactory('interrupt', 2),
    });
    const resolved = restored.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'shield-accept', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard',
      resolutionId: 'shield-hit:id:1', requestId: 'shield-hit:id:2',
      response: { kind: 'reaction', actionId: 'spell.test-shield' },
    }));
    expect(resolved.status).toBe('accepted');
    const final = restored.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors.wizard.runtime.hp.current).toBe(12);
    expect(final.actors.wizard.runtime.resources).toMatchObject({ reaction: 0, spell_slot_1: 0 });
    expect(final.actors.wizard.runtime.activeEffects).toEqual([
      expect.objectContaining({ id: 'shield-accept:id:1', mechanics: expect.objectContaining({ applies_to: { roll: 'ac' } }) }),
    ]);
    expect(resolved.status === 'accepted' ? resolved.events : []).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared', actorId: 'wizard', actionId: 'spell.test-shield',
        actionKind: 'spell', timing: 'reaction', spell: { baseLevel: 1, castLevel: 1, sourceClass: 'wizard' },
      }),
    }));
    const finalAttack = resolved.status === 'accepted'
      ? resolved.events.findLast((event) => event.payload.type === 'EngineEventRecorded'
          && event.payload.event.type === 'roll')
      : undefined;
    expect(finalAttack?.payload).toMatchObject({
      type: 'EngineEventRecorded',
      event: { label: 'Атака — после реакции', roll: { target: { value: 17 }, outcome: 'miss' } },
    });
    expect(foldEvents(initial, [...opening.getEvents(), ...restored.getEvents()])).toEqual(final);
  });

  it('applies the suspended damage exactly once when the target declines Shield', () => {
    const defender = actor('wizard', { capabilities: { actionIds: ['spell.test-shield'] } });
    const initial = createWorld({ id: 'world-shield-decline', ruleset: RULESET, actors: [actor('fighter'), defender] });
    const tape = createStrictRngTape([
      { label: 'attack roll', sides: 20, value: 10 },
      { label: 'damage', sides: 6, value: 4 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('decline'),
    });
    for (const cmd of [
      command({ schemaVersion: 1, type: 'StartEncounter' as const, commandId: 'd1', expectedRevision: 0,
        rulesetContentHash: RULESET.contentHash, actorId: 'fighter', initiative: ['fighter', 'wizard'] }),
      command({ schemaVersion: 1, type: 'StartTurn' as const, commandId: 'd2', expectedRevision: 1,
        rulesetContentHash: RULESET.contentHash, actorId: 'fighter' }),
      command({ schemaVersion: 1, type: 'UseAction' as const, commandId: 'd3', expectedRevision: 2,
        rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
        targetIds: ['wizard'], factsByTarget: { wizard: facts(5) } }),
    ]) expect(session.dispatch(cmd).status).toBe('accepted');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'd4', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard',
      resolutionId: 'd3:id:1', requestId: 'd3:id:2',
      response: { kind: 'reaction', actionId: null },
    })).status).toBe('accepted');
    tape.assertExhausted();
    expect(session.getState().actors.wizard.runtime.hp.current).toBe(8);
    expect(session.getState().actors.wizard.runtime.resources).toMatchObject({ reaction: 1, spell_slot_1: 1 });
    const damageEvents = session.getEvents().filter((event) => event.payload.type === 'EngineEventRecorded'
      && event.payload.event.type === 'damage');
    expect(damageEvents).toHaveLength(1);
  });

  it('fails closed when an actor invokes an ungranted action or a reaction outside its window', () => {
    const initial = createWorld({ id: 'world-ownership', ruleset: RULESET, actors: [
      actor('fighter', { capabilities: { actionIds: [] } }),
      actor('wizard', { capabilities: { actionIds: ['spell.test-shield'] } }),
    ] });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('invalid capability must not roll'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'o1', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', initiative: ['fighter', 'wizard'],
    })).status).toBe('accepted');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'o2', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter',
    })).status).toBe('accepted');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'o3', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['wizard'], factsByTarget: { wizard: facts(5) },
    }))).toMatchObject({ status: 'rejected', code: 'ActionNotGranted' });

    const exploration = createWorld({ id: 'reaction-timing', ruleset: RULESET, actors: [
      actor('wizard', { capabilities: { actionIds: ['spell.test-shield'] } }), actor('fighter'),
    ] });
    const timing = new InMemoryRulesSession(exploration, catalog, {
      rng: () => { throw new Error('invalid timing must not roll'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(timing.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'o4', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'wizard', actionId: 'spell.test-shield',
      targetIds: [],
    }))).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
  });

  it('enforces condition-denied action economy before costs or rolls', () => {
    const incapacitated = actor('fighter', {
      runtime: {
        ...actor('fighter').runtime,
        activeEffects: [{
          id: 'condition:incapacitated',
          name: 'Недееспособен',
          source: 'test',
          mechanics: { kind: 'condition', value: 'incapacitated' },
        }],
      },
    });
    const initial = createWorld({ id: 'world-condition-legality', ruleset: RULESET, actors: [incapacitated, actor('wizard')] });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('a denied action must not roll'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'denied-action', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['wizard'], factsByTarget: { wizard: facts(5) },
    }))).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    expect(session.getState()).toBe(initial);
  });

  it('tracks concentration across actors and removes linked effects when replaced', () => {
    const caster = actor('cleric', {
      runtime: {
        ...actor('cleric').runtime,
        resources: { action: 2, bonus_action: 1, reaction: 1, spell_slot_1: 2 },
        maxResources: { action: 2, bonus_action: 1, reaction: 1, spell_slot_1: 2 },
      },
    });
    const initial = createWorld({ id: 'world-concentration', ruleset: RULESET, actors: [caster, actor('rogue')] });
    const damageTape = createStrictRngTape([
      { label: 'attack concentration', sides: 20, value: 10 },
      { label: 'damage concentration', sides: 6, value: 4 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: damageTape.rng,
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    const useBless = (commandId: string, expectedRevision: number) => session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId, expectedRevision,
      rulesetContentHash: RULESET.contentHash, actorId: 'cleric', actionId: 'spell.test-bless',
      targetIds: ['rogue'], factsByTarget: { rogue: { ...facts(30), relation: 'ally' as const } },
      spell: { baseLevel: 1 },
    }));
    expect(useBless('bless-1', 0).status).toBe('accepted');
    expect(session.getState().concentrations.cleric).toMatchObject({
      id: 'bless-1:concentration', actionId: 'spell.test-bless',
      effectLinks: [{ actorId: 'rogue', effectId: 'bless-1:id:1' }],
    });
    expect(session.getState().actors.rogue.runtime.activeEffects.map((effect) => effect.id)).toEqual(['bless-1:id:1']);

    expect(useBless('bless-2', 1).status).toBe('accepted');
    expect(session.getState().concentrations.cleric).toMatchObject({
      id: 'bless-2:concentration',
      effectLinks: [{ actorId: 'rogue', effectId: 'bless-2:id:1' }],
    });
    expect(session.getState().actors.rogue.runtime.activeEffects.map((effect) => effect.id)).toEqual(['bless-2:id:1']);

    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'break-concentration', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'rogue', actionId: 'action.test-strike',
      targetIds: ['cleric'], factsByTarget: { cleric: facts(5) },
    })).status).toBe('accepted');
    damageTape.assertExhausted();
    expect(session.getState().pendingResolution).toMatchObject({
      id: 'break-concentration:id:1', type: 'concentration_save', actorId: 'cleric',
      concentrationId: 'bless-2:concentration', damage: 4,
      request: { id: 'break-concentration:id:2', ability: 'con', dc: 10 },
    });
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'fail-concentration', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'cleric',
      resolutionId: 'break-concentration:id:1', requestId: 'break-concentration:id:2',
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] } },
    })).status).toBe('accepted');
    expect(session.getState().concentrations.cleric).toBeUndefined();
    expect(session.getState().actors.rogue.runtime.activeEffects).toEqual([]);
    expect(foldEvents(initial, session.getEvents())).toEqual(session.getState());
  });

  it('applies Eldritch Mind only to the Constitution save made to maintain Concentration', () => {
    const eldritchMind = {
      kind: 'modifier',
      op: 'advantage',
      source: 'Eldritch Mind',
      applies_to: {
        roll: 'saving_throw',
        filter: { ability: 'con', reason: 'maintain_concentration' },
      },
    };
    const warlock = actor('warlock', { passives: [eldritchMind] });
    const initial = createWorld({
      id: 'world-eldritch-mind', ruleset: RULESET,
      actors: [warlock, actor('ally'), actor('fighter')],
    });
    const tape = createStrictRngTape([
      { label: 'fighter attack', sides: 20, value: 10 },
      { label: 'fighter damage', sides: 6, value: 4 },
      { label: 'ordinary Constitution save', sides: 20, value: 10 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });

    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'eldritch-bless', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'warlock', actionId: 'spell.test-bless',
      targetIds: ['ally'], factsByTarget: { ally: { ...facts(30), relation: 'ally' as const } },
      spell: { baseLevel: 1 },
    })).status).toBe('accepted');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'eldritch-damage', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: 'action.test-strike',
      targetIds: ['warlock'], factsByTarget: { warlock: facts(5) },
    })).status).toBe('accepted');
    const pending = session.getState().pendingResolution;
    expect(pending).toMatchObject({ type: 'concentration_save', actorId: 'warlock' });
    if (!pending || pending.type !== 'concentration_save') throw new Error('Expected concentration save');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'eldritch-save', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'warlock',
      resolutionId: pending.id, requestId: pending.request.id,
      response: {
        kind: 'roll',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }, { sides: 20, value: 12 }] },
      },
    })).status).toBe('accepted');
    expect(session.getState().concentrations.warlock).toBeDefined();

    expect(session.dispatch(command({
      schemaVersion: 1, type: 'SavingThrow', commandId: 'ordinary-con-save', expectedRevision: 3,
      rulesetContentHash: RULESET.contentHash, actorId: 'warlock', ability: 'con', dc: 10,
    })).status).toBe('accepted');
    tape.assertExhausted();

    const rolls = session.getEvents().flatMap((event) => (
      event.payload.type === 'EngineEventRecorded' && event.payload.event.type === 'roll'
        ? [{ label: event.payload.event.label, roll: event.payload.event.roll }]
        : []
    ));
    const concentrationRoll = rolls.find((entry) => entry.label.startsWith('Концентрация'))?.roll;
    expect(concentrationRoll).toMatchObject({
      advantage: 'advantage',
      dice: [{ sides: 20, result: 12 }, { sides: 20, result: 2, discarded: true }],
      outcome: 'success',
    });
    expect(rolls.at(-1)?.roll).toMatchObject({ advantage: 'none', dice: [{ sides: 20, result: 10 }] });
    expect(foldEvents(initial, session.getEvents())).toEqual(session.getState());
  });

  it('ends concentration and every linked effect when its owner becomes Incapacitated', () => {
    const stun: RuleActionDefinition = {
      id: 'action.test-stun',
      name: 'Проверочное оглушение',
      kind: 'nonSpell',
      sourceEntityIds: ['action.test-stun'],
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 30, requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        effects: [{
          resolution: 'auto', who: 'target',
          result: [{ kind: 'condition', value: 'stunned', op: 'apply', duration: { type: 'rounds', amount: 1 } }],
        }],
      },
    };
    const stunCatalog: RulesCatalog = {
      getAction: (id) => id === stun.id ? stun : catalog.getAction(id),
    };
    const fighter = actor('fighter', { capabilities: { actionIds: [stun.id] } });
    const initial = createWorld({ id: 'world-incapacitated-concentration', ruleset: RULESET, actors: [actor('cleric'), actor('rogue'), fighter] });
    const session = new InMemoryRulesSession(initial, stunCatalog, {
      rng: () => { throw new Error('these automatic effects must not roll'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'incap-bless', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'cleric', actionId: 'spell.test-bless',
      targetIds: ['rogue'], factsByTarget: { rogue: { ...facts(30), relation: 'ally' as const } },
      spell: { baseLevel: 1 },
    })).status).toBe('accepted');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'incap-stun', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'fighter', actionId: stun.id,
      targetIds: ['cleric'], factsByTarget: { cleric: facts(30) },
    })).status).toBe('accepted');

    expect(session.getState().concentrations.cleric).toBeUndefined();
    expect(session.getState().actors.rogue.runtime.activeEffects).toEqual([]);
    expect(session.getState().actors.cleric.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'stunned' }) }),
    ]);
    expect(session.getEvents()).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ConcentrationCleared', sourceActorId: 'cleric', reason: 'incapacitated',
      }),
    }));
    expect(foldEvents(initial, session.getEvents())).toEqual(session.getState());
  });

  it('restores Pact Magic on a short rest only outside an encounter', () => {
    const warlock = actor('warlock', {
      character: {
        ...actor('warlock').character,
        resourceRecharge: { spell_slot_1: 'short_rest' },
      },
      runtime: {
        ...actor('warlock').runtime,
        resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 0 },
      },
    });
    const initial = createWorld({ id: 'world-rest', ruleset: RULESET, actors: [warlock, actor('fighter')] });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: () => { throw new Error('rest must not roll without a save-ending effect'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory(),
    });
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'TakeShortRest', commandId: 'rest-1', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: 'warlock',
    })).status).toBe('accepted');
    expect(session.getState().actors.warlock.runtime.resources.spell_slot_1).toBe(1);
    expect(session.getEvents().some((event) => event.payload.type === 'EngineEventRecorded'
      && event.payload.event.type === 'short_rest')).toBe(true);

    expect(session.dispatch(command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'rest-2', expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash, actorId: 'warlock', initiative: ['warlock', 'fighter'],
    })).status).toBe('accepted');
    expect(session.dispatch(command({
      schemaVersion: 1, type: 'TakeShortRest', commandId: 'rest-3', expectedRevision: 2,
      rulesetContentHash: RULESET.contentHash, actorId: 'warlock',
    }))).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
  });
});
