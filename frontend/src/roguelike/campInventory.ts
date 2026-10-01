import type {ForgeCharacter} from '../character/types';
import {forgeToRuntimeState,runtimeInventoryPayload,removeFromInventory,writeRulesEngineRuntimeTurnState} from '../character/runtime';
import {inventoryQty,unequipToInventory} from '../character/inventory';
import {readAttunedIds} from '../character/attunement';
import {projectSheetCanonicalPersistence,writeSheetCanonicalWorld} from '../character/sheetCanonicalWorld';
import {clearSheetCombatSession} from '../character/sheetCombatSession';
import {writeSoloCombatState} from '../solo-combat/persistence';
import {itemEquipmentChangeIssue} from '../engine/itemEquipmentPolicy';
import {prepareRoguelikeCombatParticipant,type FrozenCombatCatalog} from './combatCatalog';

export interface CampInventoryInput {
  character:ForgeCharacter;catalog:FrozenCombatCatalog;basicActionIds?:string[];
  placement?:{equipment:NonNullable<ForgeCharacter['equipment']>;inventoryItems:NonNullable<ForgeCharacter['inventory_items']>};
  sale?:{cardId:string;quantity:number};
}

/** A trade changes physical ownership. Resource/action grants are rebuilt by
 * the same assembler as the sheet; no client can declare a price or a pool. */
export async function projectRoguelikeCampInventory(input:CampInventoryInput) {
  if(input.sale&&input.placement)throw Error('Выберите одну операцию с предметами');
  const character=structuredClone(input.character);
  character.turn_state=clearSheetCombatSession(writeSoloCombatState(character.turn_state,null));
  const before=await prepareRoguelikeCombatParticipant(character,input.catalog,input.basicActionIds??[]);
  if(before.status!=='ready')return before;
  let candidate=structuredClone(character);
  if(input.placement){
    candidate.equipment=structuredClone(input.placement.equipment);
    candidate.inventory_items=structuredClone(input.placement.inventoryItems);
  }
  if(input.sale){
    const {cardId,quantity}=input.sale;
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)throw Error('Неверное количество предметов');
    let runtime=forgeToRuntimeState(candidate);
    if(runtime.inventory.some(row=>row.containerId===cardId))throw Error('Сначала освободите контейнер');
    // Consume carried copies first. An equipped physical copy becomes an
    // ordinary inventory copy through the canonical unequip operation.
    while(inventoryQty(runtime,cardId)<quantity){
      const slot=Object.keys(runtime.equipment).find(key=>runtime.equipment[key]===cardId);
      if(!slot)throw Error('Предмета нет в указанном количестве');
      runtime=unequipToInventory(runtime,slot);
    }
    runtime=removeFromInventory(runtime,cardId,quantity);
    const issue=itemEquipmentChangeIssue(forgeToRuntimeState(character),runtime,input.catalog.entities.card);
    if(issue)throw Error(issue);
    candidate.equipment=runtime.equipment;
    candidate.inventory_items=runtimeInventoryPayload(runtime);
    if(inventoryQty(runtime,cardId)===0&&!Object.values(runtime.equipment).includes(cardId)){
      candidate.turn_state={...candidate.turn_state,attuned_ids:readAttunedIds(candidate.turn_state).filter(id=>id!==cardId)};
    }
  }
  const after=await prepareRoguelikeCombatParticipant(candidate,input.catalog,input.basicActionIds??[]);
  if(after.status!=='ready')return after;
  const patchFor=(prepared:typeof before,owner:ForgeCharacter)=>{
    const {canonical}=prepared.participant;
    const projected=projectSheetCanonicalPersistence({runtime:canonical.world.actors[owner.id].runtime,
      currency:owner.currency,resourceBindings:canonical.resourceBindings});
    const runtime=projected.runtime;
    const turn=writeSheetCanonicalWorld(writeRulesEngineRuntimeTurnState(owner.turn_state,runtime),owner.id,
      canonical.world,canonical.resourceBindings);
    return {current_hp:runtime.hp.current,resources:runtime.resources,max_resources:runtime.maxResources,
      active_effects:runtime.activeEffects,inventory_items:runtimeInventoryPayload(runtime),equipment:runtime.equipment,
      turn_state:turn,runtime_revision:Number(owner.runtime_revision)+1};
  };
  return {status:'ready' as const,contentManifestHash:after.contentManifestHash,
    previousPatch:patchFor(before,character),patch:patchFor(after,candidate),events:[]};
}
