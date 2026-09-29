import type { ExecuteResult } from '../mvp/contracts';
import type { UncommittedRuleEvent } from '../rules-core/domain';
import type { SheetCombatParticipantSeed } from './sheetCombatSession';
import { prepareSheetAtomicWorldCommit } from './sheetAtomicWorldCommit';
import { emptyDeathSaves } from './death';

/** Persist the single confirmed outcome with the same receipt/CAS as sheet actions. */
export function prepareSheetRestCommit(input: {
  commandId: string;
  participant: SheetCombatParticipantSeed;
  result: ExecuteResult;
  turnState?: Record<string, unknown> | null;
}) {
  const { participant, result } = input;
  const world = structuredClone(participant.canonical.world);
  const actor = world.actors[participant.character.id];
  actor.runtime = structuredClone(result.state);
  if (!result.restBenefitsDenied) actor.runtime.deathSaves = emptyDeathSaves();
  world.revision += 1;
  world.logicalClock += 1;
  world.processedCommandIds = [...new Set([...world.processedCommandIds, input.commandId])];
  const turnState = result.restBenefitsDenied ? participant.character.turn_state : input.turnState ?? participant.character.turn_state;
  const character = { ...participant.character, turn_state: {
    ...turnState,
    ...(!result.restBenefitsDenied ? { attunement_unlocked: true, death_saves: emptyDeathSaves() } : {}),
  } };
  const events: UncommittedRuleEvent[] = result.events.map((event, ordinal) => ({ ordinal,
    sourceActorId: actor.id, obligationIds: ['system:confirmed-rest'],
    payload: { type: 'EngineEventRecorded', actorId: actor.id, targetIds: [], event },
  }));
  return prepareSheetAtomicWorldCommit({ commandId: input.commandId, participants: [{ ...participant, character, world }], events });
}
