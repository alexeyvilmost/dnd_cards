import { canonicalStringify } from '../rules-core/determinism';
import type {
  FamiliarObservableFacts,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  WorldState,
} from '../rules-core/domain';
import { migrateWorldState } from '../rules-core/worldMigration';
import type {
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import { mergeSheetCombatParticipantWorlds } from './sheetCombatSession';
import {
  buildFamiliarTouchSpellCommand,
  executeSheetCompanionCommand,
  SheetCompanionActionError,
} from './sheetCompanionActions';
import {
  type SheetCanonicalRuntime,
} from './sheetCanonicalWorld';
import {
  composeSheetRuntimeRuleset,
  prepareSheetAtomicWorldCommit,
} from './sheetAtomicWorldCommit';
import type { ForgeCharacter } from './types';
import { acceptedRuntimeCommandReceipt } from './sheetRuntimeCommand';

export const SHEET_COMPANION_CONTINUATION_REASON =
  'Действие открыло решение атаки, спасброска или реакции. Такой continuation пока доступен только в сертифицированной двухлистовой боевой сессии.';

export interface SheetCompanionParticipant {
  character: ForgeCharacter;
  canonical: SheetCanonicalRuntime;
}

export interface PreparedSheetCompanionInteraction {
  request: CharacterRuntimeCommandRequest;
  worldsByCharacterId: Record<string, WorldState>;
}

export type SheetCompanionRetryPolicy = 'retain_exact_retry' | 'discard_and_refresh';

/**
 * A transport failure, timeout, retryable HTTP response or malformed success
 * can hide a committed transaction, so the exact command_id/CAS snapshot must
 * be retained. A definitive client rejection cannot become successful by
 * replaying the same stale snapshot and must instead be discarded/refetched.
 */
export function sheetCompanionRetryPolicy(error: unknown): SheetCompanionRetryPolicy {
  if (!error || typeof error !== 'object') return 'retain_exact_retry';
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.response?.status === 'number'
      ? candidate.response.status
      : undefined;
  if (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500) {
    return 'retain_exact_retry';
  }
  return status >= 400 && status < 500 ? 'discard_and_refresh' : 'retain_exact_retry';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtimeRevision(character: ForgeCharacter): number {
  if (!Number.isSafeInteger(character.runtime_revision) || Number(character.runtime_revision) < 0) {
    throw new SheetCompanionActionError(`${character.id} has no server-owned runtime_revision`);
  }
  return Number(character.runtime_revision);
}

function canonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function matchingCanonicalRuleset(
  participants: readonly SheetCompanionParticipant[],
): WorldState['ruleset'] {
  const rulesets = participants.map(({ canonical }) => canonical?.world?.ruleset as unknown);
  const requiredKeys = ['systemId', 'releaseId', 'contentHash', 'errataVersion'] as const;
  if (rulesets.some((ruleset) => (
    !ruleset
    || typeof ruleset !== 'object'
    || Array.isArray(ruleset)
    || requiredKeys.some((key) => (
      typeof (ruleset as Record<string, unknown>)[key] !== 'string'
      || (ruleset as Record<string, string>)[key].length === 0
    ))
  ))) {
    throw new SheetCompanionActionError('Familiar Touch requires a complete canonical ruleset reference');
  }
  try {
    return composeSheetRuntimeRuleset(rulesets as WorldState['ruleset'][]);
  } catch {
    throw new SheetCompanionActionError('Characters use incompatible canonical ruleset releases');
  }
}

function catalogFor(runtimes: readonly SheetCanonicalRuntime[]): RulesCatalog {
  const actions = new Map<string, RuleActionDefinition>();
  for (const runtime of runtimes) {
    for (const action of runtime.actions) {
      const previous = actions.get(action.id);
      if (previous && canonicalStringify(previous) !== canonicalStringify(action)) {
        throw new SheetCompanionActionError(`Conflicting canonical action ${action.id}`);
      }
      actions.set(action.id, clone(action));
    }
  }
  const cards = new Map(runtimes.flatMap((runtime) => runtime.cards).map((card) => [card.id, card]));
  const stable = [...actions.values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    getAction: (id) => actions.get(id),
    listActions: () => stable,
    getCard: (id) => cards.get(id),
  };
}

function ownedActorIds(world: WorldState, ownerActorId: string): Set<string> {
  if (!world.actors[ownerActorId]) {
    throw new SheetCompanionActionError(`Companion world misses participant ${ownerActorId}`);
  }
  return new Set(Object.values(world.actors).flatMap((actor) => (
    actor.id === ownerActorId || actor.familiarState?.ownerActorId === ownerActorId
      ? [actor.id]
      : []
  )));
}

type ParticipantRecordOwnership = 'owned' | 'foreign' | 'mixed';

function participantRecordOwnership(input: {
  actorIds: readonly string[];
  ownedActorIds: ReadonlySet<string>;
  knownActorIds: ReadonlySet<string>;
  label: string;
}): ParticipantRecordOwnership {
  const actorIds = [...new Set(input.actorIds)];
  if (!actorIds.length) {
    throw new SheetCompanionActionError(`${input.label} has no actor ownership references`);
  }
  const missing = actorIds.filter((actorId) => !input.knownActorIds.has(actorId));
  if (missing.length) {
    throw new SheetCompanionActionError(
      `${input.label} references missing actors: ${missing.join(', ')}`,
    );
  }
  const hasOwned = actorIds.some((actorId) => input.ownedActorIds.has(actorId));
  const hasForeign = actorIds.some((actorId) => !input.ownedActorIds.has(actorId));
  if (hasOwned && hasForeign) return 'mixed';
  return hasOwned ? 'owned' : 'foreign';
}

function projectParticipantRecords<T>(input: {
  current: Readonly<Record<string, T>>;
  before: Readonly<Record<string, T>>;
  after: Readonly<Record<string, T>>;
  beforeOwnedActorIds: ReadonlySet<string>;
  afterOwnedActorIds: ReadonlySet<string>;
  beforeKnownActorIds: ReadonlySet<string>;
  afterKnownActorIds: ReadonlySet<string>;
  actorIds: (entry: T) => readonly string[];
  label: string;
}): Record<string, T> {
  const classify = (
    entries: Readonly<Record<string, T>>,
    ownedActorIds: ReadonlySet<string>,
    knownActorIds: ReadonlySet<string>,
    phase: 'before' | 'after',
  ) => Object.fromEntries(Object.entries(entries).map(([id, entry]) => [
    id,
    participantRecordOwnership({
      actorIds: input.actorIds(entry),
      ownedActorIds,
      knownActorIds,
      label: `${phase} ${input.label} ${id}`,
    }),
  ])) as Record<string, ParticipantRecordOwnership>;

  const beforeOwnership = classify(
    input.before,
    input.beforeOwnedActorIds,
    input.beforeKnownActorIds,
    'before',
  );
  const afterOwnership = classify(
    input.after,
    input.afterOwnedActorIds,
    input.afterKnownActorIds,
    'after',
  );
  if (Object.values(beforeOwnership).includes('mixed')
    || Object.values(afterOwnership).includes('mixed')) {
    throw new SheetCompanionActionError(SHEET_COMPANION_CONTINUATION_REASON);
  }

  const projected: Record<string, T> = Object.fromEntries(
    Object.entries(input.current).map(([id, entry]) => [id, clone(entry)]),
  );
  for (const [id, ownership] of Object.entries(beforeOwnership)) {
    if (ownership === 'owned') delete projected[id];
  }
  for (const [id, ownership] of Object.entries(afterOwnership)) {
    if (ownership === 'owned') projected[id] = clone(input.after[id]);
  }
  return projected;
}

function objectActorIds(object: WorldState['objects'][string]): string[] {
  return [...new Set([
    object.ownerActorId,
    object.carriedByActorId,
    object.sourceActorId,
    object.heldByActorId,
    object.attunedToActorId,
    object.illumination?.sourceActorId,
    ...(object.prestidigitation ?? []).map((entry) => entry.sourceActorId),
    ...(object.illusion?.discernedByActorIds ?? []),
    ...(object.illusion?.physicallyRevealedToActorIds ?? []),
  ].filter((actorId): actorId is string => typeof actorId === 'string' && actorId.length > 0))];
}

/**
 * Project only one participant's ownership closure back into its own canonical
 * envelope. Cross-owner concentrations/grapples require a durable continuation
 * and deliberately fail here instead of creating two divergent worlds.
 */
export function projectSheetCompanionParticipantWorld(input: {
  participant: SheetCompanionParticipant;
  mergedBefore: WorldState;
  mergedAfter: WorldState;
  commandId: string;
}): WorldState {
  const ownerId = input.participant.character.id;
  const beforeOwned = ownedActorIds(input.mergedBefore, ownerId);
  const afterOwned = ownedActorIds(input.mergedAfter, ownerId);
  const beforeKnown = new Set(Object.keys(input.mergedBefore.actors));
  const afterKnown = new Set(Object.keys(input.mergedAfter.actors));
  const world = clone(input.participant.canonical.world);
  for (const actorId of beforeOwned) {
    delete world.actors[actorId];
  }
  for (const actorId of afterOwned) world.actors[actorId] = clone(input.mergedAfter.actors[actorId]);

  if (input.mergedAfter.pendingResolution) {
    throw new SheetCompanionActionError(SHEET_COMPANION_CONTINUATION_REASON);
  }

  world.objects = projectParticipantRecords({
    current: world.objects,
    before: input.mergedBefore.objects,
    after: input.mergedAfter.objects,
    beforeOwnedActorIds: beforeOwned,
    afterOwnedActorIds: afterOwned,
    beforeKnownActorIds: beforeKnown,
    afterKnownActorIds: afterKnown,
    actorIds: objectActorIds,
    label: 'world object',
  });
  world.concentrations = projectParticipantRecords({
    current: world.concentrations,
    before: input.mergedBefore.concentrations,
    after: input.mergedAfter.concentrations,
    beforeOwnedActorIds: beforeOwned,
    afterOwnedActorIds: afterOwned,
    beforeKnownActorIds: beforeKnown,
    afterKnownActorIds: afterKnown,
    actorIds: (entry) => [
      entry.sourceActorId,
      ...entry.effectLinks.map((link) => link.actorId),
    ],
    label: 'concentration',
  });
  world.attackActions = projectParticipantRecords({
    current: world.attackActions,
    before: input.mergedBefore.attackActions,
    after: input.mergedAfter.attackActions,
    beforeOwnedActorIds: beforeOwned,
    afterOwnedActorIds: afterOwned,
    beforeKnownActorIds: beforeKnown,
    afterKnownActorIds: afterKnown,
    actorIds: (entry) => [entry.actorId],
    label: 'Attack action',
  });
  world.grapples = projectParticipantRecords({
    current: world.grapples,
    before: input.mergedBefore.grapples,
    after: input.mergedAfter.grapples,
    beforeOwnedActorIds: beforeOwned,
    afterOwnedActorIds: afterOwned,
    beforeKnownActorIds: beforeKnown,
    afterKnownActorIds: afterKnown,
    actorIds: (entry) => [entry.grapplerActorId, entry.targetActorId],
    label: 'grapple',
  });

  world.revision = Math.max(world.revision + 1, input.mergedAfter.revision);
  world.logicalClock = Math.max(world.logicalClock, input.mergedAfter.logicalClock);
  world.processedCommandIds = [...new Set([
    ...world.processedCommandIds,
    input.commandId,
  ])].sort();
  world.pendingResolution = null;
  return migrateWorldState(world);
}

/**
 * Prepare a fully-resolved one-sheet companion/Pact transition for the same
 * atomic CAS and idempotency transport used by multi-sheet combat. Rules-core
 * remains the semantic authority; this adapter only projects its postimage.
 */
export function prepareSheetCompanionCommand(input: {
  participant: SheetCompanionParticipant;
  command: GameCommand;
  onlineEncounterId?: string | null;
  rng: () => number;
}): PreparedSheetCompanionInteraction {
  const { character, canonical } = input.participant;
  if (!canonicalUuid(input.command.commandId)) {
    throw new SheetCompanionActionError(
      'Atomic companion operation requires a canonical UUID command_id',
    );
  }
  if (character.id !== canonical.actorId || character.access_mode !== 'owner') {
    throw new SheetCompanionActionError(
      'Companion operation requires an owner-writable canonical sheet',
    );
  }
  if (character.system_id !== canonical.world.ruleset.systemId) {
    throw new SheetCompanionActionError('Companion sheet uses an incompatible rules system');
  }
  runtimeRevision(character);
  matchingCanonicalRuleset([input.participant]);

  const executed = executeSheetCompanionCommand({
    runtime: canonical,
    onlineEncounterId: input.onlineEncounterId || character.current_encounter_id,
    command: input.command,
    rng: input.rng,
  });
  if (executed.world.pendingResolution) {
    throw new SheetCompanionActionError(SHEET_COMPANION_CONTINUATION_REASON);
  }
  const world = migrateWorldState(clone(executed.world));
  return prepareSheetAtomicWorldCommit({
    commandId: input.command.commandId,
    participants: [{ ...input.participant, world }],
    events: executed.events,
  });
}

/**
 * Execute and prepare one fully-resolved familiar Touch delivery against two
 * owner-writable CharacterV3 sheets. The existing backend runtime-command CAS
 * commits both patches atomically and deduplicates the exact command_id.
 */
export function prepareSheetFamiliarTouchInteraction(input: {
  source: SheetCompanionParticipant;
  target: SheetCompanionParticipant;
  commandId: string;
  spellActionId: string;
  castOptionId: string;
  ownerToFamiliarFacts: FamiliarObservableFacts;
  familiarToTargetFacts: SpatialFacts;
  choices?: Record<string, string | string[]>;
  rng: () => number;
}): PreparedSheetCompanionInteraction {
  if (!canonicalUuid(input.commandId)) {
    throw new SheetCompanionActionError('Atomic familiar interaction requires a canonical UUID command_id');
  }
  const participants = [input.source, input.target];
  const ruleset = matchingCanonicalRuleset(participants);
  if (input.source.character.id === input.target.character.id) {
    throw new SheetCompanionActionError('Familiar Touch requires two distinct CharacterV3 sheets');
  }
  if (participants.some(({ character }) => character.current_encounter_id)) {
    throw new SheetCompanionActionError(
      'Familiar Touch is unavailable while either sheet belongs to an online encounter',
    );
  }
  if (participants.some(({ character, canonical }) => (
    character.id !== canonical.actorId || character.access_mode !== 'owner'
  ))) {
    throw new SheetCompanionActionError('Familiar Touch requires two owner-writable canonical sheets');
  }
  const systems = new Set(participants.map(({ character }) => character.system_id));
  if (systems.size !== 1) throw new SheetCompanionActionError('Characters use incompatible rules systems');
  participants.forEach(({ character }) => runtimeRevision(character));

  const catalog = catalogFor(participants.map(({ canonical }) => canonical));
  const merged = mergeSheetCombatParticipantWorlds({
    seeds: participants,
    ruleset: clone(ruleset),
    worldId: `sheet-companion:${input.source.character.id}:${input.target.character.id}`,
    sceneMode: 'exploration',
  });
  const runtime: SheetCanonicalRuntime = {
    ...input.source.canonical,
    world: merged,
    catalog,
    actions: catalog.listActions?.() ?? [],
  };
  const command = buildFamiliarTouchSpellCommand({
    runtime,
    commandId: input.commandId,
    spellActionId: input.spellActionId,
    castOptionId: input.castOptionId,
    targetActorId: input.target.character.id,
    ownerToFamiliarFacts: input.ownerToFamiliarFacts,
    familiarToTargetFacts: input.familiarToTargetFacts,
    ...(input.choices ? { choices: input.choices } : {}),
  });
  const executed = executeSheetCompanionCommand({ runtime, command, rng: input.rng });
  if (executed.world.pendingResolution) {
    throw new SheetCompanionActionError(SHEET_COMPANION_CONTINUATION_REASON);
  }

  const worldsByCharacterId = Object.fromEntries(participants.map((participant) => [
    participant.character.id,
    projectSheetCompanionParticipantWorld({
      participant,
      mergedBefore: merged,
      mergedAfter: executed.world,
      commandId: input.commandId,
    }),
  ]));
  return prepareSheetAtomicWorldCommit({
    commandId: input.commandId,
    participants: participants.map((participant) => ({
      ...participant,
      world: worldsByCharacterId[participant.character.id],
    })),
    events: executed.events,
  });
}

/** Receipt proof only. A replay caller must refetch current participants before updating UI. */
export function acceptedSheetCompanionCharacters(
  prepared: PreparedSheetCompanionInteraction,
  response: CharacterRuntimeCommandResponse,
): Record<string, ForgeCharacter> {
  try {
    return acceptedRuntimeCommandReceipt(prepared.request, response);
  } catch (cause) {
    throw new SheetCompanionActionError(
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
