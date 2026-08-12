import { describe, expect, it } from 'vitest';
import { loadCertifiedSheetCombatCatalog } from '../character/sheetCombatCertifiedCatalog';
import { canonicalSha256, createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import type { ActorState, GameCommand, WorldState } from '../rules-core/domain';
import { createWorld } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import {
  ConnectedRulesSession,
  SERVER_RULES_AUTHORITY,
  SERVER_RULES_SCHEMA_VALIDATION,
  type ConnectedRulesTransport,
} from './ConnectedRulesSession';

function actor(id: string): ActorState {
  return {
    id, name: id, kind: 'playerCharacter', controllerId: `${id}:controller`,
    capabilities: { actionIds: [] },
    character: {
      level: 1, profBonus: 2,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {}, inventory: [], activeEffects: [],
    },
  };
}

async function transportFor(
  initial: WorldState,
  mutate?: (world: WorldState) => WorldState,
): Promise<ConnectedRulesTransport> {
  const certified = await loadCertifiedSheetCombatCatalog();
  let world = structuredClone(initial);
  const read = async (sessionId: string) => ({
    sessionId,
    rulesetReleaseId: 'release-db-id',
    rulesArtifactHash: 'sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b',
    revision: world.revision,
    snapshotSeq: world.revision,
    stateHash: await canonicalSha256(world),
    snapshotSchemaVersion: 5,
    serializerVersion: 'rules-core-canonical-json-v1',
    snapshot: structuredClone(world),
    semanticAuthority: SERVER_RULES_AUTHORITY,
    schemaValidation: SERVER_RULES_SCHEMA_VALIDATION,
  } as const);
  return {
    async create(input) {
      world = structuredClone(input.world);
      return read('created-session');
    },
    async get(sessionId) {
      return read(sessionId);
    },
    async command(sessionId, command) {
      const result = handleCommand(world, command, certified.catalog, {
        rng: () => 0.5,
        clock: createLogicalClock(world.logicalClock),
        nextId: createSequentialIdFactory('server'),
      });
      if (result.status === 'rejected') throw new Error(result.message);
      world = mutate ? mutate(result.nextState) : result.nextState;
      return {
        sessionId, commandId: command.commandId, semanticCommandId: command.commandId,
        revision: world.revision, snapshotSeq: world.revision,
        stateHash: await canonicalSha256(world), engineVersion: 'test-worker',
        semanticAuthority: SERVER_RULES_AUTHORITY,
        schemaValidation: SERVER_RULES_SCHEMA_VALIDATION,
        events: structuredClone(result.events), snapshot: structuredClone(world),
      };
    },
    async close() {},
  };
}

describe('ConnectedRulesSession', () => {
  it('creates a server-authoritative session from a verified genesis', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'connected-genesis', ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    const session = await ConnectedRulesSession.create({
      characterIds: ['wizard', 'fighter'],
      rulesArtifactHash: 'sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b',
      world,
      catalog: certified.catalog,
      previewEnv: {
        rng: () => 0.5, clock: createLogicalClock(),
        nextId: createSequentialIdFactory('preview'),
      },
      transport: await transportFor(world),
    });
    expect(session.sessionId).toBe('created-session');
    expect(session.getState()).toEqual(world);
  });

  it('uses browser core as prediction and server snapshot as authority', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'connected-world', ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    const session = await ConnectedRulesSession.open({
      sessionId: 'session-1', catalog: certified.catalog,
      previewEnv: {
        rng: () => 0.5, clock: createLogicalClock(),
        nextId: createSequentialIdFactory('preview'),
      },
      transport: await transportFor(world),
    });
    const command: GameCommand = {
      schemaVersion: 1, commandId: '5d68c388-6447-4523-bce4-27e13975affb',
      expectedRevision: 0, rulesetContentHash: world.ruleset.contentHash,
      actorId: 'fighter', type: 'StartEncounter', initiative: ['fighter', 'wizard'],
    };
    const committed = await session.dispatch(command);
    expect(committed.predictionMatched).toBe(true);
    expect(committed.reconciled).toBe(false);
    expect(session.getState().revision).toBe(1);
  });

  it('reconciles to a valid server snapshot when prediction differs', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'reconcile-world', ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    const session = await ConnectedRulesSession.open({
      sessionId: 'session-2', catalog: certified.catalog,
      previewEnv: {
        rng: () => 0.1, clock: createLogicalClock(),
        nextId: createSequentialIdFactory('preview'),
      },
      transport: await transportFor(world, (next) => ({ ...next, logicalClock: next.logicalClock + 1 })),
    });
    const committed = await session.dispatch({
      schemaVersion: 1, commandId: '5b4af2c2-a669-478b-8601-89875e35c2a9',
      expectedRevision: 0, rulesetContentHash: world.ruleset.contentHash,
      actorId: 'fighter', type: 'StartEncounter', initiative: ['fighter', 'wizard'],
    });
    expect(committed.predictionMatched).toBe(false);
    expect(committed.reconciled).toBe(true);
    expect(session.getState()).toEqual(committed.result.nextState);
  });

  it('recovers a committed command after its first HTTP response is lost', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'response-loss-world', ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    const base = await transportFor(world);
    const originalCommand = base.command.bind(base);
    let calls = 0;
    let receipt: Awaited<ReturnType<ConnectedRulesTransport['command']>> | null = null;
    base.command = async (sessionId, command) => {
      calls += 1;
      if (receipt) return structuredClone(receipt);
      receipt = await originalCommand(sessionId, command);
      throw new Error('simulated response loss');
    };
    const session = await ConnectedRulesSession.open({
      sessionId: 'response-loss-session', catalog: certified.catalog,
      previewEnv: {
        rng: () => 0.5, clock: createLogicalClock(),
        nextId: createSequentialIdFactory('preview'),
      },
      transport: base,
    });
    const committed = await session.dispatch({
      schemaVersion: 1, commandId: '638c084f-d806-4e17-b8b1-82952d3d8b88',
      expectedRevision: 0, rulesetContentHash: world.ruleset.contentHash,
      actorId: 'fighter', type: 'StartEncounter', initiative: ['fighter', 'wizard'],
    });

    expect(calls).toBe(2);
    expect(committed.result.nextState.revision).toBe(1);
    expect(session.getState().processedCommandIds).toContain('638c084f-d806-4e17-b8b1-82952d3d8b88');
  });

  it('closes the authoritative server session through its transport', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'close-world', ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    let closedSessionId = '';
    const transport = await transportFor(world);
    transport.close = async (sessionId) => { closedSessionId = sessionId; };
    const session = await ConnectedRulesSession.open({
      sessionId: 'session-to-close', catalog: certified.catalog,
      previewEnv: {
        rng: () => 0.5, clock: createLogicalClock(),
        nextId: createSequentialIdFactory('preview'),
      },
      transport,
    });

    await session.close();

    expect(closedSessionId).toBe('session-to-close');
  });
});
