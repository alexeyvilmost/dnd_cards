// Benchmark adapter to the exact existing assembler and command executor.
// No mechanics, resources or costs are reconstructed in the runner.
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from '../../frontend/src/roguelike/combatCatalog';
import {prepareSheetEquipmentCommand} from '../../frontend/src/character/sheetEquipmentCommand';
import type {ForgeCharacter} from '../../frontend/src/character/types';
export async function prepareEquipment(character:ForgeCharacter,catalog:FrozenCombatCatalog,commandId:string,operation:{equip:string}|{unequip:string}) {
  const prepared=await prepareRoguelikeCombatParticipant(character,catalog,[]);
  if(prepared.status!=='ready')return prepared;
  return {status:'ready' as const,contentManifestHash:prepared.contentManifestHash,
    request:prepareSheetEquipmentCommand(prepared.participant,commandId,operation,()=>{throw Error('Fixture equipment must not consume RNG');}).request};
}
