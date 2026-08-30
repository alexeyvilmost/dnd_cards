import { canonicalStringify, sha256String } from '../rules-core/determinism';
import type { EngineEvent } from '../mvp/contracts';
import type { UncommittedRuleEvent, WorldState } from '../rules-core/domain';
import { migrateWorldState } from '../rules-core/worldMigration';
import type {
  CharacterRuntimeCommandEvent,
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from './runtime';
import {
  projectSheetCanonicalPersistence,
  synchronizeSheetCanonicalRuntime,
  writeSheetCanonicalWorld,
  type SheetCanonicalRuntime,
} from './sheetCanonicalWorld';
import { DEFAULT_CHARACTER_SYSTEM_ID, type ForgeCharacter } from './types';

export interface SheetAtomicWorldParticipant {
  character: ForgeCharacter;
  canonical: SheetCanonicalRuntime;
  /** Participant-owned world to persist after the accepted shared transition. */
  world: WorldState;
}

export interface PreparedSheetAtomicWorldCommit {
  request: CharacterRuntimeCommandRequest;
  worldsByCharacterId: Record<string, WorldState>;
}

export interface SheetAtomicRuntimeCommandStore {
  commit(request: CharacterRuntimeCommandRequest): Promise<CharacterRuntimeCommandResponse>;
}

export class SheetAtomicWorldCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetAtomicWorldCommitError';
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function runtimeRevision(character: ForgeCharacter): number {
  if (!Number.isSafeInteger(character.runtime_revision) || Number(character.runtime_revision) < 0) {
    throw new SheetAtomicWorldCommitError(
      `${character.id} has no server-owned runtime_revision`,
    );
  }
  return Number(character.runtime_revision);
}

function sameRuleset(left: WorldState['ruleset'], right: WorldState['ruleset']): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function boundedIdentity(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && value.trim() === value;
}

function validRuntimeCommandRuleset(ruleset: WorldState['ruleset']): boolean {
  return Object.keys(ruleset).sort().join(',') === 'contentHash,errataVersion,releaseId,systemId'
    && ruleset.systemId === DEFAULT_CHARACTER_SYSTEM_ID
    && boundedIdentity(ruleset.releaseId, 255)
    && /^sha256:[0-9a-f]{64}$/.test(ruleset.contentHash)
    && boundedIdentity(ruleset.errataVersion, 100);
}

/**
 * Character-sheet content hashes intentionally pin each actor's own compiled
 * actions, cards and effects. Different builds therefore have different hashes
 * even when they were compiled by the same rules release. Cross-sheet commands
 * keep those actor-owned identities in their individual worlds and use this
 * deterministic bundle identity only for the atomic transaction receipt.
 */
export function composeSheetRuntimeRuleset(
  rulesets: readonly WorldState['ruleset'][],
): WorldState['ruleset'] {
  if (!rulesets.length || rulesets.some((ruleset) => !validRuntimeCommandRuleset(ruleset))) {
    throw new SheetAtomicWorldCommitError(
      'Atomic sheet transition requires a server-compatible ruleset identity',
    );
  }
  const first = rulesets[0];
  if (rulesets.some((ruleset) => (
    ruleset.systemId !== first.systemId
    || ruleset.releaseId !== first.releaseId
    || ruleset.errataVersion !== first.errataVersion
  ))) {
    throw new SheetAtomicWorldCommitError('Atomic participants use incompatible rulesets');
  }
  const contentHashes = [...new Set(rulesets.map((ruleset) => ruleset.contentHash))].sort();
  return {
    systemId: first.systemId,
    releaseId: first.releaseId,
    contentHash: contentHashes.length === 1
      ? contentHashes[0]
      : `sha256:${sha256String(canonicalStringify({
          schemaVersion: 1,
          kind: 'sheet-runtime-content-bundle',
          contentHashes,
        }))}`,
    errataVersion: first.errataVersion,
  };
}

function runtimeEvents(
  events: readonly UncommittedRuleEvent[],
  participantIds: ReadonlySet<string>,
): CharacterRuntimeCommandEvent[] {
  const result: CharacterRuntimeCommandEvent[] = [];
  for (const event of events) {
    if (event.payload.type !== 'EngineEventRecorded') continue;
    const recipients = new Set([event.payload.actorId, ...event.payload.targetIds]);
    for (const characterId of [...recipients].sort()) {
      if (!participantIds.has(characterId)) continue;
      const payload = clone(event.payload.event) as EngineEvent;
      result.push({ character_id: characterId, type: payload.type, payload });
    }
  }
  return result;
}

function participantPatch(participant: SheetAtomicWorldParticipant) {
  const { character, canonical } = participant;
  const actor = participant.world.actors[character.id];
  if (!actor) {
    throw new SheetAtomicWorldCommitError(
      `Atomic world misses participant ${character.id}`,
    );
  }
  const projection = projectSheetCanonicalPersistence({
    runtime: actor.runtime,
    currency: character.currency,
    resourceBindings: canonical.resourceBindings,
  });
  const turnState = writeSheetCanonicalWorld(
    writeRulesEngineRuntimeTurnState(character.turn_state, projection.runtime),
    character.id,
    participant.world,
    canonical.resourceBindings,
  );
  const inventoryItems = runtimeInventoryPayload(projection.runtime);
  const inventoryChanged = canonicalStringify(inventoryItems)
    !== canonicalStringify(character.inventory_items ?? []);
  return {
    character_id: character.id,
    expected_runtime_revision: runtimeRevision(character),
    patch: {
      current_hp: projection.runtime.hp.current,
      ...(inventoryChanged ? { inventory_items: inventoryItems } : {}),
      resources: clone(projection.runtime.resources),
      max_resources: clone(projection.runtime.maxResources),
      active_effects: clone(projection.runtime.activeEffects),
      turn_state: turnState,
      ...(projection.currency ? { currency: projection.currency } : {}),
    },
  };
}

/**
 * Project one actor's accepted runtime into that character's own canonical
 * envelope. The shared source world may own cross-sheet concentration; target
 * sheets keep only their own world plus the resulting runtime/effects.
 */
export function projectSheetAtomicParticipantWorld(input: {
  participant: Pick<SheetAtomicWorldParticipant, 'character' | 'canonical'>;
  acceptedWorld: WorldState;
  commandId: string;
}): WorldState {
  const actor = input.acceptedWorld.actors[input.participant.character.id];
  if (!actor) {
    throw new SheetAtomicWorldCommitError(
      `Accepted world misses participant ${input.participant.character.id}`,
    );
  }
  const world = synchronizeSheetCanonicalRuntime(
    input.participant.canonical.world,
    input.participant.character.id,
    actor.runtime,
    Object.keys(input.participant.canonical.resourceBindings),
  );
  return migrateWorldState({
    ...world,
    revision: Math.max(world.revision + 1, input.acceptedWorld.revision),
    logicalClock: Math.max(world.logicalClock, input.acceptedWorld.logicalClock),
    processedCommandIds: [...new Set([
      ...world.processedCommandIds,
      input.commandId,
    ])].sort(),
  });
}

/** Build one sorted, idempotent, all-participant CAS transaction. */
export function prepareSheetAtomicWorldCommit(input: {
  commandId: string;
  participants: readonly SheetAtomicWorldParticipant[];
  events: readonly UncommittedRuleEvent[];
}): PreparedSheetAtomicWorldCommit {
  if (!canonicalUuid(input.commandId)) {
    throw new SheetAtomicWorldCommitError(
      'Atomic sheet transition requires a canonical UUID command_id',
    );
  }
  if (!input.participants.length || input.participants.length > 16) {
    throw new SheetAtomicWorldCommitError(
      'Atomic sheet transition requires 1 to 16 participants',
    );
  }
  const sorted = [...input.participants]
    .sort((left, right) => left.character.id.localeCompare(right.character.id));
  const ids = new Set<string>();
  const participantRulesets: WorldState['ruleset'][] = [];
  for (const participant of sorted) {
    const { character, canonical, world } = participant;
    if (ids.has(character.id)) {
      throw new SheetAtomicWorldCommitError('Atomic sheet transition has a duplicate participant');
    }
    ids.add(character.id);
    if (character.access_mode !== 'owner' || canonical.actorId !== character.id) {
      throw new SheetAtomicWorldCommitError(
        `Atomic sheet transition requires owner access to ${character.id}`,
      );
    }
    runtimeRevision(character);
    if (world.pendingResolution) {
      throw new SheetAtomicWorldCommitError(
        `Atomic sheet transition cannot persist a pending resolution for ${character.id}`,
      );
    }
    if (character.system_id !== canonical.world.ruleset.systemId
      || !sameRuleset(canonical.world.ruleset, world.ruleset)) {
      throw new SheetAtomicWorldCommitError('Atomic participants use incompatible rulesets');
    }
    participantRulesets.push(canonical.world.ruleset);
  }
  const ruleset = composeSheetRuntimeRuleset(participantRulesets);
  return {
    worldsByCharacterId: Object.fromEntries(sorted.map((participant) => [
      participant.character.id,
      clone(participant.world),
    ])),
    request: {
      command_id: input.commandId,
      ruleset_ref: {
        system_id: ruleset.systemId,
        release_id: ruleset.releaseId,
        content_hash: ruleset.contentHash,
        errata_version: ruleset.errataVersion,
      },
      participants: sorted.map(participantPatch),
      events: runtimeEvents(input.events, ids),
    },
  };
}

export function commitPreparedSheetAtomicWorld(
  store: SheetAtomicRuntimeCommandStore,
  prepared: PreparedSheetAtomicWorldCommit,
): Promise<CharacterRuntimeCommandResponse> {
  return store.commit(clone(prepared.request));
}
