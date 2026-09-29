import type {RuleActionDefinition,WorldState} from './domain';
import type {WorldObjectState} from './worldObjects';

/** An item converted into a concrete scene instance keeps only its explicitly
 * declared actions. Ownership alone never reactivates all item passives. */
export function worldItemActionSource(world:Pick<WorldState,'objects'>,actorId:string,action:Pick<RuleActionDefinition,'id'|'sourceEntityIds'|'mechanics'>):WorldObjectState|undefined {
  const source=action.mechanics.requires_item_source;
  if(typeof source!=='string')return undefined;
  const primitive=action.mechanics.primitive as Record<string,unknown>|undefined;
  const operation=(primitive?.policy as Record<string,unknown>|undefined)?.operation;
  return Object.values(world.objects).filter(object=>object.itemCardId===source&&!object.containedByObjectId
    &&(object.carriedByActorId===actorId||object.heldByActorId===actorId||(object.grantsToOwner===true&&object.ownerActorId===actorId)
      ||(operation==='portable_enter'&&object.portableSpace?.open===true&&!!object.portableSpace.entryActionRef
        &&(object.portableSpace.entryActionRef===action.id||action.sourceEntityIds.includes(object.portableSpace.entryActionRef)))
      ||(['portable_store','portable_retrieve'].includes(String(operation))&&object.portableSpace?.open===true)
      ||(operation==='portable_exit'&&object.portableSpace?.occupantActorIds.includes(actorId)&&!!object.portableSpace.exitActionRef
        &&(object.portableSpace.exitActionRef===action.id||action.sourceEntityIds.includes(object.portableSpace.exitActionRef))))
    &&object.grantedActionRefs?.some(ref=>ref===action.id||action.sourceEntityIds.includes(ref)))
    .sort((a,b)=>a.id.localeCompare(b.id))[0];
}

export function bindWorldItemAction<T extends Pick<RuleActionDefinition,'id'|'sourceEntityIds'|'mechanics'>>(world:Pick<WorldState,'objects'>,actorId:string,action:T):T {
  if(!worldItemActionSource(world,actorId,action))return action;
  const mechanics={...action.mechanics};
  delete mechanics.requires_item_source;
  if(mechanics.world_item_reuse===true){
    const activation=mechanics.activation as Record<string,unknown>|undefined;
    const costs=Array.isArray(activation?.cost)?activation.cost as Record<string,unknown>[]:[];
    mechanics.activation={...(activation??{}),cost:costs.filter(cost=>!(cost.resource==='item'&&cost.card_id===action.mechanics.requires_item_source))};
  }
  return {...action,mechanics};
}
