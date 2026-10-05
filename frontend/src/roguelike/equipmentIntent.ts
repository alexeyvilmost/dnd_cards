import type {ForgeCharacter} from '../character/types';
import {prepareSheetEquipmentCommand} from '../character/sheetEquipmentCommand';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';
import {createRoguelikeCombatRandom} from './combatWorker';

/** Identity-only request. The character and immutable catalog come from the
 * server's owned snapshot, never from the browser's runtime projection. */
export async function executeEquipmentIntent(input: {
  character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds?: string[];
  commandId: string; seed: string; operation: {equip: string} | {unequip: string};
  catalogProjectionVersion?: 1;
}) {
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds ?? [], {consumedCatalog: input.catalogProjectionVersion === 1});
  if (prepared.status !== 'ready') return prepared;
  const world = prepared.participant.canonical.world;
  if (world.pendingResolution || world.scene.mode === 'encounter') {
    throw Error('Equipment intent requires a sheet outside an active encounter or decision');
  }
  const random = createRoguelikeCombatRandom(input.seed, 0);
  const command = prepareSheetEquipmentCommand(prepared.participant, input.commandId, input.operation, random.rng);
  return {status: 'ready' as const, contentManifestHash: prepared.contentManifestHash,
    ...(prepared.catalogSelection ? {catalogSelection: prepared.catalogSelection} : {}),
    preparedCommand: command.request, randomValues: random.randomValues};
}
