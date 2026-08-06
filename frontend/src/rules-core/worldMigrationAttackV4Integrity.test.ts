import { describe, expect, it } from 'vitest';
import {
  beginAttackSequence,
  performUnarmedStrike,
} from './attackSequence';
import { createWorld } from './domain';
import type { ActorState, AttackActionState, GrappleState, WorldState } from './domain';
import { evolve } from './reducer';
import { SYSTEM_ACTION_IDS } from './systemActions';
import { migrateWorldState } from './worldMigration';

type Mutable = Record<string, unknown>;

const ruleset = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'migration-integrity',
  contentHash: 'migration-integrity',
  errataVersion: 'migration-integrity',
};

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    lifecycle: { status: 'alive' },
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: { action: 1 },
      maxResources: { action: 1 },
      equipment: { main_hand: null, off_hand: null },
      inventory: [],
      activeEffects: [],
    },
    attackProfile: {
      attacksPerAction: 2,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['fixture:attack-profile'],
    },
  };
}

function world(): WorldState {
  return createWorld({ id: 'migration-integrity', ruleset, actors: [actor('a'), actor('b')] });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function raw(value: unknown): Mutable {
  return value as Mutable;
}

function rawActor(value: WorldState, id = 'a'): Mutable {
  return raw(raw(value.actors)[id]);
}

function rawProfile(value: WorldState, id = 'a'): Mutable {
  return raw(rawActor(value, id).attackProfile);
}

function openAttack(id = 'attack'): AttackActionState {
  return {
    id,
    actorId: 'a',
    startedAtRevision: 0,
    turnKey: 'turn',
    status: 'open',
    sequence: beginAttackSequence({ id, actorId: 'a', totalAttacks: 2 }),
  };
}

function completedAttack(id = 'attack'): AttackActionState {
  let sequence = beginAttackSequence({ id, actorId: 'a', totalAttacks: 2 });
  sequence = performUnarmedStrike({
    sequence,
    actionId: SYSTEM_ACTION_IDS.unarmedDamage,
    option: 'damage',
    sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:damage'],
  });
  sequence = performUnarmedStrike({
    sequence,
    actionId: SYSTEM_ACTION_IDS.unarmedShove,
    option: 'shove',
    sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:shove'],
  });
  return {
    id,
    actorId: 'a',
    startedAtRevision: 0,
    turnKey: 'turn',
    status: 'completed',
    sequence,
  };
}

function grapple(id = 'g'): GrappleState {
  return {
    id,
    grapplerActorId: 'a',
    targetActorId: 'b',
    sourcePart: 'main_hand',
    escapeDc: 13,
    reachFt: 5,
    sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'],
    startedAtRevision: 0,
  };
}

function grappleWorld(): WorldState {
  return evolve(world(), { type: 'GrappleApplied', grapple: grapple() });
}

describe('schema-v4 Attack/grapple checkpoint integrity', () => {
  it('rejects every malformed actor Attack profile primitive', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['attacksPerAction', 0, /positive integer/],
      ['attacksPerAction', 1.5, /positive integer/],
      ['size', 1.5, /integer from 0 to 5/],
      ['size', -1, /integer from 0 to 5/],
      ['size', 6, /integer from 0 to 5/],
      ['reachFt', 0, /positive number/],
      ['reachFt', Number.NaN, /positive number/],
      ['sourceEntityIds', [], /cannot be empty/],
    ];
    for (const [field, value, pattern] of cases) {
      const invalid = world();
      rawProfile(invalid)[field] = value;
      expect(() => migrateWorldState(invalid), field).toThrow(pattern);
    }
    const missingLedgers = world();
    delete raw(missingLedgers).attackActions;
    expect(() => migrateWorldState(missingLedgers)).toThrow(/attackActions is required/);
    const missingGrapples = world();
    delete raw(missingGrapples).grapples;
    expect(() => migrateWorldState(missingGrapples)).toThrow(/grapples is required/);
    const badRuntime = world();
    rawActor(badRuntime).runtime = { ...badRuntime.actors.a.runtime, activeEffects: null };
    expect(() => migrateWorldState(badRuntime)).toThrow(/activeEffects must be an array/);

    const ordinaryEffect = world();
    ordinaryEffect.actors.b.runtime.activeEffects.push({
      id: 'condition:prone',
      name: 'Prone',
      mechanics: { kind: 'condition', value: 'prone' },
      source: 'fixture:condition',
      ownerId: 'b',
      sourceId: 'a',
    });
    expect(migrateWorldState(ordinaryEffect).actors.b.runtime.activeEffects).toHaveLength(1);
  });

  it('normalizes valid open/completed/forfeited ledgers and rejects every identity/state mismatch', () => {
    const valid = world();
    valid.attackActions.attack = openAttack();
    expect(migrateWorldState(valid).attackActions.attack).toEqual(openAttack());
    const completed = world();
    completed.attackActions.attack = completedAttack();
    expect(migrateWorldState(completed).attackActions.attack.status).toBe('completed');
    const forfeited = world();
    forfeited.attackActions.attack = { ...openAttack(), status: 'forfeited' };
    expect(migrateWorldState(forfeited).attackActions.attack.status).toBe('forfeited');

    const mutateCases: Array<[string, (entry: Mutable, value: WorldState) => void, RegExp]> = [
      ['key/id mismatch', (entry) => { entry.id = 'other'; }, /id must match its key/],
      ['unknown actor', (entry) => {
        entry.actorId = 'missing';
        raw(entry.sequence).actorId = 'missing';
      }, /must reference a world actor/],
      ['status type', (entry) => { entry.status = 7; }, /status is invalid/],
      ['status value', (entry) => { entry.status = 'paused'; }, /status is invalid/],
      ['sequence invariant', (entry) => { raw(entry.sequence).attacksRemaining = -1; }, /canonical actor Attack budget/],
      ['sequence id', (entry) => { raw(entry.sequence).id = 'other'; }, /canonical actor Attack budget/],
      ['sequence actor', (entry) => { raw(entry.sequence).actorId = 'b'; }, /canonical actor Attack budget/],
      ['sequence total', (entry) => {
        raw(entry.sequence).totalAttacks = 1;
        raw(entry.sequence).attacksRemaining = 1;
      }, /canonical actor Attack budget/],
      ['completed remaining', (entry) => { entry.status = 'completed'; }, /completed Attack action/],
      ['closed blocked', (entry) => {
        entry.status = 'forfeited';
        entry.blockedByResolutionId = 'r';
      }, /only an open Attack action can be blocked/],
      ['bad revision', (entry) => { entry.startedAtRevision = -1; }, /non-negative integer/],
      ['blank turn', (entry) => { entry.turnKey = ''; }, /non-empty string/],
    ];
    for (const [label, mutate, pattern] of mutateCases) {
      const invalid = world();
      invalid.attackActions.attack = openAttack();
      mutate(raw(invalid.attackActions.attack), invalid);
      expect(() => migrateWorldState(invalid), label).toThrow(pattern);
    }

    const duplicate = world();
    duplicate.attackActions.first = openAttack('first');
    duplicate.attackActions.second = openAttack('second');
    expect(() => migrateWorldState(duplicate)).toThrow(/multiple open Attack actions/);
  });

  it('normalizes declared Attack provenance and rejects malformed or incomplete declarations', () => {
    const declared = world();
    declared.attackActions.attack = openAttack();
    Object.assign(raw(declared.attackActions.attack), {
      declaredActionId: 'action:longsword',
      declaredActionSourceEntityIds: ['item:longsword', 'mastery:graze'],
    });
    expect(migrateWorldState(declared).attackActions.attack).toMatchObject({
      declaredActionId: 'action:longsword',
      declaredActionSourceEntityIds: ['item:longsword', 'mastery:graze'],
    });

    const malformedCases: Array<[string, unknown, RegExp]> = [
      ['not an array', 'item:longsword', /declaredActionSourceEntityIds must be non-empty/],
      ['empty', [], /declaredActionSourceEntityIds must be non-empty/],
      ['blank entity id', [''], /declaredActionSourceEntityIds\[0\] must be a non-empty string/],
      ['duplicate entity id', ['item:longsword', 'item:longsword'], /declaredActionSourceEntityIds must be unique/],
    ];
    for (const [label, sourceEntityIds, pattern] of malformedCases) {
      const invalid = world();
      invalid.attackActions.attack = openAttack();
      Object.assign(raw(invalid.attackActions.attack), {
        declaredActionId: 'action:longsword',
        declaredActionSourceEntityIds: sourceEntityIds,
      });
      expect(() => migrateWorldState(invalid), label).toThrow(pattern);
    }

    const missingProvenance = world();
    missingProvenance.attackActions.attack = openAttack();
    raw(missingProvenance.attackActions.attack).declaredActionId = 'action:longsword';
    expect(() => migrateWorldState(missingProvenance)).toThrow(
      /must declare action identity and provenance together/,
    );

    const missingIdentity = world();
    missingIdentity.attackActions.attack = openAttack();
    raw(missingIdentity.attackActions.attack).declaredActionSourceEntityIds = ['item:longsword'];
    expect(() => migrateWorldState(missingIdentity)).toThrow(
      /must declare action identity and provenance together/,
    );
  });

  it('requires a blocked ledger and pending resolution to reference one another exactly', () => {
    const blocked = (): WorldState => {
      const value = world();
      value.attackActions.attack = { ...openAttack(), blockedByResolutionId: 'r' };
      return value;
    };
    expect(() => migrateWorldState(blocked())).toThrow(/must match the active resolution/);

    const wrongResolution = blocked();
    raw(wrongResolution).pendingResolution = { id: 'other', attackActionId: 'attack' };
    expect(() => migrateWorldState(wrongResolution)).toThrow(/must match the active resolution/);

    const wrongAttack = blocked();
    raw(wrongAttack).pendingResolution = { id: 'r', attackActionId: 'other' };
    expect(() => migrateWorldState(wrongAttack)).toThrow(/must match the active resolution/);

    const danglingPending = world();
    raw(danglingPending).pendingResolution = { id: 'r', attackActionId: 'missing' };
    expect(() => migrateWorldState(danglingPending)).toThrow(/must reference its blocked Attack action/);

    const valid = blocked();
    raw(valid).pendingResolution = { id: 'r', attackActionId: 'attack' };
    expect(migrateWorldState(valid).attackActions.attack.blockedByResolutionId).toBe('r');
  });

  it('normalizes an exact grapple and rejects relation, part, provenance, projection, DC, and reach forgeries', () => {
    expect(migrateWorldState(grappleWorld()).grapples.g).toEqual(grapple());
    const cases: Array<[string, (value: WorldState) => void, RegExp]> = [
      ['id', (value) => { value.grapples.g.id = 'other'; }, /id must match its key/],
      ['grappler', (value) => { value.grapples.g.grapplerActorId = 'missing'; }, /two different world actors/],
      ['target', (value) => { value.grapples.g.targetActorId = 'missing'; }, /two different world actors/],
      ['self', (value) => { value.grapples.g.targetActorId = 'a'; }, /two different world actors/],
      ['part', (value) => { value.grapples.g.sourcePart = 'tail'; }, /not owned/],
      ['empty source', (value) => { value.grapples.g.sourceEntityIds = [] as never; }, /cannot be empty/],
      ['source', (value) => { value.grapples.g.sourceEntityIds = ['forged']; }, /retain ruleset/],
      ['dc zero', (value) => { value.grapples.g.escapeDc = 0; }, /positive integer/],
      ['dc fraction', (value) => { value.grapples.g.escapeDc = 1.5; }, /positive integer/],
      ['reach zero', (value) => { value.grapples.g.reachFt = 0; }, /positive number/],
      ['reach nan', (value) => { value.grapples.g.reachFt = Number.NaN; }, /positive number/],
      ['revision', (value) => { value.grapples.g.startedAtRevision = -1; }, /non-negative integer/],
    ];
    for (const [label, mutate, pattern] of cases) {
      const invalid = grappleWorld();
      mutate(invalid);
      expect(() => migrateWorldState(invalid), label).toThrow(pattern);
    }

    const projectionCases: Array<[string, (effect: Mutable) => void]> = [
      ['id', (effect) => { effect.id = 'other'; }],
      ['owner', (effect) => { effect.ownerId = 'a'; }],
      ['source actor', (effect) => { effect.sourceId = 'b'; }],
      ['kind', (effect) => { raw(effect.mechanics).kind = 'modifier'; }],
      ['value', (effect) => { raw(effect.mechanics).value = 'prone'; }],
      ['relation id', (effect) => { raw(effect.mechanics).grappleId = 'other'; }],
    ];
    for (const [label, mutate] of projectionCases) {
      const invalid = grappleWorld();
      mutate(raw(invalid.actors.b.runtime.activeEffects[0]));
      expect(() => migrateWorldState(invalid), label).toThrow(/missing its exact target grapple projection/);
    }

    const occupied = grappleWorld();
    occupied.actors.c = actor('c');
    occupied.grapples.g2 = { ...grapple('g2'), targetActorId: 'c' };
    occupied.actors.c.runtime.activeEffects.push({
      id: 'grapple:g2',
      name: 'Grappled',
      mechanics: { kind: 'condition', value: 'grappled', grappleId: 'g2' },
      source: occupied.grapples.g2.sourceEntityIds[0],
      ownerId: 'c',
      sourceId: 'a',
    });
    expect(() => migrateWorldState(occupied)).toThrow(/already maintains a grapple/);
  });

  it('rejects orphan and wrong-owner grapple projections', () => {
    const orphan = world();
    orphan.actors.b.runtime.activeEffects.push({
      id: 'grapple:orphan',
      name: 'Grappled',
      mechanics: { kind: 'condition', value: 'grappled', grappleId: 'orphan' },
      source: 'system:dnd5e-2024:unarmed-strike:grapple',
      ownerId: 'b',
      sourceId: 'a',
    });
    expect(() => migrateWorldState(orphan)).toThrow(/orphan grapple projection/);

    const wrongOwner = grappleWorld();
    wrongOwner.actors.a.runtime.activeEffects.push(clone(
      wrongOwner.actors.b.runtime.activeEffects[0],
    ));
    expect(() => migrateWorldState(wrongOwner)).toThrow(/orphan grapple projection/);
  });
});
