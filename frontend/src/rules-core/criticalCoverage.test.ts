import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorState, RuleEventPayload, RulesCatalog } from './domain';
import { createWorld } from './domain';
import {
  canonicalSha256,
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
} from './determinism';
import { evolve, foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const ruleset = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'critical-coverage@1',
  contentHash: 'sha256:critical-coverage',
  errataVersion: 'phb-2024-v1',
};

function actor(id = 'actor'): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}-controller`,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: ['old-turn'],
      firedThisRest: ['old-rest'],
    },
  };
}

function world() {
  return createWorld({ id: 'critical-world', ruleset, actors: [actor()] });
}

afterEach(() => vi.unstubAllGlobals());

describe('critical deterministic boundary coverage', () => {
  it('rejects every malformed die boundary and exposes remaining draws', () => {
    expect(() => createStrictRngTape([]).rng.rollDie(1)).toThrow(/Invalid requested die sides/);
    expect(() => createStrictRngTape([]).rng.rollDie(2.5)).toThrow(/Invalid requested die sides/);
    expect(() => createStrictRngTape([{ label: 'bad sides', sides: 1, value: 1 }]).rng.rollDie(1))
      .toThrow(/Invalid requested die sides/);
    expect(() => createStrictRngTape([{ label: 'bad sides', sides: 1, value: 1 }]).rng.rollDie(6))
      .toThrow(/Invalid die sides/);
    expect(() => createStrictRngTape([{ label: 'fraction', sides: 6, value: 1.5 }]).rng.rollDie(6))
      .toThrow(/Invalid d6 result/);
    expect(() => createStrictRngTape([]).rng()).toThrow(/exhausted/);

    const tape = createStrictRngTape([{ label: 'one', sides: 4, value: 2 }]);
    expect(tape.remaining()).toBe(1);
    expect(tape.rng.rollDie(4)).toBe(2);
    expect(tape.remaining()).toBe(0);
    expect(tape.consumed()).toBe(1);
  });

  it('canonicalizes JSON edge values and rejects unsupported JavaScript values', async () => {
    expect(canonicalStringify({ omitted: undefined, zero: -0, nested: [null, false] }))
      .toBe('{"nested":[null,false],"zero":0}');
    expect(() => canonicalStringify(undefined)).toThrow(/cannot contain undefined/);
    expect(() => canonicalStringify(1n)).toThrow(/cannot contain bigint/);

    vi.stubGlobal('crypto', undefined);
    await expect(canonicalSha256({ stable: true })).rejects.toThrow(/Web Crypto SHA-256 is unavailable/);
  });

  it('uses deterministic defaults for clocks and identifiers', () => {
    expect(createLogicalClock()()).toBe(1);
    expect(createSequentialIdFactory()()).toBe('id-1');
  });
});

describe('critical reducer and adapter coverage', () => {
  it('handles ledger removal/set and rejects impossible actor/resolution transitions', () => {
    const initial = world();
    const patched = evolve(initial, {
      type: 'ActorRuntimePatched',
      actorId: 'actor',
      patch: { firedThisTurn: null, firedThisRest: ['new-rest'] },
      reason: 'action',
    });
    expect(patched.actors.actor.runtime.firedThisTurn).toBeUndefined();
    expect(patched.actors.actor.runtime.firedThisRest).toEqual(['new-rest']);

    const cleared = evolve(patched, {
      type: 'ActorRuntimePatched',
      actorId: 'actor',
      patch: { firedThisRest: null },
      reason: 'long_rest',
    });
    expect(cleared.actors.actor.runtime.firedThisRest).toBeUndefined();
    expect(() => evolve(initial, {
      type: 'ActorRuntimePatched', actorId: 'missing', patch: {}, reason: 'action',
    })).toThrow(/unknown actor/);
    expect(() => evolve(initial, { type: 'ResolutionClosed', resolutionId: 'missing' }))
      .toThrow(/inactive resolution/);
    expect(() => evolve(initial, {
      type: 'ConcentrationCleared',
      sourceActorId: 'actor',
      concentrationId: 'missing',
      reason: 'manual',
    })).toThrow(/inactive concentration/);

    const withObject = evolve(initial, {
      type: 'WorldObjectMutationRecorded',
      event: {
        type: 'WorldObjectCreated',
        object: { id: 'torch', name: 'Torch', kind: 'item', size: 'tiny' },
      },
    });
    expect(withObject.objects.torch.name).toBe('Torch');
  });

  it('replays equipment changes and rejects corrupt armor lifecycle events', () => {
    const initial = evolve(world(), {
      type: 'ActorRuntimePatched',
      actorId: 'actor',
      reason: 'action',
      patch: {
        activeEffects: [
          {
            id: 'mage-armor', name: 'Mage Armor', source: 'Mage Armor',
            mechanics: { end_triggers: ['wearer_dons_armor'] },
          },
          {
            id: 'unrelated', name: 'Unrelated', source: 'Unrelated', mechanics: {},
          },
        ],
      },
    });
    const payload = {
      type: 'EquipmentChanged' as const,
      actorId: 'actor',
      operation: 'don_armor' as const,
      cardId: 'leather',
      equipment: { body: 'leather' },
      endedEffectIds: ['mage-armor'],
    };
    const equipped = evolve(initial, payload);
    expect(equipped.actors.actor.runtime).toMatchObject({
      equipment: { body: 'leather' },
      activeEffects: [{ id: 'unrelated' }],
    });
    expect(JSON.parse(JSON.stringify(equipped))).toEqual(equipped);

    expect(() => evolve(initial, { ...payload, actorId: 'missing' }))
      .toThrow(/unknown actor/);
    expect(() => evolve(initial, {
      ...payload,
      operation: 'remove_armor',
    } as unknown as RuleEventPayload)).toThrow(/Invalid equipment event/);
    expect(() => evolve(initial, { ...payload, equipment: { body: 'chain' } }))
      .toThrow(/Invalid equipment event/);
    expect(() => evolve(initial, {
      ...payload,
      equipment: { body: 'leather', main_hand: 'sword' },
    })).toThrow(/changed unrelated slot/);
    const withMainHand = evolve(initial, {
      type: 'ActorRuntimePatched', actorId: 'actor', reason: 'action',
      patch: { equipment: { main_hand: 'sword' } },
    });
    expect(() => evolve(withMainHand, payload)).toThrow(/changed unrelated slot/);
    expect(() => evolve(initial, {
      ...payload,
      endedEffectIds: ['mage-armor', 'mage-armor'],
    })).toThrow(/duplicate ended effect IDs/);
    expect(() => evolve(initial, { ...payload, endedEffectIds: ['missing'] }))
      .toThrow(/ends unknown effect/);
    expect(() => evolve(initial, { ...payload, endedEffectIds: [] }))
      .toThrow(/invalid ended-effect set/);
  });

  it('keeps audit-only events inert and folds an empty event list identically', () => {
    const initial = world();
    const inert: RuleEventPayload[] = [
      {
        type: 'ActionDeclared', actorId: 'actor', actionId: 'a', actionKind: 'nonSpell',
        sourceEntityIds: ['a'], targetIds: [], timing: 'active',
      },
      {
        type: 'EngineEventRecorded', actorId: 'actor', targetIds: [],
        event: { type: 'narrative', text: 'audit' },
      },
      {
        type: 'DecisionRecorded', resolutionId: 'r', requestId: 'q', actorId: 'actor',
        response: { kind: 'reaction', actionId: null },
      },
    ];
    for (const payload of inert) expect(evolve(initial, payload)).toBe(initial);
    expect(foldEvents(initial, [])).toBe(initial);
  });

  it('snapshots accepted history and leaves rejected commands out of the log', () => {
    const catalog: RulesCatalog = { getAction: () => undefined };
    const session = new InMemoryRulesSession(world(), catalog, {
      rng: () => { throw new Error('must not roll'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(),
    });
    expect(session.dispatch({
      schemaVersion: 1,
      type: 'AbilityCheck',
      commandId: 'unknown-actor',
      expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash,
      actorId: 'missing',
      ability: 'wis',
    })).toMatchObject({ status: 'rejected', code: 'ActorNotFound' });
    expect(session.getEvents()).toEqual([]);
    expect(session.snapshot()).toEqual({ world: session.getState(), events: [] });
  });
});

describe('critical persisted-world migration coverage', () => {
  it('rejects malformed roots, IDs, actors and actor records', () => {
    expect(() => migrateWorldState(null)).toThrow(/world must be an object/);
    expect(() => migrateWorldState([])).toThrow(/world must be an object/);
    expect(() => migrateWorldState({ schemaVersion: 2, id: '', actors: {} })).toThrow(/world.id is required/);
    expect(() => migrateWorldState({ schemaVersion: 2, id: 'x', actors: [] })).toThrow(/world.actors must be an object/);
    expect(() => migrateWorldState({ schemaVersion: 2, id: 'x', actors: { a: null } }))
      .toThrow(/world.actors.a must be an object/);
  });

  it('filters non-string capabilities and defaults malformed capability containers', () => {
    const base = JSON.parse(JSON.stringify(world())) as Record<string, unknown>;
    const actors = base.actors as Record<string, Record<string, unknown>>;
    actors.actor.capabilities = { actionIds: ['b', 2, 'a', 'a'] };
    expect(migrateWorldState(base).actors.actor.capabilities.actionIds).toEqual(['a', 'b']);

    actors.actor.capabilities = 'not-an-object';
    expect(migrateWorldState(base).actors.actor.capabilities.actionIds).toEqual([]);
    actors.actor.capabilities = { actionIds: 'not-an-array' };
    expect(migrateWorldState(base).actors.actor.capabilities.actionIds).toEqual([]);

    actors.actor.capabilities = {
      actionIds: [],
      featureSources: {
        alert: ['source-b', '', 2, 'source-a', 'source-a'],
        malformed: 'not-an-array',
        empty: ['', 2],
      },
    };
    expect(migrateWorldState(base).actors.actor.capabilities.featureSources).toEqual({
      alert: ['source-b', 'source-a'],
    });

    actors.actor.capabilities = { actionIds: [], featureSources: [] };
    expect(migrateWorldState(base).actors.actor.capabilities).toEqual({ actionIds: [] });
  });

  it('validates every persisted world-object identity and required discriminator', () => {
    const base = JSON.parse(JSON.stringify(world())) as Record<string, unknown>;
    base.objects = [];
    expect(() => migrateWorldState(base)).toThrow(/world.objects must be an object/);

    base.objects = { torch: null };
    expect(() => migrateWorldState(base)).toThrow(/world.objects.torch must be an object/);

    for (const [object, message] of [
      [{ id: 'wrong', name: 'Torch', kind: 'item', size: 'tiny' }, /id must match/],
      [{ id: 'torch', name: '', kind: 'item', size: 'tiny' }, /name is required/],
      [{ id: 'torch', name: 'Torch', kind: 'creature', size: 'tiny' }, /kind is invalid/],
      [{ id: 'torch', name: 'Torch', kind: 'item', size: 'colossal' }, /size is invalid/],
    ] as const) {
      base.objects = { torch: object };
      expect(() => migrateWorldState(base)).toThrow(message);
    }
  });
});
