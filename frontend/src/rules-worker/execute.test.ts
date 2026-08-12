import { describe, expect, it } from 'vitest';
import { loadCertifiedSheetCombatCatalog } from '../character/sheetCombatCertifiedCatalog';
import { canonicalSha256, createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import type { ActorState, GameCommand } from '../rules-core/domain';
import { createWorld } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { executeRulesWorkerRequest, validateRulesWorkerWorld } from './execute';

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    capabilities: { actionIds: [] },
    character: {
      level: 1,
      profBonus: 2,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
  };
}

describe('server rules worker', () => {
  it('certifies a normalized two-PC genesis before any server mutation', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'worker-genesis', ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    const stateHash = await canonicalSha256(world);
    await expect(validateRulesWorkerWorld({
      protocolVersion: 1,
      rulesArtifactHash: certified.artifact.source.release.releaseHash,
      stateHash,
      world,
    })).resolves.toMatchObject({ status: 'valid', stateHash });
  });

  it('produces the exact browser-core state and event hashes', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'worker-parity-world',
      ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    const command: GameCommand = {
      schemaVersion: 1,
      commandId: 'f0490b40-75d4-455a-8d93-202cd9be98cc',
      expectedRevision: world.revision,
      rulesetContentHash: world.ruleset.contentHash,
      actorId: 'fighter',
      type: 'StartEncounter',
      initiative: ['fighter', 'wizard'],
    };
    const browser = handleCommand(world, command, certified.catalog, {
      rng: () => 0.5,
      clock: createLogicalClock(world.logicalClock),
      nextId: createSequentialIdFactory('browser-parity'),
    });
    expect(browser.status).toBe('accepted');
    if (browser.status !== 'accepted') return;

    const worker = await executeRulesWorkerRequest({
      protocolVersion: 1,
      rulesArtifactHash: certified.artifact.source.release.releaseHash,
      baseStateHash: await canonicalSha256(world),
      world,
      command,
      rngTape: [0x80000000],
    });
    expect(worker.status).toBe('accepted');
    if (worker.status !== 'accepted') return;
    expect(worker.nextState).toEqual(browser.nextState);
    expect(worker.events).toEqual(browser.events);
    expect(worker.stateHash).toBe(await canonicalSha256(browser.nextState));
    expect(worker.eventHash).toBe(await canonicalSha256(browser.events));
    expect(worker.rngConsumed).toEqual([]);
    expect(worker.semanticAuthority).toBe('server_rules_core_verified');
  });

  it('fails closed on an unpinned rules artifact', async () => {
    const certified = await loadCertifiedSheetCombatCatalog();
    const world = createWorld({
      id: 'worker-reject-world',
      ruleset: certified.ruleset,
      actors: [actor('fighter'), actor('wizard')],
    });
    await expect(executeRulesWorkerRequest({
      protocolVersion: 1,
      rulesArtifactHash: `sha256:${'0'.repeat(64)}`,
      baseStateHash: await canonicalSha256(world),
      world,
      command: {
        schemaVersion: 1,
        commandId: '75895fd2-ef97-4879-a8bd-a8cb12833dde',
        expectedRevision: 0,
        rulesetContentHash: world.ruleset.contentHash,
        actorId: 'fighter',
        type: 'StartEncounter',
        initiative: ['fighter', 'wizard'],
      },
      rngTape: [1],
    })).rejects.toThrow('certified worker artifact');
  });
});
