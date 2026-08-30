import type { ExecuteResult, RuntimeState } from '../mvp/contracts';
import { applySourceTurnBoundary } from '../engine/sourceTurnExpiry';
import type { UncommittedRuleEvent, WorldState } from '../rules-core/domain';
import { migrateWorldState } from '../rules-core/worldMigration';
import type { SheetCombatParticipantSeed } from './sheetCombatSession';
import {
  prepareSheetAtomicWorldCommit,
  projectSheetAtomicParticipantWorld,
  type PreparedSheetAtomicWorldCommit,
} from './sheetAtomicWorldCommit';
import {
  SHEET_CANONICAL_WORLD_KEY,
} from './sheetCanonicalWorld';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordEngineEvents(input: {
  sourceActorId: string;
  ownerActorId: string;
  events: ExecuteResult['events'];
  obligationIds: string[];
  facts?: Record<string, unknown>;
}): UncommittedRuleEvent[] {
  return input.events.map((event) => ({
    ordinal: 0,
    sourceActorId: input.sourceActorId,
    obligationIds: [...input.obligationIds],
    payload: {
      type: 'EngineEventRecorded',
      actorId: input.ownerActorId,
      targetIds: input.ownerActorId === input.sourceActorId ? [] : [input.ownerActorId],
      event: clone(event),
      ...(input.facts ? { facts: clone(input.facts) } : {}),
    },
  }));
}

function sourceTurnCharacterIds(
  world: WorldState,
  sourceActorId: string,
): string[] {
  return Object.values(world.actors)
    .filter((actor) => actor.id !== sourceActorId && actor.kind === 'playerCharacter')
    .filter((actor) => actor.runtime.activeEffects.some((effect) => (
      effect.sourceTurnExpiry?.sourceActorId === sourceActorId
      && effect.sourceTurnExpiry.ownerActorId === actor.id
      && effect.sourceId === sourceActorId
      && effect.ownerId === actor.id
    )))
    .map((actor) => actor.id)
    .sort();
}

/**
 * Read only the participant identities from the source's persisted canonical
 * cache. Fresh character rows are still loaded before the atomic command; this
 * cache is a discovery index, never runtime authority.
 */
export function persistedSourceTurnCharacterIds(
  turnState: Record<string, unknown> | null | undefined,
  sourceActorId: string,
): string[] {
  const raw = turnState?.[SHEET_CANONICAL_WORLD_KEY];
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Сохранённый канонический мир листа повреждён');
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.primaryActorId !== sourceActorId
    || !envelope.world
    || typeof envelope.world !== 'object'
    || Array.isArray(envelope.world)) {
    throw new Error('Сохранённый канонический мир листа не принадлежит персонажу');
  }
  try {
    return sourceTurnCharacterIds(migrateWorldState(clone(envelope.world) as WorldState), sourceActorId);
  } catch (cause) {
    throw new Error('Не удалось прочитать участников длительности эффекта', { cause });
  }
}

/**
 * Advance one detached sheet turn against the source's whole canonical world,
 * then build one all-participant CAS request. End-relative effects are checked
 * before end-turn mechanics; start-relative effects are checked before
 * start-turn mechanics, matching the encounter handler's ordering.
 */
export async function prepareSheetNextTurnAtomicCommit(input: {
  commandId: string;
  source: SheetCombatParticipantSeed;
  externalParticipants: readonly SheetCombatParticipantSeed[];
  endSource: (state: RuntimeState) => Promise<ExecuteResult>;
  startSource: (state: RuntimeState) => Promise<ExecuteResult>;
}): Promise<PreparedSheetAtomicWorldCommit> {
  const sourceActorId = input.source.character.id;
  const participantById = new Map<string, SheetCombatParticipantSeed>([
    [sourceActorId, input.source],
  ]);
  for (const participant of input.externalParticipants) {
    if (participant.character.id === sourceActorId || participantById.has(participant.character.id)) {
      throw new Error('Повторяющийся участник атомарного перехода хода');
    }
    participantById.set(participant.character.id, participant);
  }

  const world = clone(input.source.canonical.world);
  for (const participant of participantById.values()) {
    const freshActor = participant.canonical.world.actors[participant.character.id];
    if (!freshActor) throw new Error(`Канонический мир не содержит ${participant.character.id}`);
    world.actors[participant.character.id] = clone(freshActor);
  }

  const ruleEvents: UncommittedRuleEvent[] = [];
  const advanceBoundary = (boundary: 'start' | 'end') => {
    for (const actor of Object.values(world.actors).sort((left, right) => left.id.localeCompare(right.id))) {
      const advanced = applySourceTurnBoundary(actor.runtime, {
        sourceActorId,
        ownerActorId: actor.id,
        boundary,
      });
      if (!advanced.changed) continue;
      actor.runtime = advanced.state;
      ruleEvents.push(...recordEngineEvents({
        sourceActorId,
        ownerActorId: actor.id,
        events: advanced.events,
        obligationIds: ['system:source-turn-expiry', `system:source-turn-${boundary}`],
        facts: { sourceActorId, ownerActorId: actor.id, boundary },
      }));
    }
  };

  advanceBoundary('end');
  const sourceActor = world.actors[sourceActorId];
  if (!sourceActor) throw new Error('Канонический мир не содержит источник хода');
  const ended = await input.endSource(sourceActor.runtime);
  sourceActor.runtime = ended.state;
  ruleEvents.push(...recordEngineEvents({
    sourceActorId,
    ownerActorId: sourceActorId,
    events: ended.events,
    obligationIds: ['system:turn-end'],
  }));

  advanceBoundary('start');
  const started = await input.startSource(sourceActor.runtime);
  sourceActor.runtime = started.state;
  ruleEvents.push(...recordEngineEvents({
    sourceActorId,
    ownerActorId: sourceActorId,
    events: started.events,
    obligationIds: ['system:turn-start'],
  }));

  world.revision = Math.max(
    world.revision,
    ...[...participantById.values()].map((participant) => participant.canonical.world.revision),
  ) + 1;
  world.logicalClock = Math.max(
    world.logicalClock,
    ...[...participantById.values()].map((participant) => participant.canonical.world.logicalClock),
  ) + 1;
  world.processedCommandIds = [...new Set([
    ...world.processedCommandIds,
    input.commandId,
  ])].sort();
  const acceptedWorld = migrateWorldState(world);
  ruleEvents.forEach((event, ordinal) => { event.ordinal = ordinal; });

  return prepareSheetAtomicWorldCommit({
    commandId: input.commandId,
    participants: [...participantById.values()].map((participant) => ({
      ...participant,
      world: participant.character.id === sourceActorId
        ? acceptedWorld
        : projectSheetAtomicParticipantWorld({
            participant,
            acceptedWorld,
            commandId: input.commandId,
          }),
    })),
    events: ruleEvents,
  });
}
