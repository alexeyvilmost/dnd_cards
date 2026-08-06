import { describe, expect, it } from 'vitest';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
} from './domain';
import { canonicalStringify } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const ACTOR = 'warlock';
const ALLY = 'ally';
const SOURCE = 'effect:pact-tome';
const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'pact-tome-handler-test@1',
  contentHash: 'sha256:pact-tome-handler',
  errataVersion: '2024-test',
};

function tomeSpell(id: string, level: 0 | 1, ritual: boolean): RuleActionDefinition {
  return {
    id,
    name: id,
    kind: 'spell',
    sourceEntityIds: [`spell:${id}`, SOURCE],
    spell: {
      level,
      sourceClass: 'CLASS-warlock',
      ritual,
      classListIds: [level === 0 ? 'CLASS-cleric' : 'CLASS-wizard'],
      components: { verbal: true, somatic: true, material: false },
    },
    mechanics: {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', result: [] }],
    },
    targeting: {
      minTargets: 0,
      maxTargets: 0,
      rangeFt: 0,
      requiresLineOfSight: false,
      allowedRelations: ['self'],
    },
  } as RuleActionDefinition;
}

const FIRST = {
  bookObjectId: 'book:first',
  cantripActionIds: ['cantrip:a', 'cantrip:b', 'cantrip:c'],
  ritualActionIds: ['ritual:a', 'ritual:b'],
};
const SECOND = {
  bookObjectId: 'book:second',
  cantripActionIds: ['cantrip:d', 'cantrip:e', 'cantrip:f'],
  ritualActionIds: ['ritual:c', 'ritual:d'],
};
const ACTIONS = [
  ...[...FIRST.cantripActionIds, ...SECOND.cantripActionIds]
    .map((id) => tomeSpell(id, 0, false)),
  ...[...FIRST.ritualActionIds, ...SECOND.ritualActionIds]
    .map((id) => tomeSpell(id, 1, true)),
];
const CATALOG: RulesCatalog = {
  getAction: (actionId) => ACTIONS.find((action) => action.id === actionId),
};

function actor(id: string, pact = false): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: {
      actionIds: pact ? ['hex'] : [],
      ...(pact ? {
        featureSources: {
          'warlock.pact.tome': [SOURCE, 'EFF-pact-tome', 'CLASS-warlock'],
        },
      } : {}),
    },
    character: {
      abilityMods: { str: 0, dex: 1, con: 2, int: 0, wis: 1, cha: 3 },
      profBonus: 2,
      level: 1,
      skillProficiencies: [],
      saveProficiencies: pact ? ['wis', 'cha'] : [],
      classLevels: pact ? { warlock: 1 } : {},
    },
    runtime: {
      hp: { current: 8, max: 10, temp: 0 },
      resources: { spell_slot_1: pact ? 1 : 0 },
      maxResources: { spell_slot_1: pact ? 1 : 0 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    ...(pact ? {
      spellcastingAccess: {
        grants: [{
          grantId: 'grant:warlock:hex',
          actionId: 'hex',
          sourceId: 'CLASS-warlock',
          access: 'known' as const,
          level: 1,
          spellcastingAbility: 'cha' as const,
          slotResource: 'spell_slot_1',
        }],
        preparedSources: {},
      },
    } : {}),
  };
}

function base(
  session: InMemoryRulesSession,
  commandId: string,
): Pick<GameCommand, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'> {
  return {
    schemaVersion: 1,
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: ACTOR,
  };
}

describe('Pact Tome canonical command integration', () => {
  it('atomically replaces books at both rests and audits slot/ritual casts through replay and migration', () => {
    const initial = createWorld({
      id: 'world:pact-tome-handler',
      ruleset: RULESET,
      actors: [actor(ACTOR, true), actor(ALLY)],
    });
    let clock = 0;
    const session = new InMemoryRulesSession(initial, CATALOG, {
      rng: () => 0.5,
      clock: () => ++clock,
      nextId: () => 'unused',
    });

    const short = session.dispatch({
      ...base(session, 'rest:short'),
      type: 'TakeShortRest',
      decisions: [],
      pactTome: FIRST,
    });
    expect(short.status).toBe('accepted');
    if (short.status !== 'accepted') throw new Error(short.message);
    expect(short.events.find((event) => event.payload.type === 'PactTomeRestCompleted'))
      .toMatchObject({
        obligationIds: ['system:pact-tome-rest', 'system:short-rest', `entity:${SOURCE}`],
        payload: { rest: 'short', activeTome: { bookObject: { id: 'book:first' } } },
      });
    expect(session.getState().actors[ACTOR].runtime.hp.current).toBe(8);

    const normalGrant = session.getState().actors[ACTOR].spellcastingAccess!.grants
      .find((grant) => grant.actionId === 'ritual:a')!;
    const normal = session.dispatch({
      ...base(session, 'cast:normal'),
      type: 'UseAction',
      actionId: 'ritual:a',
      targetIds: [],
      spell: { baseLevel: 1, grantId: normalGrant.grantId, mode: 'normal' },
    });
    expect(normal.status).toBe('accepted');
    if (normal.status !== 'accepted') throw new Error(normal.message);
    expect(normal.events.find((event) => event.payload.type === 'ActionDeclared')?.payload)
      .toMatchObject({
        type: 'ActionDeclared',
        spell: {
          grantId: normalGrant.grantId,
          sourceId: 'book:first',
          mode: 'normal',
          payment: { kind: 'slot', resource: 'spell_slot_1' },
          focusObjectId: 'book:first',
          castingTimeAddedSeconds: 0,
        },
      });
    expect(session.getState().actors[ACTOR].runtime.resources.spell_slot_1).toBe(0);

    const long = session.dispatch({
      ...base(session, 'rest:long'),
      type: 'TakeLongRest',
      durationHours: 8,
      pactTome: SECOND,
    });
    expect(long.status).toBe('accepted');
    if (long.status !== 'accepted') throw new Error(long.message);
    expect(session.getState().objects['book:first']).toBeUndefined();
    expect(session.getState().objects['book:second']).toBeDefined();
    expect(session.getState().actors[ACTOR].runtime.resources.spell_slot_1).toBe(1);
    expect(session.getState().actors[ACTOR].capabilities.actionIds).not.toContain('ritual:a');

    const ritualGrant = session.getState().actors[ACTOR].spellcastingAccess!.grants
      .find((grant) => grant.actionId === 'ritual:c')!;
    const ritual = session.dispatch({
      ...base(session, 'cast:ritual'),
      type: 'UseAction',
      actionId: 'ritual:c',
      targetIds: [],
      spell: { baseLevel: 1, grantId: ritualGrant.grantId, mode: 'ritual' },
    });
    expect(ritual.status).toBe('accepted');
    if (ritual.status !== 'accepted') throw new Error(ritual.message);
    expect(ritual.events.find((event) => event.payload.type === 'ActionDeclared')?.payload)
      .toMatchObject({
        spell: {
          grantId: ritualGrant.grantId,
          sourceId: 'book:second',
          mode: 'ritual',
          payment: { kind: 'none' },
          focusObjectId: 'book:second',
          castingTimeAddedSeconds: 600,
        },
      });
    expect(session.getState().actors[ACTOR].runtime.resources.spell_slot_1).toBe(1);

    const encounter = session.dispatch({
      ...base(session, 'encounter'),
      type: 'StartEncounter',
      initiative: [ACTOR, ALLY],
    });
    expect(encounter.status).toBe('accepted');
    const turn = session.dispatch({
      ...base(session, 'turn:start'),
      type: 'StartTurn',
    });
    expect(turn.status).toBe('accepted');
    const beforeRejectedRitual = canonicalStringify(session.getState());
    const rejectedRitual = session.dispatch({
      ...base(session, 'cast:ritual-in-encounter'),
      type: 'UseAction',
      actionId: 'ritual:c',
      targetIds: [],
      spell: { baseLevel: 1, grantId: ritualGrant.grantId, mode: 'ritual' },
    });
    expect(rejectedRitual).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(canonicalStringify(session.getState())).toBe(beforeRejectedRitual);

    const replayed = foldEvents(initial, session.getEvents());
    expect(canonicalStringify(replayed)).toBe(canonicalStringify(session.getState()));
    const migrated = migrateWorldState(JSON.parse(canonicalStringify(replayed)));
    expect(migrateWorldState(JSON.parse(canonicalStringify(migrated)))).toEqual(migrated);
    expect(migrated.actors[ACTOR].warlockPacts?.tome)
      .toEqual(replayed.actors[ACTOR].warlockPacts?.tome);
    expect(migrated.objects['book:second']).toEqual(replayed.objects['book:second']);
  });

  it('rejects an invalid explicit selection before applying any rest effect', () => {
    const initial = createWorld({
      id: 'world:pact-tome-rejection',
      ruleset: RULESET,
      actors: [actor(ACTOR, true), actor(ALLY)],
    });
    const session = new InMemoryRulesSession(initial, CATALOG, {
      rng: () => 0.5,
      clock: () => 1,
      nextId: () => 'unused',
    });
    const before = canonicalStringify(session.getState());
    const result = session.dispatch({
      ...base(session, 'rest:invalid'),
      type: 'TakeShortRest',
      decisions: [],
      pactTome: { ...FIRST, cantripActionIds: ['unknown', 'cantrip:b', 'cantrip:c'] },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    expect(canonicalStringify(session.getState())).toBe(before);
    expect(session.getEvents()).toEqual([]);
  });
});
