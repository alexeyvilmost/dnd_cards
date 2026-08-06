import { describe, expect, it } from 'vitest';
import { executeAction } from '../engine/execute';
import type { ActiveEffectEntry } from '../mvp/contracts';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'timing-primitives@1',
  contentHash: 'sha256:timing-primitives',
  errataVersion: 'test-1',
};

const ALERT_SOURCES = [
  '642812ee-4ac3-44b8-bdda-beeeee15213a',
  'FEAT-0001',
  'b906d245-c982-4e60-a5b3-85f915d530e9',
  'EFF-alert',
] as [string, ...string[]];

const APPLY_TIMERS: RuleActionDefinition = {
  id: 'test.apply-source-turn-effects',
  name: 'Source-turn effects',
  kind: 'nonSpell',
  sourceEntityIds: ['PHB:ray-of-frost', 'PHB:guiding-bolt', 'PHB:chill-touch'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 60,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Source-turn effects',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll',
      ability: 'dex',
      on_hit: [
        {
          kind: 'modifier',
          stack_id: 'ray-of-frost-speed',
          applies_to: { roll: 'speed' },
          op: 'add',
          value: '-10',
          duration: { type: 'until_start_of_source_next_turn' },
        },
        {
          kind: 'modifier',
          stack_id: 'guiding-bolt-advantage',
          applies_to: { roll: 'attack' },
          op: 'advantage',
          scope: 'target',
          consume: 'next',
          duration: { type: 'until_end_of_source_next_turn' },
        },
        {
          kind: 'modifier',
          stack_id: 'chill-touch-healing-lock',
          applies_to: { roll: 'healing' },
          op: 'deny',
          duration: { type: 'until_end_of_source_next_turn' },
        },
      ],
    }],
  },
};

const STRIKE: RuleActionDefinition = {
  id: 'test.strike',
  name: 'Strike',
  kind: 'nonSpell',
  sourceEntityIds: ['PHB:attack'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Strike',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{ resolution: 'attack_roll', ability: 'dex', on_hit: [] }],
  },
};

const ACTIONS = [APPLY_TIMERS, STRIKE] as const;
const catalog: RulesCatalog = { getAction: (id) => ACTIONS.find((action) => action.id === id) };
const noActions: RulesCatalog = { getAction: () => undefined };

function actor(id: string, options: {
  actionIds?: string[];
  alert?: boolean;
  effects?: ActiveEffectEntry[];
  hp?: number;
} = {}): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}-controller`,
    ac: 10,
    capabilities: {
      actionIds: options.actionIds ?? [],
      ...(options.alert ? {
        featureSources: {
          'alert.initiative_swap': [...ALERT_SOURCES] as [string, ...string[]],
        },
      } : {}),
    },
    character: {
      abilityMods: { str: 0, dex: 2, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: options.hp ?? 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {},
      inventory: [],
      activeEffects: options.effects ?? [],
    },
  };
}

function alertActorWithSources(sourceEntityIds: unknown): ActorState {
  const value = actor('alert');
  value.capabilities.featureSources = {
    'alert.initiative_swap': sourceEntityIds as [string, ...string[]],
  };
  return value;
}

function command<T>(value: T): T {
  return value;
}

function createSession(
  initial: ReturnType<typeof createWorld>,
  rules: RulesCatalog,
  rng: () => number = () => { throw new Error('this command must not roll'); },
) {
  return new InMemoryRulesSession(initial, rules, {
    rng,
    clock: createLogicalClock(),
    nextId: createSequentialIdFactory('ignored-by-command-scoped-ids'),
  });
}

function startEncounter(session: InMemoryRulesSession, initiative: string[]) {
  return session.dispatch(command({
    schemaVersion: 1,
    type: 'StartEncounter',
    commandId: `encounter-${session.getState().revision}`,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: initiative[0],
    initiative,
  }));
}

function dispatch(session: InMemoryRulesSession, value: Record<string, unknown>) {
  return session.dispatch({ ...value, expectedRevision: session.getState().revision } as GameCommand);
}

const enemyFacts = (distanceFt: number) => ({
  factsSource: 'scenario' as const,
  boardRevision: 1,
  distanceFt,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
});

describe('Alert and source-turn-relative timing primitives', () => {
  it('swaps Alert Initiative in the post-roll window with canonical provenance and deterministic replay', () => {
    const initial = createWorld({
      id: 'alert-swap',
      ruleset: RULESET,
      actors: [actor('alert', { alert: true }), actor('ally'), actor('enemy')],
    });
    const rules = createSession(initial, noActions);
    expect(startEncounter(rules, ['alert', 'ally', 'enemy']).status).toBe('accepted');
    const swapped = dispatch(rules, command({
      schemaVersion: 1,
      type: 'SwapInitiative',
      commandId: 'alert-swap',
      rulesetContentHash: RULESET.contentHash,
      actorId: 'alert',
      allyActorId: 'ally',
      facts: {
        factsSource: 'board',
        boardRevision: 7,
        relation: 'ally',
        willing: true,
        confirmedByControllerId: 'ally-controller',
      },
    }));

    expect(swapped.status).toBe('accepted');
    expect(rules.getState().scene).toMatchObject({
      mode: 'encounter',
      initiative: ['ally', 'alert', 'enemy'],
      initiativeSwapActorIds: ['alert'],
      activeIndex: 0,
      turnStarted: false,
    });
    const trace = (swapped.status === 'accepted' ? swapped.events : []).find((event) => (
      event.payload.type === 'EngineEventRecorded'
    ));
    expect(trace).toMatchObject({
      sourceActorId: 'alert',
      obligationIds: expect.arrayContaining([
        'system:initiative-swap', 'entity:FEAT-0001', 'entity:EFF-alert',
      ]),
      payload: {
        type: 'EngineEventRecorded',
        actorId: 'alert',
        targetIds: ['ally'],
        facts: {
          capabilityId: 'alert.initiative_swap',
          sourceEntityIds: ALERT_SOURCES,
          consent: expect.objectContaining({
            willing: true,
            confirmedByControllerId: 'ally-controller',
          }),
          before: { initiative: ['alert', 'ally', 'enemy'] },
          after: { initiative: ['ally', 'alert', 'enemy'] },
        },
      },
    });

    const duplicate = dispatch(rules, command({
      schemaVersion: 1,
      type: 'SwapInitiative',
      commandId: 'alert-swap-again',
      rulesetContentHash: RULESET.contentHash,
      actorId: 'alert',
      allyActorId: 'ally',
      facts: {
        factsSource: 'board', boardRevision: 8, relation: 'ally', willing: true,
        confirmedByControllerId: 'ally-controller',
      },
    }));
    expect(duplicate).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });

    const replayed = foldEvents(
      JSON.parse(JSON.stringify(initial)) as typeof initial,
      JSON.parse(JSON.stringify(rules.getEvents())) as UncommittedRuleEvent[],
    );
    expect(replayed).toEqual(JSON.parse(JSON.stringify(rules.getState())));
  });

  it('authorizes Alert from mechanics-owned capability provenance, independent of entity IDs', () => {
    const customSources = ['custom:alert:effect', 'custom:origin-feat'] as [string, ...string[]];
    const initial = createWorld({
      id: 'alert-custom-provenance',
      ruleset: RULESET,
      actors: [alertActorWithSources(customSources), actor('ally')],
    });
    const rules = createSession(initial, noActions);
    expect(startEncounter(rules, ['alert', 'ally']).status).toBe('accepted');
    const swapped = dispatch(rules, command({
      schemaVersion: 1,
      type: 'SwapInitiative',
      commandId: 'alert-custom-swap',
      rulesetContentHash: RULESET.contentHash,
      actorId: 'alert',
      allyActorId: 'ally',
      facts: {
        factsSource: 'board', boardRevision: 7, relation: 'ally', willing: true,
        confirmedByControllerId: 'ally-controller',
      },
    }));
    expect(swapped.status).toBe('accepted');
    expect(swapped.status === 'accepted' ? swapped.events : []).toContainEqual(
      expect.objectContaining({
        obligationIds: expect.arrayContaining(customSources.map((id) => `entity:${id}`)),
        payload: expect.objectContaining({
          type: 'EngineEventRecorded',
          facts: expect.objectContaining({ sourceEntityIds: customSources }),
        }),
      }),
    );
  });

  it('rejects Alert swaps without grant, consent, eligibility, or the immediate timing window', () => {
    const attempt = (
      worldActors: ActorState[],
      facts: Record<string, unknown>,
      afterStart = false,
    ) => {
      const initial = createWorld({ id: 'alert-rejection', ruleset: RULESET, actors: worldActors });
      const rules = createSession(initial, noActions);
      expect(startEncounter(rules, ['alert', 'ally']).status).toBe('accepted');
      if (afterStart) {
        expect(dispatch(rules, command({
          schemaVersion: 1,
          type: 'StartTurn',
          commandId: 'first-turn',
          rulesetContentHash: RULESET.contentHash,
          actorId: 'alert',
        })).status).toBe('accepted');
      }
      const before = rules.getState();
      const result = rules.dispatch({
        schemaVersion: 1,
        type: 'SwapInitiative',
        commandId: `rejected-${facts.confirmedByControllerId ?? 'facts'}-${afterStart}`,
        expectedRevision: before.revision,
        rulesetContentHash: RULESET.contentHash,
        actorId: 'alert',
        allyActorId: 'ally',
        facts,
      } as unknown as GameCommand);
      expect(rules.getState()).toBe(before);
      return result;
    };

    const consent = {
      factsSource: 'scenario', boardRevision: 1, relation: 'ally', willing: true,
      confirmedByControllerId: 'ally-controller',
    };
    expect(attempt([actor('alert'), actor('ally')], consent)).toMatchObject({
      status: 'rejected', code: 'FeatureNotGranted',
    });
    for (const invalidSources of [
      [],
      ['duplicate', 'duplicate'],
      [' padded-source '],
    ]) {
      expect(attempt([alertActorWithSources(invalidSources), actor('ally')], consent))
        .toMatchObject({ status: 'rejected', code: 'FeatureNotGranted' });
    }
    expect(attempt([actor('alert', { alert: true }), actor('ally')], {
      ...consent, willing: false,
    })).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    expect(attempt([actor('alert', { alert: true }), actor('ally', {
      effects: [{
        id: 'incapacitated', name: 'Incapacitated', source: 'test', expiry: 'manual',
        mechanics: { kind: 'condition', value: 'incapacitated' },
      }],
    })], consent)).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    expect(attempt([actor('alert', { alert: true }), actor('ally')], consent, true)).toMatchObject({
      status: 'rejected', code: 'InvalidActionTiming',
    });
  });

  it('persists owner/source lifecycle, ignores target turns, consumes Guiding Bolt, and expires on source boundaries', () => {
    const initial = createWorld({
      id: 'source-turn-expiry',
      ruleset: RULESET,
      actors: [
        actor('source', { actionIds: [APPLY_TIMERS.id] }),
        actor('attacker', { actionIds: [STRIKE.id] }),
        actor('target', { hp: 5 }),
      ],
    });
    const rolls = [15, 12, 5];
    let rollIndex = 0;
    const rules = createSession(initial, catalog, () => (rolls[rollIndex++] - 0.5) / 20);

    expect(startEncounter(rules, ['source', 'attacker', 'target']).status).toBe('accepted');
    expect(dispatch(rules, command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'source-start-1',
      rulesetContentHash: RULESET.contentHash, actorId: 'source',
    })).status).toBe('accepted');
    const applied = dispatch(rules, command({
      schemaVersion: 1, type: 'UseAction', commandId: 'apply-timers',
      rulesetContentHash: RULESET.contentHash, actorId: 'source', actionId: APPLY_TIMERS.id,
      targetIds: ['target'], factsByTarget: { target: enemyFacts(30) },
    }));
    expect(applied.status).toBe('accepted');
    expect(rollIndex).toBe(1);

    const appliedEffects = rules.getState().actors.target.runtime.activeEffects;
    expect(appliedEffects).toHaveLength(3);
    expect(appliedEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ownerId: 'target',
        sourceId: 'source',
        expiry: 'source_turn',
        sourceTurnExpiry: {
          sourceActorId: 'source', ownerActorId: 'target', boundary: 'start',
        },
      }),
      expect.objectContaining({
        ownerId: 'target',
        sourceId: 'source',
        sourceTurnExpiry: {
          sourceActorId: 'source', ownerActorId: 'target', boundary: 'end',
        },
      }),
    ]));
    expect(JSON.parse(JSON.stringify(appliedEffects))).toEqual(appliedEffects);

    const healingAttempt = executeAction(rules.getState().actors.target.runtime, {
      name: 'Healing while chilled',
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '1d8' }] }],
    }, {
      character: rules.getState().actors.target.character,
      selfId: 'target',
      rng: () => { throw new Error('denied healing must not roll'); },
    });
    expect(healingAttempt.events.some((event) => event.type === 'healing')).toBe(false);
    expect(healingAttempt.state.hp.current).toBe(5);

    expect(dispatch(rules, command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'source-end-1',
      rulesetContentHash: RULESET.contentHash, actorId: 'source',
    })).status).toBe('accepted');
    expect(rules.getState().actors.target.runtime.activeEffects).toHaveLength(3);

    expect(dispatch(rules, command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'attacker-start',
      rulesetContentHash: RULESET.contentHash, actorId: 'attacker',
    })).status).toBe('accepted');
    const strike = dispatch(rules, command({
      schemaVersion: 1, type: 'UseAction', commandId: 'consume-guiding-bolt',
      rulesetContentHash: RULESET.contentHash, actorId: 'attacker', actionId: STRIKE.id,
      targetIds: ['target'], factsByTarget: { target: enemyFacts(5) },
    }));
    expect(strike.status).toBe('accepted');
    expect(rollIndex).toBe(3);
    const strikeRoll = (strike.status === 'accepted' ? strike.events : []).flatMap((event) => (
      event.payload.type === 'EngineEventRecorded' && event.payload.event.type === 'roll'
        ? [event.payload.event.roll]
        : []
    ))[0];
    expect(strikeRoll?.advantage).toBe('advantage');
    expect(rules.getState().actors.target.runtime.activeEffects).toHaveLength(2);
    expect(rules.getState().actors.target.runtime.activeEffects.some((effect) => (
      (effect.mechanics as Record<string, unknown>).scope === 'target'
    ))).toBe(false);

    expect(dispatch(rules, command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'attacker-end',
      rulesetContentHash: RULESET.contentHash, actorId: 'attacker',
    })).status).toBe('accepted');
    expect(dispatch(rules, command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'target-start',
      rulesetContentHash: RULESET.contentHash, actorId: 'target',
    })).status).toBe('accepted');
    expect(dispatch(rules, command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'target-end',
      rulesetContentHash: RULESET.contentHash, actorId: 'target',
    })).status).toBe('accepted');
    expect(rules.getState().actors.target.runtime.activeEffects).toHaveLength(2);

    const sourceStart = dispatch(rules, command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'source-start-2',
      rulesetContentHash: RULESET.contentHash, actorId: 'source',
    }));
    expect(sourceStart.status).toBe('accepted');
    expect(rules.getState().actors.target.runtime.activeEffects).toHaveLength(1);
    expect(rules.getState().actors.target.runtime.activeEffects[0].sourceTurnExpiry).toEqual({
      sourceActorId: 'source', ownerActorId: 'target', boundary: 'end', armed: true,
    });
    expect((sourceStart.status === 'accepted' ? sourceStart.events : [])).toContainEqual(
      expect.objectContaining({
        sourceActorId: 'source',
        payload: expect.objectContaining({
          type: 'EngineEventRecorded',
          actorId: 'target',
          event: { type: 'effect_expired', name: 'Source-turn effects' },
        }),
      }),
    );

    const sourceEnd = dispatch(rules, command({
      schemaVersion: 1, type: 'EndTurn', commandId: 'source-end-2',
      rulesetContentHash: RULESET.contentHash, actorId: 'source',
    }));
    expect(sourceEnd.status).toBe('accepted');
    expect(rules.getState().actors.target.runtime.activeEffects).toEqual([]);

    const replayed = foldEvents(
      JSON.parse(JSON.stringify(initial)) as typeof initial,
      JSON.parse(JSON.stringify(rules.getEvents())) as UncommittedRuleEvent[],
    );
    expect(replayed).toEqual(JSON.parse(JSON.stringify(rules.getState())));
  });
});
