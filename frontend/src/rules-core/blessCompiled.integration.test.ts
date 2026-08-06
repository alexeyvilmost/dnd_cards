import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import type {
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
} from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './testing/compiledMicroMvpAcceptanceCorpus';
import {
  createCompiledRuntimeScenarioFoundation,
  runCompiledRuntimeScenario,
} from './testing/compiledMicroMvpSpeciesFeatStyleRuntime';

const BLESS_CARD = 'SPELL-0163';

const PROBE_ATTACK: RuleActionDefinition = {
  id: 'test:bless:attack-roll',
  name: 'Bless attack probe',
  kind: 'nonSpell',
  sourceEntityIds: ['test:bless:attack-roll'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }],
  },
};

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled Bless fixture: ${label}`);
  return value;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function facts(relation: SpatialFacts['relation']): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt: relation === 'self' ? 0 : 5,
    lineOfSight: true,
    cover: 'none',
    relation,
    ...(relation === 'ally' ? { willing: true } : {}),
  };
}

function acceptedEvents(
  result: ReturnType<InMemoryRulesSession['dispatch']>,
): UncommittedRuleEvent[] {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result.events;
}

function rolls(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' && entry.payload.event.type === 'roll'
      ? [entry.payload.event.roll]
      : []
  ));
}

describe('compiled PHB 2024 Bless runtime', () => {
  let provider: CompiledMicroMvpL1Provider;
  let acceptanceCorpus: CompiledMicroMvpAcceptanceCorpus;
  let clericRoot: CompiledMicroMvpL1Root;
  let supportRoot: CompiledMicroMvpL1Root;
  let bless: Extract<RuleActionDefinition, { kind: 'spell' }>;
  let blessGrantId: string;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled Bless tests');
    };
    try {
      acceptanceCorpus = await compileMicroMvpAcceptanceCorpus();
      provider = acceptanceCorpus.compiled;
      const clericBase = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-cleric'
      )), 'Cleric root');
      clericRoot = await compileMicroMvpL1ChoiceVariant({
        stableKey: clericBase.stableKey,
        overrides: {
          cleric_spells_l1: ['SPELL-0214', BLESS_CARD, 'SPELL-0236', 'SPELL-0252'],
        },
      });
      supportRoot = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-warrior'
      )), 'Fighter support');
      const spell = required(
        clericRoot.assembled.spells.find((candidate) => candidate.card_number === BLESS_CARD),
        'Bless entity',
      );
      const action = required(clericRoot.rulesActions.find((candidate) => (
        candidate.kind === 'spell' && candidate.sourceEntityIds.includes(spell.id)
      )), 'Bless action');
      if (action.kind !== 'spell') throw new Error('Bless compiled as a non-spell action');
      bless = action;
      blessGrantId = required(clericRoot.actor.spellcastingAccess?.grants.find((grant) => (
        grant.actionId === bless.id && grant.sourceId === 'CLASS-cleric'
      )), 'prepared Bless grant').grantId;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('adds the compiled spell’s persistent d4 to an ally attack and save, but never a check', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-BLESS-COMPILED-01' },
  }, () => {
    const protocol = createCompiledRuntimeScenarioFoundation({
      corpus: acceptanceCorpus,
      root: clericRoot,
      index: 9_020,
      idPrefix: 'compiled-bless-mandatory',
    });
    runCompiledRuntimeScenario({ foundation: protocol, spec: copy(protocol.spec) });

    const cleric = copy(clericRoot.actor) as ActorState;
    cleric.id = 'cleric';
    cleric.controllerId = 'cleric:controller';
    const ally = copy(supportRoot.actor) as ActorState;
    ally.id = 'ally';
    ally.controllerId = 'ally:controller';
    ally.capabilities = {
      ...ally.capabilities,
      actionIds: [...ally.capabilities.actionIds, PROBE_ATTACK.id],
      featureSources: {
        ...(ally.capabilities.featureSources ?? {}),
        [PROBE_ATTACK.id]: [PROBE_ATTACK.sourceEntityIds[0]],
      },
    };

    const actions = new Map<string, RuleActionDefinition>([
      ...clericRoot.rulesActions.map((action) => [action.id, action] as const),
      [PROBE_ATTACK.id, PROBE_ATTACK],
    ]);
    const catalog: RulesCatalog = { getAction: (id) => actions.get(id) };
    const initial = createWorld({
      id: 'compiled-bless-runtime',
      ruleset: provider.ruleset,
      actors: [cleric, ally],
    });
    const tape = createStrictRngTape([
      { label: 'Blessed attack d20', sides: 20, value: 8 },
      { label: 'Blessed attack d4', sides: 4, value: 3 },
      { label: 'Unblessed ability check d20', sides: 20, value: 9 },
      { label: 'Blessed save d20', sides: 20, value: 7 },
      { label: 'Blessed save d4', sides: 4, value: 4 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(50_000),
      nextId: createSequentialIdFactory('compiled-bless'),
    });

    acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'StartEncounter',
      commandId: 'compiled-bless:encounter',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: cleric.id,
      initiative: [cleric.id, ally.id],
    }));
    acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'compiled-bless:cleric-turn',
      expectedRevision: 1,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: cleric.id,
    }));

    const castEvents = acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'compiled-bless:cast',
      expectedRevision: 2,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: cleric.id,
      actionId: bless.id,
      targetIds: [ally.id],
      factsByTarget: { [ally.id]: facts('ally') },
      spell: { baseLevel: 1, grantId: blessGrantId, mode: 'normal' },
    }));
    expect(session.getState().actors.ally.runtime.activeEffects).toHaveLength(2);
    expect(session.getState().concentrations.cleric.effectLinks).toHaveLength(2);
    expect(castEvents).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actionId: bless.id,
        spell: expect.objectContaining({
          grantId: blessGrantId,
          sourceId: 'CLASS-cleric',
          payment: { kind: 'slot', resource: 'spell_slot_1' },
        }),
      }),
    }));

    acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'compiled-bless:cleric-end',
      expectedRevision: 3,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: cleric.id,
    }));
    const checkpoint = migrateWorldState(copy(session.getState()));
    expect(checkpoint).toEqual(session.getState());
    acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'compiled-bless:ally-turn',
      expectedRevision: 4,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: ally.id,
    }));

    const attackRoll = required(rolls(acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'compiled-bless:attack',
      expectedRevision: 5,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: ally.id,
      actionId: PROBE_ATTACK.id,
      targetIds: [cleric.id],
      factsByTarget: { [cleric.id]: facts('enemy') },
    }))).find((roll) => roll.kind === 'd20'), 'Blessed attack roll');
    expect(attackRoll.dice).toContainEqual({
      sides: 4,
      result: 3,
      source: 'Благословение',
    });

    const checkRoll = required(rolls(acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'AbilityCheck',
      commandId: 'compiled-bless:check',
      expectedRevision: 6,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: ally.id,
      ability: 'str',
      dc: 10,
    })))[0], 'ability check');
    expect(checkRoll.dice.some((die) => die.sides === 4)).toBe(false);

    const saveRoll = required(rolls(acceptedEvents(session.dispatch({
      schemaVersion: 1,
      type: 'SavingThrow',
      commandId: 'compiled-bless:save',
      expectedRevision: 7,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: ally.id,
      ability: 'dex',
      dc: 10,
    })))[0], 'Blessed saving throw');
    expect(saveRoll.dice).toContainEqual({
      sides: 4,
      result: 4,
      source: 'Благословение',
    });
    expect(session.getState().actors.ally.runtime.activeEffects).toHaveLength(2);
    expect(foldEvents(copy(initial), copy(session.getEvents()))).toEqual(session.getState());
    tape.assertExhausted();
  });
});
