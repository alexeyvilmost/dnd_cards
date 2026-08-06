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

const ARMOR_OF_AGATHYS_CARD = 'SPELL-0189';

const ENEMY_FACTS: SpatialFacts = {
  factsSource: 'scenario', boardRevision: 1, distanceFt: 5,
  lineOfSight: true, cover: 'none', relation: 'enemy',
};

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled Armor of Agathys fixture: ${label}`);
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function acceptedEvents(
  result: ReturnType<InMemoryRulesSession['dispatch']>,
): UncommittedRuleEvent[] {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result.events;
}

function base(
  session: InMemoryRulesSession,
  provider: CompiledMicroMvpL1Provider,
  commandId: string,
  actorId: string,
) {
  return {
    schemaVersion: 1 as const,
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: provider.ruleset.contentHash,
    actorId,
  };
}

describe('compiled PHB 2024 Armor of Agathys scenario', () => {
  let provider: CompiledMicroMvpL1Provider;
  let acceptanceCorpus: CompiledMicroMvpAcceptanceCorpus;
  let warlockRoot: CompiledMicroMvpL1Root;
  let fighterRoot: CompiledMicroMvpL1Root;
  let armor: Extract<RuleActionDefinition, { kind: 'spell' }>;
  let grantId: string;
  let slotResource: string;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled Armor of Agathys tests');
    };
    try {
      acceptanceCorpus = await compileMicroMvpAcceptanceCorpus();
      provider = acceptanceCorpus.compiled;
      const warlockBase = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-warlock'
      )), 'Warlock root');
      warlockRoot = await compileMicroMvpL1ChoiceVariant({
        stableKey: warlockBase.stableKey,
        overrides: { warlock_spells_known: ['detect_magic', ARMOR_OF_AGATHYS_CARD] },
      });
      fighterRoot = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-warrior'
      )), 'Fighter root');
      const spell = required(warlockRoot.assembled.spells.find((candidate) => (
        candidate.card_number === ARMOR_OF_AGATHYS_CARD
      )), 'spell entity');
      const action = required(warlockRoot.rulesActions.find((candidate) => (
        candidate.kind === 'spell' && candidate.sourceEntityIds.includes(spell.id)
      )), 'spell action');
      if (action.kind !== 'spell') throw new Error('Armor of Agathys compiled as non-spell');
      armor = action;
      const grant = required(warlockRoot.actor.spellcastingAccess?.grants.find((candidate) => (
        candidate.actionId === armor.id && candidate.sourceId === 'CLASS-warlock'
      )), 'Warlock grant');
      grantId = grant.grantId;
      slotResource = required(grant.slotResource, 'Warlock slot resource');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('casts the compiled source on turn one, retaliates against the other PC on turn two, and replays exactly', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-ARMOR-OF-AGATHYS-01' },
  }, () => {
    const protocol = createCompiledRuntimeScenarioFoundation({
      corpus: acceptanceCorpus,
      root: warlockRoot,
      index: 9_021,
      idPrefix: 'compiled-armor-of-agathys-mandatory',
    });
    runCompiledRuntimeScenario({ foundation: protocol, spec: clone(protocol.spec) });

    const warlock = clone(warlockRoot.actor) as ActorState;
    warlock.id = 'warlock';
    warlock.controllerId = 'warlock:controller';
    const fighter = clone(fighterRoot.actor) as ActorState;
    fighter.id = 'fighter';
    fighter.controllerId = 'fighter:controller';

    const actionMap = new Map(warlockRoot.rulesActions.map((action) => [action.id, action]));
    const catalog: RulesCatalog = { getAction: (id) => actionMap.get(id) };
    const initial = createWorld({
      id: 'compiled-armor-of-agathys', ruleset: provider.ruleset,
      actors: [warlock, fighter],
    });
    const tape = createStrictRngTape([
      { label: 'Warlock ability check', sides: 20, value: 12 },
      { label: 'Fighter unarmed attack', sides: 20, value: 20 },
      { label: 'Fighter saving throw', sides: 20, value: 10 },
    ]);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(70_000),
      nextId: createSequentialIdFactory('compiled-armor'),
    });

    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:encounter', warlock.id),
      type: 'StartEncounter', initiative: [warlock.id, fighter.id],
    }));
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:warlock-turn', warlock.id), type: 'StartTurn',
    }));
    const pactSlotBefore = session.getState().actors.warlock.runtime.resources[slotResource];
    const cast = acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:cast', warlock.id),
      type: 'UseAction', actionId: armor.id,
      targetIds: [], factsByTarget: {},
      spell: { baseLevel: 1, grantId, mode: 'normal' },
      choices: { temporary_hp: 'take_spell' },
    }));
    expect(session.getState().actors.warlock.runtime).toMatchObject({
      hp: { temp: 5 },
      resources: { bonus_action: 0, [slotResource]: pactSlotBefore - 1 },
      activeEffects: [expect.objectContaining({
        roundsLeft: 600,
        mechanics: expect.objectContaining({
          kind: 'temporary_hp_melee_retaliation',
          retaliationDamage: 5,
          sourceEntityIds: [...armor.sourceEntityIds].sort(),
        }),
      })],
    });
    expect(cast).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared', actionId: armor.id,
        spell: expect.objectContaining({
          grantId, sourceId: 'CLASS-warlock',
          payment: { kind: 'slot', resource: slotResource },
        }),
      }),
    }));
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:check', warlock.id),
      type: 'AbilityCheck', ability: 'cha', dc: 10,
    }));
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:warlock-end', warlock.id), type: 'EndTurn',
    }));

    const checkpoint = migrateWorldState(clone(session.getState()));
    expect(checkpoint).toEqual(session.getState());
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:fighter-turn', fighter.id), type: 'StartTurn',
    }));
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:attack-action', fighter.id), type: 'BeginAttackAction',
    }));
    const attack = required(Object.values(session.getState().attackActions).find((candidate) => (
      candidate.actorId === fighter.id && candidate.status === 'open'
    )), 'open Fighter Attack action');
    const fighterHpBefore = session.getState().actors.fighter.runtime.hp.current;
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:unarmed-hit', fighter.id),
      type: 'PerformUnarmedStrike', attackActionId: attack.id,
      option: 'damage', targetActorId: warlock.id, facts: ENEMY_FACTS,
    }));
    expect(session.getState().actors.fighter.runtime.hp.current).toBe(fighterHpBefore - 5);
    expect(session.getState().actors.warlock.runtime.hp.temp).toBeGreaterThanOrEqual(0);
    acceptedEvents(session.dispatch({
      ...base(session, provider, 'armor:save', fighter.id),
      type: 'SavingThrow', ability: 'con', dc: 10,
    }));

    expect(foldEvents(clone(initial), clone(session.getEvents()))).toEqual(session.getState());
    expect(migrateWorldState(clone(session.getState()))).toEqual(session.getState());
    tape.assertExhausted();
  });
});
