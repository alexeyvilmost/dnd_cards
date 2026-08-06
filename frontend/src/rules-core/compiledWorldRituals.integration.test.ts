import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type UncommittedRuleEvent,
  type WorldState,
} from './domain';
import { createLogicalClock, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const DETECT_POISON_CARD = 'SPELL-0236';
const PURIFY_CARD = 'SPELL-0252';
const CLERIC_SOURCE = 'CLASS-cleric';

type CompiledSpell = Extract<RuleActionDefinition, { kind: 'spell' }>;

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing compiled ritual fixture: ${description}`);
  return value;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function declarations(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
  ));
}

function observations(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'WorldObjectMutationRecorded'
      && entry.payload.event.type === 'WorldObjectObserved'
      ? [entry.payload.event]
      : []
  ));
}

describe('compiled PHB 2024 world ritual execution', () => {
  let provider: CompiledMicroMvpL1Provider;
  let root: CompiledMicroMvpL1Root;
  let detectPoison: CompiledSpell;
  let purify: CompiledSpell;
  let detectGrantId: string;
  let purifyGrantId: string;
  let catalog: RulesCatalog;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled ritual tests');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
      const base = required(provider.roots.find((candidate) => (
        candidate.matrixCase.klass.card_number === CLERIC_SOURCE
      )), 'Cleric root');
      root = await compileMicroMvpL1ChoiceVariant({
        stableKey: base.stableKey,
        overrides: {
          cleric_spells_l1: ['SPELL-0214', 'SPELL-0163', DETECT_POISON_CARD, PURIFY_CARD],
        },
      });

      const spellByCard = (cardNumber: string): CompiledSpell => {
        const entity = required(
          root.assembled.spells.find((candidate) => candidate.card_number === cardNumber),
          `${cardNumber} entity`,
        );
        const action = required(root.rulesActions.find((candidate) => (
          candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id)
        )), `${cardNumber} action`);
        if (action.kind !== 'spell') throw new Error(`${cardNumber} compiled as a non-spell action`);
        return action;
      };
      detectPoison = spellByCard(DETECT_POISON_CARD);
      purify = spellByCard(PURIFY_CARD);

      const grantFor = (action: CompiledSpell) => required(
        root.actor.spellcastingAccess?.grants.find((grant) => (
          grant.actionId === action.id
            && grant.sourceId === CLERIC_SOURCE
            && grant.ritual === true
        )),
        `${action.id} Cleric ritual grant`,
      ).grantId;
      detectGrantId = grantFor(detectPoison);
      purifyGrantId = grantFor(purify);
      const actions = new Map(root.rulesActions.map((action) => [action.id, action]));
      catalog = { getAction: (id) => actions.get(id) };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  function makeSession(id: string) {
    const cleric = copy(root.actor) as ActorState;
    cleric.id = 'cleric';
    cleric.controllerId = 'cleric:controller';
    const witness = copy(root.actor) as ActorState;
    witness.id = 'witness';
    witness.controllerId = 'witness:controller';
    const initial = createWorld({
      id,
      ruleset: provider.ruleset,
      actors: [cleric, witness],
      objects: [
        {
          id: 'venom',
          name: 'Wyvern venom',
          kind: 'item',
          size: 'tiny',
          hazardousSubstance: { kind: 'poison', specificKind: 'wyvern venom' },
        },
        {
          id: 'stew',
          name: 'Spoiled stew',
          kind: 'item',
          size: 'small',
          foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
        },
        {
          id: 'magic-wine',
          name: 'Magic wine',
          kind: 'item',
          size: 'tiny',
          foodOrDrink: { kind: 'drink', magical: true, poisoned: true, rotten: true },
        },
      ],
    });
    const tape = createStrictRngTape([]);
    return {
      initial: copy(initial),
      tape,
      session: new InMemoryRulesSession(initial, catalog, {
        rng: tape.rng,
        clock: createLogicalClock(),
        nextId: () => {
          throw new Error('Persisted IDs must be command-derived');
        },
      }),
    };
  }

  function dispatch(
    session: InMemoryRulesSession,
    command: Record<string, unknown>,
  ) {
    const result = session.dispatch({
      schemaVersion: 1,
      expectedRevision: session.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'cleric',
      ...command,
    } as Parameters<InMemoryRulesSession['dispatch']>[0]);
    if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
    return result;
  }

  function assertReplay(initial: WorldState, session: InMemoryRulesSession) {
    const persisted = copy(session.getState());
    expect(migrateWorldState(persisted)).toEqual(persisted);
    expect(foldEvents(copy(initial), copy(session.getEvents()))).toEqual(session.getState());
  }

  it('casts compiled Detect Poison and Disease as a ritual, spends no slot, and senses through its exact concentration', () => {
    const run = makeSession('compiled-detect-poison-ritual');
    const slotsBefore = run.session.getState().actors.cleric.runtime.resources.spell_slot_1;
    const cast = dispatch(run.session, {
      type: 'UseAction',
      commandId: 'detect-ritual',
      actionId: detectPoison.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: detectGrantId, mode: 'ritual' },
    });

    expect(run.session.getState().actors.cleric.runtime.resources).toMatchObject({
      action: 0,
      spell_slot_1: slotsBefore,
    });
    expect(declarations(cast.events)).toContainEqual(expect.objectContaining({
      actionId: detectPoison.id,
      spell: expect.objectContaining({
        grantId: detectGrantId,
        sourceId: CLERIC_SOURCE,
        spellcastingAbility: 'wis',
        mode: 'ritual',
        payment: { kind: 'none' },
      }),
    }));
    const concentration = required(
      run.session.getState().concentrations.cleric,
      'Detect Poison and Disease concentration',
    );
    expect(concentration.actionId).toBe(detectPoison.id);

    const observed = dispatch(run.session, {
      type: 'ObservePoisonDisease',
      commandId: 'observe-poison',
      concentrationId: concentration.id,
      observations: {
        venom: {
          facts: {
            factsSource: 'board',
            boardRevision: 17,
            distanceFt: 30,
            lineOfSight: false,
          },
          blockingLayers: [],
        },
      },
    });
    expect(observations(observed.events)).toContainEqual(expect.objectContaining({
      objectId: 'venom',
      observation: 'detect_poison_and_disease',
      details: expect.objectContaining({
        sensed: true,
        locationKnown: true,
        kind: 'wyvern venom',
        concentrationId: concentration.id,
      }),
    }));
    assertReplay(run.initial, run.session);
    run.tape.assertExhausted();
  });

  it('casts compiled Purify Food and Drink as a ritual without a slot and mutates only explicit nonmagical food', () => {
    const run = makeSession('compiled-purify-ritual');
    const slotsBefore = run.session.getState().actors.cleric.runtime.resources.spell_slot_1;
    const cast = dispatch(run.session, {
      type: 'UseAction',
      commandId: 'purify-ritual',
      actionId: purify.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: purifyGrantId, mode: 'ritual' },
      worldInput: {
        type: 'purify_food_drink',
        sphereCenterDistanceFt: 10,
        factsByObject: {
          stew: {
            factsSource: 'board',
            boardRevision: 18,
            distanceFt: 10,
            lineOfSight: true,
            inArea: true,
          },
          'magic-wine': {
            factsSource: 'board',
            boardRevision: 18,
            distanceFt: 10,
            lineOfSight: true,
            inArea: true,
          },
        },
      },
    });

    expect(run.session.getState().actors.cleric.runtime.resources).toMatchObject({
      action: 0,
      spell_slot_1: slotsBefore,
    });
    expect(declarations(cast.events)).toContainEqual(expect.objectContaining({
      actionId: purify.id,
      spell: expect.objectContaining({
        grantId: purifyGrantId,
        sourceId: CLERIC_SOURCE,
        spellcastingAbility: 'wis',
        mode: 'ritual',
        payment: { kind: 'none' },
      }),
    }));
    expect(run.session.getState().objects.stew.foodOrDrink).toMatchObject({
      magical: false,
      poisoned: false,
      rotten: false,
    });
    expect(run.session.getState().objects['magic-wine'].foodOrDrink).toMatchObject({
      magical: true,
      poisoned: true,
      rotten: true,
    });
    assertReplay(run.initial, run.session);
    run.tape.assertExhausted();
  });
});
