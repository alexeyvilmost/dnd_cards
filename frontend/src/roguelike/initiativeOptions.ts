import type {Action} from '../types';
import type {ForgeCharacter} from '../character/types';
import type {SheetCombatParticipantSeed} from '../character/sheetCombatSession';
import {availableCheckManeuvers} from '../character/checkManeuvers';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';

/** Read-only options from the same resolved grants and cost checks as the
 * sheet. This does not create an encounter, roll initiative or pay its cost. */
export function participantInitiativeOptions(participant: SheetCombatParticipantSeed): Action[] {
  const actor = participant.canonical.world.actors[participant.character.id];
  const owned = participant.canonical.actions.filter(action => actor.capabilities.actionIds.includes(action.id)).map(action => ({
    ...participant.actionPresentation?.[action.id]?.actionRef,
    id: action.id, name: action.name, mechanics: action.mechanics,
  }) as Action);
  return availableCheckManeuvers(owned, actor.runtime, 'initiative', {});
}

export async function prepareInitiativeOptions(input: {
  character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[];
  catalogProjectionVersion?: 1;
}) {
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds, {consumedCatalog: input.catalogProjectionVersion === 1});
  if (prepared.status !== 'ready') return prepared;
  return {status: 'ready' as const, contentManifestHash: prepared.contentManifestHash,
    ...(prepared.catalogSelection ? {catalogSelection: prepared.catalogSelection} : {}),
    initiativeOptions: participantInitiativeOptions(prepared.participant)};
}
