import { loadCertifiedSheetCombatCatalog } from '../character/sheetCombatCertifiedCatalog';
import { assertCertifiedSheetCombatActorAccess } from '../character/sheetCombatCertifiedCatalog';
import {
  canonicalSha256,
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
} from '../rules-core/determinism';
import type {
  CommandResult,
  GameCommand,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { migrateWorldState } from '../rules-core/worldMigration';

export const RULES_WORKER_PROTOCOL_VERSION = 1 as const;
export const RULES_WORKER_ENGINE_VERSION = 'rules-core-worker-v1' as const;
export const RULES_WORKER_SCHEMA_VALIDATION = 'rules-core-world-v5-verified' as const;

export interface RulesWorkerExecuteRequest {
  protocolVersion: typeof RULES_WORKER_PROTOCOL_VERSION;
  rulesArtifactHash: string;
  baseStateHash: string;
  world: WorldState;
  command: GameCommand;
  /** Server-generated uint32 values. Clients never supply this field to the public API. */
  rngTape: number[];
}

export interface RulesWorkerValidateRequest {
  protocolVersion: typeof RULES_WORKER_PROTOCOL_VERSION;
  rulesArtifactHash: string;
  stateHash: string;
  world: WorldState;
}

export interface RulesWorkerValidateResponse {
  protocolVersion: typeof RULES_WORKER_PROTOCOL_VERSION;
  engineVersion: typeof RULES_WORKER_ENGINE_VERSION;
  semanticAuthority: 'server_rules_core_verified';
  schemaValidation: typeof RULES_WORKER_SCHEMA_VALIDATION;
  status: 'valid';
  rulesArtifactHash: string;
  stateHash: string;
}

export type RulesWorkerExecuteResponse =
  | {
    protocolVersion: typeof RULES_WORKER_PROTOCOL_VERSION;
    engineVersion: typeof RULES_WORKER_ENGINE_VERSION;
    semanticAuthority: 'server_rules_core_verified';
    schemaValidation: typeof RULES_WORKER_SCHEMA_VALIDATION;
    status: 'accepted';
    rulesArtifactHash: string;
    baseStateHash: string;
    stateHash: string;
    eventHash: string;
    rngConsumed: number[];
    events: UncommittedRuleEvent[];
    nextState: WorldState;
  }
  | {
    protocolVersion: typeof RULES_WORKER_PROTOCOL_VERSION;
    engineVersion: typeof RULES_WORKER_ENGINE_VERSION;
    semanticAuthority: 'server_rules_core_verified';
    schemaValidation: typeof RULES_WORKER_SCHEMA_VALIDATION;
    status: 'rejected';
    rulesArtifactHash: string;
    baseStateHash: string;
    stateHash: string;
    rngConsumed: number[];
    code: Extract<CommandResult, { status: 'rejected' }>['code'];
    message: string;
  };

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertUint32Tape(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4096) {
    throw new Error('rngTape must contain 1-4096 server-generated uint32 values');
  }
  for (const entry of value) {
    if (!Number.isSafeInteger(entry) || entry < 0 || entry > 0xffffffff) {
      throw new Error('rngTape contains a value outside uint32');
    }
  }
}

function exactRuleset(
  actual: WorldState['ruleset'],
  expected: WorldState['ruleset'],
): boolean {
  return canonicalStringify(actual) === canonicalStringify(expected);
}

export async function validateRulesWorkerWorld(
  raw: RulesWorkerValidateRequest,
): Promise<RulesWorkerValidateResponse> {
  assertObject(raw, 'rules worker validation request');
  if (raw.protocolVersion !== RULES_WORKER_PROTOCOL_VERSION) {
    throw new Error('unsupported rules worker protocolVersion');
  }
  const certified = await loadCertifiedSheetCombatCatalog();
  const expectedArtifactHash = certified.artifact.source.release.releaseHash;
  if (raw.rulesArtifactHash !== expectedArtifactHash) {
    throw new Error('rulesArtifactHash is not the certified worker artifact');
  }
  const stateHash = await canonicalSha256(raw.world);
  if (raw.stateHash !== stateHash) {
    throw new Error('stateHash does not match canonical WorldState');
  }
  const world = migrateWorldState(structuredClone(raw.world));
  if (canonicalStringify(world) !== canonicalStringify(raw.world)) {
    throw new Error('WorldState must be normalized to the current schema before worker validation');
  }
  if (!exactRuleset(world.ruleset, certified.ruleset)) {
    throw new Error('WorldState ruleset is not the certified worker release');
  }
  for (const actor of Object.values(world.actors)) {
    const certifiedActionIds = actor.capabilities.actionIds.filter((id) => (
      certified.catalog.getAction(id) !== undefined
    ));
    assertCertifiedSheetCombatActorAccess(actor, certifiedActionIds, certified);
  }
  return {
    protocolVersion: RULES_WORKER_PROTOCOL_VERSION,
    engineVersion: RULES_WORKER_ENGINE_VERSION,
    semanticAuthority: 'server_rules_core_verified',
    schemaValidation: RULES_WORKER_SCHEMA_VALIDATION,
    status: 'valid',
    rulesArtifactHash: raw.rulesArtifactHash,
    stateHash,
  };
}

/**
 * Pure server adapter over the browser rules core. The only non-domain input is
 * an explicit RNG tape generated by Go and persisted with the command receipt.
 */
export async function executeRulesWorkerRequest(
  raw: RulesWorkerExecuteRequest,
): Promise<RulesWorkerExecuteResponse> {
  assertObject(raw, 'rules worker request');
  if (raw.protocolVersion !== RULES_WORKER_PROTOCOL_VERSION) {
    throw new Error('unsupported rules worker protocolVersion');
  }
  assertUint32Tape(raw.rngTape);
  const validation = await validateRulesWorkerWorld({
    protocolVersion: raw.protocolVersion,
    rulesArtifactHash: raw.rulesArtifactHash,
    stateHash: raw.baseStateHash,
    world: raw.world,
  });
  const certified = await loadCertifiedSheetCombatCatalog();
  const world = structuredClone(raw.world);
  const baseStateHash = validation.stateHash;
  if (raw.command.rulesetContentHash !== world.ruleset.contentHash) {
    throw new Error('command rulesetContentHash differs from WorldState');
  }

  let rngIndex = 0;
  const rng = () => {
    const value = raw.rngTape[rngIndex];
    if (value === undefined) throw new Error('server RNG tape exhausted');
    rngIndex += 1;
    return value / 0x1_0000_0000;
  };
  const cards = new Map<string, NonNullable<WorldState['actors'][string]['character']['knownCards']>[number]>();
  for (const actor of Object.values(world.actors)) {
    for (const card of [...(actor.character.knownCards ?? []), ...(actor.character.equippedCards ?? [])]) {
      const previous = cards.get(card.id);
      if (previous && canonicalStringify(previous) !== canonicalStringify(card)) {
        throw new Error(`WorldState contains conflicting immutable card ${card.id}`);
      }
      cards.set(card.id, structuredClone(card));
    }
  }
  const catalog = {
    ...certified.catalog,
    getCard: (id: string) => cards.get(id),
  };
  const result = handleCommand(world, structuredClone(raw.command), catalog, {
    rng,
    clock: createLogicalClock(world.logicalClock),
    nextId: createSequentialIdFactory(`worker:${raw.command.commandId}`),
  });
  const rngConsumed = raw.rngTape.slice(0, rngIndex);
  if (result.status === 'rejected') {
    return {
      protocolVersion: RULES_WORKER_PROTOCOL_VERSION,
      engineVersion: RULES_WORKER_ENGINE_VERSION,
      semanticAuthority: 'server_rules_core_verified',
      schemaValidation: RULES_WORKER_SCHEMA_VALIDATION,
      status: 'rejected',
      rulesArtifactHash: raw.rulesArtifactHash,
      baseStateHash,
      stateHash: baseStateHash,
      rngConsumed,
      code: result.code,
      message: result.message,
    };
  }
  const stateHash = await canonicalSha256(result.nextState);
  const eventHash = await canonicalSha256(result.events);
  return {
    protocolVersion: RULES_WORKER_PROTOCOL_VERSION,
    engineVersion: RULES_WORKER_ENGINE_VERSION,
    semanticAuthority: 'server_rules_core_verified',
    schemaValidation: RULES_WORKER_SCHEMA_VALIDATION,
    status: 'accepted',
    rulesArtifactHash: raw.rulesArtifactHash,
    baseStateHash,
    stateHash,
    eventHash,
    rngConsumed,
    events: structuredClone(result.events),
    nextState: structuredClone(result.nextState),
  };
}
