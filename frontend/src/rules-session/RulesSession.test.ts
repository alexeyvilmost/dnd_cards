import { describe, expect, it } from 'vitest';
import { createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import type { ActorState, RulesCatalog } from '../rules-core/domain';
import { createWorld } from '../rules-core/domain';
import { PersistentRulesSession } from './RulesSession';
import {
  InMemoryRulesWorldStore,
  SessionStoreConflictError,
  type RulesWorldStore,
  type StoredRuleEvent,
} from './store';

const ruleset = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'local-test',
  contentHash: 'sha256:local-test',
  errataVersion: 'test',
};
const runtime = () => ({
  hp: { current: 10, max: 10, temp: 0 },
  resources: { action: 1, bonus_action: 1, reaction: 1 },
  maxResources: { action: 1, bonus_action: 1, reaction: 1 },
  equipment: {}, inventory: [], activeEffects: [],
});
const actor = (id: string): ActorState => ({
  id, name: id, kind: 'playerCharacter', controllerId: `${id}-owner`, ac: 10,
  capabilities: { actionIds: [] },
  character: {
    abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    profBonus: 2, level: 1,
  },
  runtime: runtime(),
});
const catalog: RulesCatalog = { getAction: () => undefined };
const env = () => ({ rng: () => 0.5, clock: createLogicalClock(), nextId: createSequentialIdFactory() });

describe('PersistentRulesSession', () => {
  it('atomically persists events and restores the authoritative local world', async () => {
    const initialWorld = createWorld({ id: 'persisted-world', ruleset, actors: [actor('a'), actor('b')] });
    const store = new InMemoryRulesWorldStore();
    const first = await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store });
    const notified: number[] = [];
    first.subscribe((world) => notified.push(world.revision));
    const result = await first.dispatch({
      schemaVersion: 1,
      type: 'StartEncounter',
      commandId: 'start',
      expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash,
      actorId: 'a',
      initiative: ['a', 'b'],
    });
    expect(result.status).toBe('accepted');
    expect(notified).toEqual([1]);

    const reopened = await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store });
    expect(reopened.getState()).toEqual(first.getState());
    expect(await reopened.persistedEvents()).toEqual(first.getState().revision === 1
      ? result.status === 'accepted' ? result.events : []
      : []);
  });

  it('does not publish or mutate local memory when another writer wins the revision', async () => {
    const initialWorld = createWorld({ id: 'conflict-world', ruleset, actors: [actor('a'), actor('b')] });
    const store = new InMemoryRulesWorldStore();
    const first = await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store });
    const stale = await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store });
    await first.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'winner', expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash, actorId: 'a', initiative: ['a', 'b'],
    });
    let notifications = 0;
    stale.subscribe(() => { notifications += 1; });
    await expect(stale.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'loser', expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash, actorId: 'a', initiative: ['a', 'b'],
    })).rejects.toBeInstanceOf(SessionStoreConflictError);
    expect(stale.getState().revision).toBe(0);
    expect(notifications).toBe(0);
  });

  it('fails closed when the persisted snapshot differs from replayed events', async () => {
    const initialWorld = createWorld({ id: 'corrupt-snapshot', ruleset, actors: [actor('a'), actor('b')] });
    const backing = new InMemoryRulesWorldStore();
    const first = await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store: backing });
    await first.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'start', expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash, actorId: 'a', initiative: ['a', 'b'],
    });
    const store: RulesWorldStore = {
      loadWorld: (worldId) => backing.loadWorld(worldId),
      loadGenesis: (worldId) => backing.loadGenesis(worldId),
      initialize: async (world) => {
        const snapshot = await backing.initialize(world);
        snapshot.actors.a.runtime.hp.current = 1;
        return snapshot;
      },
      commit: (input) => backing.commit(input),
      loadEvents: (worldId) => backing.loadEvents(worldId),
    };
    await expect(PersistentRulesSession.open({ initialWorld, catalog, env: env(), store }))
      .rejects.toMatchObject({
        name: 'RulesSessionIntegrityError', code: 'snapshot_replay_mismatch',
      });
  });

  it.each([
    ['missing revision', (rows: StoredRuleEvent[]) => rows.filter((row) => row.revision !== 1)],
    ['forged ordinal', (rows: StoredRuleEvent[]) => rows.map((row, index) => (
      index === 0 ? { ...row, ordinal: 9 } : row
    ))],
    ['missing commit', (rows: StoredRuleEvent[]) => rows.slice(0, -1)],
  ])('rejects an invalid event stream: %s', async (_label, mutate) => {
    const initialWorld = createWorld({ id: `corrupt-events-${_label}`, ruleset, actors: [actor('a'), actor('b')] });
    const backing = new InMemoryRulesWorldStore();
    const first = await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store: backing });
    await first.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'start', expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash, actorId: 'a', initiative: ['a', 'b'],
    });
    await first.dispatch({
      schemaVersion: 1, type: 'StartTurn', commandId: 'turn', expectedRevision: 1,
      rulesetContentHash: ruleset.contentHash, actorId: 'a',
    });
    const store: RulesWorldStore = {
      loadWorld: (worldId) => backing.loadWorld(worldId),
      loadGenesis: (worldId) => backing.loadGenesis(worldId),
      initialize: (world) => backing.initialize(world),
      commit: (input) => backing.commit(input),
      loadEvents: async (worldId) => mutate(await backing.loadEvents(worldId)),
    };
    await expect(PersistentRulesSession.open({ initialWorld, catalog, env: env(), store }))
      .rejects.toMatchObject({
        name: 'RulesSessionIntegrityError', code: 'invalid_event_stream',
      });
  });

  it('rejects reopening a world with a different deterministic genesis', async () => {
    const initialWorld = createWorld({ id: 'genesis-mismatch', ruleset, actors: [actor('a'), actor('b')] });
    const store = new InMemoryRulesWorldStore();
    await PersistentRulesSession.open({ initialWorld, catalog, env: env(), store });
    const changed = structuredClone(initialWorld);
    changed.actors.a.runtime.hp.max = 11;
    changed.actors.a.runtime.hp.current = 11;
    await expect(PersistentRulesSession.open({ initialWorld: changed, catalog, env: env(), store }))
      .rejects.toMatchObject({
        name: 'RulesSessionIntegrityError', code: 'initial_world_mismatch',
      });
  });
});
