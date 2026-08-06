import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import type {
  ActorState,
  CommandResult,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from '../domain';
import { createWorld } from '../domain';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
  type DieTapeEntry,
  type StrictRngTape,
} from '../determinism';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';
import { migrateWorldState } from '../worldMigration';
import { withDeclaredTestWeaponProfile } from '../../testing/weaponProfileFixtures';
import {
  MICRO_MVP_SCENARIO_ACTION_IDS,
  MICRO_MVP_SCENARIO_CORPUS,
  runMicroMvpScenarioCase,
} from './microMvpScenarioCorpus';

type Accepted = Extract<CommandResult, { status: 'accepted' }>;

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'fighter-mandatory-scenarios@1',
  contentHash: 'sha256:fighter-mandatory-scenarios',
  errataVersion: 'micro-mvp',
};

const TOPPLE_ID = 'EFFECT-2024-TOPPLE';
const LONGSWORD = withDeclaredTestWeaponProfile({
  id: 'ITEM-2024-LONGSWORD',
  card_number: 'ITEM-longsword',
  name: 'Longsword',
  type: 'weapon',
  weapon_type: 'longsword',
  bonus_value: '1d8',
  damage_type: 'slashing',
  mastery: TOPPLE_ID,
} as unknown as Card, {
  weaponType: 'longsword',
  proficiencyCategory: 'martial',
  attackAbility: 'str',
  damageLines: [{ dice: '1d8', type: 'slashing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: [],
  masteryEffectId: TOPPLE_ID,
});

const TOPPLE = {
  name: 'Topple',
  mechanics: {
    activation: { mode: 'triggered', trigger: { event: 'hit' } },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'con',
      dc: '8 + prof + weapon_mod',
      on_fail: [{ kind: 'condition', value: 'prone', op: 'apply' }],
      on_success: [],
    }],
  },
};

const ATTACK: RuleActionDefinition = {
  id: 'action.weapon-attack',
  name: 'Weapon Attack',
  kind: 'nonSpell',
  sourceEntityIds: ['ACTION-2024-ATTACK'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Weapon Attack',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll',
      ability: 'str',
      on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
    }],
  },
};

const SHIELD: RuleActionDefinition = {
  id: 'spell.shield',
  name: 'Shield',
  kind: 'spell',
  sourceEntityIds: ['SPELL-2024-SHIELD'],
  spell: { level: 1, sourceClass: 'CLASS-wizard' },
  mechanics: {
    name: 'Shield',
    activation: {
      mode: 'reaction',
      trigger: { event: 'hit_by_attack' },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot_1' }],
    },
    effects: [{
      resolution: 'auto',
      result: [{
        kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+5',
        duration: { type: 'until_start_of_next_turn' },
      }],
    }],
  },
};

const CATALOG: RulesCatalog = {
  getAction: (id) => [ATTACK, SHIELD].find((action) => action.id === id),
};

const ATTACK_FACTS = {
  factsSource: 'scenario' as const,
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

function fighter(): ActorState {
  return {
    id: 'fighter',
    name: 'Fighter',
    kind: 'playerCharacter',
    controllerId: 'fighter-controller',
    ac: 16,
    capabilities: { actionIds: [ATTACK.id] },
    character: {
      abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      equippedCards: [LONGSWORD],
      knownCards: [LONGSWORD],
      weaponMasteries: ['longsword'],
      saveProficiencies: ['con'],
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: { main_hand: LONGSWORD.id },
      inventory: [],
      activeEffects: [],
    },
    masteryEffects: { [TOPPLE_ID]: TOPPLE },
  };
}

function wizard(options: { shield?: boolean; concentrating?: boolean }): ActorState {
  return {
    id: 'wizard',
    name: 'Wizard',
    kind: 'playerCharacter',
    controllerId: 'wizard-controller',
    ac: 12,
    capabilities: { actionIds: options.shield ? [SHIELD.id] : [] },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 24, max: 24, temp: 0 },
      resources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        ...(options.shield ? { spell_slot_1: 1 } : {}),
      },
      maxResources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        ...(options.shield ? { spell_slot_1: 1 } : {}),
      },
      equipment: {},
      inventory: [],
      activeEffects: options.concentrating ? [{
        id: 'bless-effect',
        name: 'Bless',
        source: 'Wizard',
        expiry: 'manual',
        mechanics: {
          kind: 'modifier',
          op: 'bonus_die',
          faces: 4,
          applies_to: { roll: 'saving_throw' },
        },
      }] : [],
    },
  };
}

function focusedWorld(options: { shield?: boolean; concentrating?: boolean }): WorldState {
  const created = createWorld({
    id: options.concentrating ? 'fighter-topple-concentration' : 'fighter-topple-shield',
    ruleset: RULESET,
    actors: [fighter(), wizard(options)],
  });
  if (!options.concentrating) return created;
  return {
    ...created,
    concentrations: {
      wizard: {
        id: 'wizard-concentration',
        sourceActorId: 'wizard',
        actionId: 'spell.bless',
        startedAtRevision: 0,
        effectLinks: [{ actorId: 'wizard', effectId: 'bless-effect' }],
      },
    },
  };
}

function assertMandatoryTwoPlayerFighterProtocol() {
  const scenario = MICRO_MVP_SCENARIO_CORPUS['SC-01'];
  const run = runMicroMvpScenarioCase(scenario);

  expect(scenario.spec.initiative).toEqual(['fighter', 'wizard']);
  expect(Object.values(run.initialState.actors)).toHaveLength(2);
  expect(Object.values(run.initialState.actors).every((actor) => (
    actor.kind === 'playerCharacter'
  ))).toBe(true);
  expect(run.finalState.scene).toMatchObject({
    mode: 'encounter',
    round: 2,
    initiative: ['fighter', 'wizard'],
    activeIndex: 1,
    turnStarted: false,
  });
  expect(run.rejections).toEqual([]);
  expect(run.checkpoints).toHaveLength(2);
  for (const checkpoint of run.checkpoints) {
    const persisted = JSON.parse(checkpoint) as WorldState;
    const migrated = migrateWorldState(copy(persisted));
    const canonical = copy(persisted);
    for (const actor of Object.values(canonical.actors)) {
      actor.capabilities.actionIds.sort((left, right) => left.localeCompare(right));
    }
    expect(migrated).toEqual(canonical);
    expect(migrateWorldState(copy(migrated))).toEqual(migrated);
  }
  expect(run.replayState).toEqual(run.finalState);
  expect(foldEvents(copy(run.initialState), copy(run.events))).toEqual(run.finalState);
  expect(run.rngConsumed).toBe(scenario.rngTape.length);
  expect(run.observedTrace).toEqual([
    'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
  ]);

  const declarations = run.events.flatMap((entry) => (
    entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
  ));
  expect(declarations).toContainEqual(expect.objectContaining({
    actorId: 'fighter',
    actionId: MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack,
    actionKind: 'nonSpell',
  }));
  expect(declarations).toContainEqual(expect.objectContaining({
    actorId: 'fighter',
    actionId: MICRO_MVP_SCENARIO_ACTION_IDS.secondWind,
    actionKind: 'nonSpell',
  }));
  expect(declarations).toContainEqual(expect.objectContaining({
    actorId: 'wizard',
    actionId: MICRO_MVP_SCENARIO_ACTION_IDS.thunderwave,
    actionKind: 'spell',
  }));

  const recorded = engineEvents(run.events);
  expect(recorded.some((event) => event.type === 'roll' && event.roll.kind === 'check')).toBe(true);
  expect(recorded.some((event) => event.type === 'roll' && event.roll.kind === 'save')).toBe(true);
  expect(recorded).toContainEqual({ type: 'condition_applied', condition: 'prone' });
  expect(run.finalState.actors.wizard.runtime.activeEffects).toContainEqual(
    expect.objectContaining({ mechanics: expect.objectContaining({ value: 'prone' }) }),
  );

  const turns = run.events.flatMap((entry) => {
    if (entry.payload.type !== 'EngineEventRecorded') return [];
    if (entry.payload.event.type !== 'turn_started' && entry.payload.event.type !== 'turn_ended') return [];
    return [`${entry.payload.event.type}:${entry.payload.actorId}`];
  });
  expect(turns).toEqual([
    'turn_started:fighter',
    'turn_ended:fighter',
    'turn_started:wizard',
    'turn_ended:wizard',
    'turn_started:fighter',
    'turn_ended:fighter',
  ]);

  return run;
}

class FocusedMasteryHarness {
  readonly initial: WorldState;
  readonly tape: StrictRngTape;
  readonly events: UncommittedRuleEvent[] = [];
  private readonly environment: {
    rng: StrictRngTape['rng'];
    clock: () => number;
    nextId: () => string;
  };
  private session: InMemoryRulesSession;
  private commandOrdinal = 0;
  private checkpointCount = 0;

  constructor(options: {
    id: string;
    shield?: boolean;
    concentrating?: boolean;
    dice: readonly DieTapeEntry[];
  }) {
    this.initial = {
      ...focusedWorld({ shield: options.shield, concentrating: options.concentrating }),
      id: options.id,
    };
    this.tape = createStrictRngTape(options.dice);
    this.environment = {
      rng: this.tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(`${options.id}:id`),
    };
    this.session = new InMemoryRulesSession(copy(this.initial), CATALOG, this.environment);
  }

  state(): WorldState {
    return this.session.getState();
  }

  dispatch(actorId: string, command: Record<string, unknown>): Accepted {
    this.commandOrdinal += 1;
    const result = this.session.dispatch({
      schemaVersion: 1,
      commandId: `${this.initial.id}:command:${this.commandOrdinal}`,
      expectedRevision: this.state().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId,
      ...command,
    } as unknown as GameCommand);
    if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
    this.events.push(...result.events);
    return result;
  }

  startFighterTurn(): void {
    this.dispatch('fighter', { type: 'StartEncounter', initiative: ['fighter', 'wizard'] });
    this.dispatch('fighter', { type: 'StartTurn' });
    expect(this.state().scene).toMatchObject({
      mode: 'encounter', initiative: ['fighter', 'wizard'], activeIndex: 0, turnStarted: true,
    });
  }

  attack(): Accepted {
    return this.dispatch('fighter', {
      type: 'UseAction',
      actionId: ATTACK.id,
      targetIds: ['wizard'],
      factsByTarget: { wizard: ATTACK_FACTS },
    });
  }

  checkpoint(): void {
    const before = copy(this.state());
    const migrated = migrateWorldState(JSON.parse(JSON.stringify(before)) as WorldState);
    expect(migrated).toEqual(before);
    expect(migrateWorldState(copy(migrated))).toEqual(migrated);
    this.session = new InMemoryRulesSession(copy(migrated), CATALOG, this.environment);
    this.checkpointCount += 1;
  }

  finish(): void {
    expect(Object.values(this.initial.actors)).toHaveLength(2);
    expect(Object.values(this.initial.actors).every((actor) => (
      actor.kind === 'playerCharacter'
    ))).toBe(true);
    expect(this.state().scene).toMatchObject({
      mode: 'encounter', initiative: ['fighter', 'wizard'], activeIndex: 0, turnStarted: true,
    });
    expect(this.state().pendingResolution).toBeNull();
    expect(this.checkpointCount).toBeGreaterThanOrEqual(2);
    this.tape.assertExhausted();
    expect(migrateWorldState(copy(this.state()))).toEqual(this.state());
    expect(foldEvents(copy(this.initial), copy(this.events))).toEqual(this.state());
  }
}

describe('Fighter mandatory protocol scenario evidence', () => {
  it('runs the Fighter L1 mandatory two-PC protocol through Second Wind and Topple with exact migration and replay', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FIGHTER-L1-01' },
  }, () => {
    const run = assertMandatoryTwoPlayerFighterProtocol();
    const fighterState = run.finalState.actors.fighter;
    expect(fighterState.character.level).toBe(1);
    expect(fighterState.character.weaponMasteries).toContain('longsword');
    expect(fighterState.runtime.hp.current).toBe(12);
    expect(fighterState.runtime.resources['uses_ACT-second-wind']).toBe(1);

    const fighterEvents = run.events.filter((entry) => entry.sourceActorId === 'fighter');
    expect(engineEvents(fighterEvents)).toContainEqual(expect.objectContaining({
      type: 'healing', amount: 5,
    }));
    expect(fighterEvents).toContainEqual(expect.objectContaining({
      obligationIds: expect.arrayContaining([
        'entity:project-rule:mastery.topple-l1-overlay',
        'system:weapon-mastery',
        'system:target-save',
      ]),
      payload: expect.objectContaining({
        type: 'EngineEventRecorded',
        event: { type: 'condition_applied', condition: 'prone' },
      }),
    }));
  });

  it('runs the mandatory two-PC protocol then resumes one Topple save after accepted Shield without repeating damage or costs', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FIGHTER-TOPPLE-SHIELD-01' },
  }, () => {
    assertMandatoryTwoPlayerFighterProtocol();

    const scenario = new FocusedMasteryHarness({
      id: 'fighter-topple-after-shield',
      shield: true,
      dice: [
        { label: 'attack before Shield', sides: 20, value: 15 },
        { label: 'damage after Shield', sides: 8, value: 4 },
      ],
    });
    scenario.startFighterTurn();
    const attack = scenario.attack();
    expect(scenario.state().pendingResolution).toMatchObject({
      type: 'attack_reaction', targetActorId: 'wizard',
    });
    expect(scenario.state().actors.wizard.runtime.hp.current).toBe(24);
    expect(engineEvents(attack.events).filter((event) => event.type === 'damage')).toEqual([]);
    scenario.checkpoint();

    const reaction = scenario.state().pendingResolution;
    if (!reaction || reaction.type !== 'attack_reaction') throw new Error('Shield reaction disappeared');
    const shield = scenario.dispatch('wizard', {
      type: 'ResolveDecision',
      resolutionId: reaction.id,
      requestId: reaction.request.id,
      response: { kind: 'reaction', actionId: SHIELD.id },
    });
    expect(scenario.state().actors.wizard.runtime.hp.current).toBe(17);
    expect(scenario.state().actors.wizard.runtime.resources).toMatchObject({
      reaction: 0, spell_slot_1: 0,
    });
    expect(scenario.state().actors.fighter.runtime.resources.action).toBe(0);
    expect(scenario.state().pendingResolution).toMatchObject({
      type: 'mastery_save',
      sourceActorId: 'fighter',
      targetActorId: 'wizard',
      mastery: { sourceEntityId: TOPPLE_ID, weaponMod: 3 },
      request: { ability: 'con', dc: 13 },
      followUps: [],
    });
    const shieldEvents = shield.events;
    const reactionClose = shieldEvents.findIndex((event) => (
      event.payload.type === 'ResolutionClosed'
    ));
    const masteryOpen = shieldEvents.findIndex((event) => (
      event.payload.type === 'ResolutionOpened'
      && event.payload.resolution.type === 'mastery_save'
    ));
    expect(reactionClose).toBeGreaterThanOrEqual(0);
    expect(masteryOpen).toBeGreaterThan(reactionClose);
    scenario.checkpoint();

    const mastery = scenario.state().pendingResolution;
    if (!mastery || mastery.type !== 'mastery_save') throw new Error('Topple continuation disappeared');
    const hpAfterDamage = scenario.state().actors.wizard.runtime.hp.current;
    const resourcesAfterDamage = copy(scenario.state().actors.wizard.runtime.resources);
    const resolved = scenario.dispatch('wizard', {
      type: 'ResolveDecision',
      resolutionId: mastery.id,
      requestId: mastery.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] } },
    });
    expect(engineEvents(resolved.events)).toContainEqual(expect.objectContaining({
      type: 'roll', roll: expect.objectContaining({ kind: 'save', outcome: 'fail' }),
    }));
    expect(scenario.state().actors.wizard.runtime.activeEffects).toContainEqual(
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'prone' }) }),
    );
    expect(scenario.state().actors.wizard.runtime.hp.current).toBe(hpAfterDamage);
    expect(scenario.state().actors.wizard.runtime.resources).toEqual(resourcesAfterDamage);
    expect(engineEvents(scenario.events).filter((event) => event.type === 'damage')).toHaveLength(1);
    expect(scenario.events.filter((event) => (
      event.payload.type === 'ResolutionOpened'
      && event.payload.resolution.type === 'mastery_save'
    ))).toHaveLength(1);
    scenario.checkpoint();
    scenario.finish();
  });

  it('runs the mandatory two-PC protocol then serializes Topple before Concentration across reloads with one pending decision', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FIGHTER-TOPPLE-CONCENTRATION-01' },
  }, () => {
    assertMandatoryTwoPlayerFighterProtocol();

    const scenario = new FocusedMasteryHarness({
      id: 'fighter-topple-concentration-queue',
      concentrating: true,
      dice: [
        { label: 'concentrator attack', sides: 20, value: 14 },
        { label: 'concentrator damage', sides: 8, value: 5 },
        { label: 'concentration save', sides: 20, value: 2 },
        { label: 'Bless on concentration save', sides: 4, value: 1 },
      ],
    });
    scenario.startFighterTurn();
    const attack = scenario.attack();
    expect(scenario.state().actors.wizard.runtime.hp.current).toBe(16);
    expect(scenario.state().pendingResolution).toMatchObject({
      type: 'mastery_save',
      targetActorId: 'wizard',
      followUps: [{
        type: 'concentration_save',
        actorId: 'wizard',
        concentrationId: 'wizard-concentration',
        damage: 8,
        dc: 10,
      }],
    });
    expect(attack.events.filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(1);
    scenario.checkpoint();

    const mastery = scenario.state().pendingResolution;
    if (!mastery || mastery.type !== 'mastery_save') throw new Error('Topple queue head disappeared');
    const toppled = scenario.dispatch('wizard', {
      type: 'ResolveDecision',
      resolutionId: mastery.id,
      requestId: mastery.request.id,
      response: {
        kind: 'roll',
        roll: {
          mode: 'manual',
          dice: [{ sides: 20, value: 3 }, { sides: 4, value: 1 }],
        },
      },
    });
    expect(scenario.state().pendingResolution).toMatchObject({
      type: 'concentration_save',
      request: { actorId: 'wizard', ability: 'con', dc: 10 },
    });
    expect(scenario.state().actors.wizard.runtime.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bless-effect' }),
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'prone' }) }),
    ]));
    const toppleClose = toppled.events.findIndex((event) => (
      event.payload.type === 'ResolutionClosed'
    ));
    const concentrationOpen = toppled.events.findIndex((event) => (
      event.payload.type === 'ResolutionOpened'
      && event.payload.resolution.type === 'concentration_save'
    ));
    expect(toppled.events.filter((event) => event.payload.type === 'ResolutionClosed')).toHaveLength(1);
    expect(toppled.events.filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(1);
    expect(concentrationOpen).toBeGreaterThan(toppleClose);
    scenario.checkpoint();

    const concentration = scenario.state().pendingResolution;
    if (!concentration || concentration.type !== 'concentration_save') {
      throw new Error('Concentration queue tail disappeared');
    }
    const resolved = scenario.dispatch('wizard', {
      type: 'ResolveDecision',
      resolutionId: concentration.id,
      requestId: concentration.request.id,
      response: { kind: 'roll', roll: { mode: 'system' } },
    });
    expect(engineEvents(resolved.events)).toContainEqual(expect.objectContaining({
      type: 'roll', roll: expect.objectContaining({ kind: 'save', outcome: 'fail' }),
    }));
    expect(scenario.state().concentrations).toEqual({});
    expect(scenario.state().actors.wizard.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'prone' }) }),
    ]);
    expect(engineEvents(scenario.events).filter((event) => event.type === 'damage')).toHaveLength(1);
    expect(scenario.events.filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(2);
    expect(scenario.events.filter((event) => event.payload.type === 'ResolutionClosed')).toHaveLength(2);
    scenario.checkpoint();
    scenario.finish();
  });
});
