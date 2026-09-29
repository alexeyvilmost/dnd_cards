import type {ActorState,UncommittedRuleEvent,WorldState} from './domain';
import type {WorldObjectState} from './worldObjects';
import {parseWeaponProfile} from './weaponProfile';
import {payloadsOf} from '../engine/mechanicsView';
import {matchesWhen} from '../engine/circumstances';
import {itemEquipmentChangeIssue} from '../engine/itemEquipmentPolicy';

type Dict=Record<string,unknown>;
type EventInput=Omit<UncommittedRuleEvent,'ordinal'>;

/** An activation can deploy a carried physical item even when it uses a save
 * rather than an attack roll. Destruction refers to the saved deployed instance. */
export function deployedItemEvents(before:WorldState,after:WorldState,execution:readonly EventInput[],commandId:string):EventInput[]{
 const events:EventInput[]=[];const used=new Set<string>();
 for(const [index,envelope] of execution.entries()){
  const p=envelope.payload;if(p.type!=='EngineEventRecorded'||p.event.type!=='world_interaction')continue;
  const {operation,parameters}=p.event;if(!['deploy_item','destroy_deployed_item','release_deployed_item'].includes(operation))continue;
  const actor=after.actors[p.actorId],original=before.actors[p.actorId],cardId=parameters.card_id;
  if(!actor||!original||typeof cardId!=='string')throw Error('Deployment needs a canonical actor and item');
  const common={sourceActorId:p.actorId,obligationIds:['system:item-deployment']};
  if(operation==='destroy_deployed_item'||operation==='release_deployed_item'){
   const effect=original.runtime.activeEffects.find(entry=>entry.entityRef?.cardNumber===parameters.source_effect_ref);
   const object=Object.values(before.objects).find(row=>row.itemCardId===cardId&&row.deployedToActorId===actor.id&&(!effect?.sourceId||row.ownerActorId===effect.sourceId)&&!used.has(row.id));
   if(!object)throw Error('The deployed item is no longer present');used.add(object.id);
   events.push({...common,payload:{type:'WorldObjectMutationRecorded',event:operation==='destroy_deployed_item'
     ?{type:'WorldObjectRemoved',objectId:object.id,reason:'deployed_item_destroyed'}
     :{type:'WorldObjectPatched',objectId:object.id,patch:{unattended:true},unset:['deployedToActorId'],reason:'deployed_item_released'}}});continue;
  }
  const at=parameters.at;if(at!=='self'&&at!=='target')throw Error('Unknown deployment location');
  const targetId=at==='self'?actor.id:p.targetIds.find(id=>id!==actor.id);
  if(!targetId||!after.actors[targetId])throw Error('Deployment requires one actual recipient');
  const card=actor.character.knownCards?.find(row=>row.id===cardId);if(!card)throw Error('Unknown deployment item');
  const key=`${actor.id}:${cardId}`;if(used.has(key))throw Error('The same item cannot be deployed twice');used.add(key);
  const hand=(['main_hand','off_hand'] as const).find(slot=>actor.runtime.equipment[slot]===cardId);
  const equipment={...actor.runtime.equipment},inventory=actor.runtime.inventory.map(row=>({...row}));
  if(hand){for(const slot of Object.keys(equipment))if(equipment[slot]===cardId)equipment[slot]=null;}
  else{const row=inventory.find(row=>row.cardId===cardId&&!row.containerId&&row.qty>0);if(!row)throw Error('Deployment item is not carried');row.qty--;}
  const issue=itemEquipmentChangeIssue(actor.runtime,{equipment},actor.character.knownCards??[]);if(issue)throw Error(issue);
  const held=hand?Object.values(before.objects).find(row=>row.heldByActorId===actor.id&&row.heldInHand===hand&&row.itemCardId===cardId):undefined;
  const objectId=held?.id??`${commandId}:deployed:${index}`;
  events.push({...common,payload:{type:'ActorRuntimePatched',actorId:actor.id,reason:'action',patch:{equipment,inventory:inventory.filter(row=>row.qty>0)}}});
  events.push({...common,payload:{type:'WorldObjectMutationRecorded',event:held?
   {type:'WorldObjectPatched',objectId,patch:{deployedToActorId:targetId,unattended:true},unset:['heldByActorId','heldInHand','carriedByActorId'],reason:'item_deployed'}:
   {type:'WorldObjectCreated',object:{id:objectId,name:card.name,kind:'item',size:'small',itemCardId:cardId,ownerActorId:actor.id,deployedToActorId:targetId,planeId:actor.planeId??'material',unattended:true}}}});
  events.push({...common,payload:{type:'EngineEventRecorded',actorId:actor.id,targetIds:[targetId],event:{type:'world_interaction',operation:'deployed_item_position',parameters:{objectId,targetActorId:targetId}}}});
 }
 return events;
}
export function inherentWeaponBondRef(actor:ActorState,cardId:string):string|undefined {
 const card=actor.character.knownCards?.find(row=>row.id===cardId)??actor.character.equippedCards?.find(row=>row.id===cardId);
 const policy=card?.mechanics?.weapon_bond as Dict|undefined;
 return card?.type==='weapon'&&policy?.inherent===true&&typeof policy.recall_action_ref==='string'&&policy.recall_action_ref.trim()?policy.recall_action_ref:undefined;
}
/** Only a fresh world/bootstrap or a newly acquired physical item gets a bond;
 * existing persisted world objects keep their identity and current custodian. */
export function inherentWeaponBondObjects(actors:Record<string,ActorState>,existing:Record<string,WorldObjectState>):WorldObjectState[]{
 const created:WorldObjectState[]=[];
 for(const actor of Object.values(actors))for(const card of actor.character.knownCards??[]){
  const ref=inherentWeaponBondRef(actor,card.id);if(!ref)continue;
  const hand=(['main_hand','off_hand'] as const).find(slot=>actor.runtime.equipment[slot]===card.id);
  if(!hand&&!actor.runtime.inventory.some(row=>row.cardId===card.id&&row.containerId==null&&row.qty>0))continue;
  if([...Object.values(existing),...created].some(object=>object.itemCardId===card.id&&(object.weaponBondActorId===actor.id||object.carriedByActorId===actor.id)))continue;
  created.push({id:`${actor.id}:item-bond:${card.id}`,name:card.name,kind:'item',size:'small',itemCardId:card.id,ownerActorId:actor.id,weaponBondActorId:actor.id,
   carriedByActorId:actor.id,planeId:actor.planeId??'material',unattended:false,grantedActionRefs:[ref],grantsToOwner:true,...hand?{heldByActorId:actor.id,heldInHand:hand}:{}});
 }
 return created;
}
export function inherentWeaponBondEvents(world:WorldState):EventInput[]{return inherentWeaponBondObjects(world.actors,world.objects).map(object=>({sourceActorId:object.ownerActorId!,obligationIds:['system:item-weapon-bond'],payload:{type:'WorldObjectMutationRecorded',event:{type:'WorldObjectCreated',object}}}));}
/** Final attack events, never held previews, transfer one actual thrown weapon.
 * The returning policy leaves that same instance in the thrower's original hand. */
export function thrownWeaponEvents(before:WorldState,after:WorldState,execution:readonly EventInput[],commandId:string):EventInput[]{
 const events:EventInput[]=[];const handled=new Set<string>();
 for(const envelope of execution){
  const p=envelope.payload;if(p.type!=='EngineEventRecorded'||p.event.type!=='domain_event'||p.event.event.kind!=='attack_roll_made')continue;
  const data=p.event.event.data,cardId=data?.weaponId;if(typeof cardId!=='string'||(data?.attackKind!=='weapon'||data?.attackRange!=='ranged'))continue;
  const actor=before.actors[p.actorId],current=after.actors[p.actorId];if(!actor||!current)continue;
  const card=actor.character.knownCards?.find(row=>row.id===cardId)??actor.character.equippedCards?.find(row=>row.id===cardId);if(!card)continue;
  const profile=parseWeaponProfile(card);if(!profile.valid||!profile.profile.properties.includes('thrown'))continue;
  const hand=(['main_hand','off_hand'] as const).find(slot=>actor.runtime.equipment[slot]===cardId);if(!hand)throw Error('Thrown weapon is not held');
  const key=`${actor.id}:${hand}`;if(handled.has(key))throw Error('A physical weapon cannot be thrown twice in one attack');handled.add(key);
  const object=Object.values(before.objects).find(row=>row.heldByActorId===actor.id&&row.heldInHand===hand&&row.itemCardId===cardId);
  const objectId=object?.id??`${commandId}:thrown:${actor.id}:${hand}`;
  const returning=[...actor.passives??[],...actor.runtime.activeEffects.filter(row=>row.roundsLeft===undefined||row.roundsLeft>0).map(row=>row.mechanics)].flatMap(payloadsOf)
   .some(rule=>rule.kind==='weapon_return'&&(rule.weapon_id===cardId||rule.any_thrown_weapon===true)&&rule.after_throw===true&&matchesWhen(rule.when as Dict[]|undefined,{state:actor.runtime,character:actor.character}));
  const common={sourceActorId:actor.id,obligationIds:['system:physical-thrown-weapon']};
  const keepsHand=returning&&current.runtime.equipment[hand]===cardId;
  if(!object)events.push({...common,payload:{type:'WorldObjectMutationRecorded',event:{type:'WorldObjectCreated',object:{id:objectId,name:card.name,kind:'item',size:'small',itemCardId:cardId,ownerActorId:actor.id,planeId:actor.planeId??'material',unattended:!keepsHand,...keepsHand?{carriedByActorId:actor.id,heldByActorId:actor.id,heldInHand:hand}:{}}}}});
  else events.push({...common,payload:{type:'WorldObjectMutationRecorded',event:{type:'WorldObjectPatched',objectId,patch:{unattended:!keepsHand},...keepsHand?{}:{unset:['heldByActorId','heldInHand','carriedByActorId']},reason:keepsHand?'weapon_returned':'weapon_thrown'}}});
  if(!keepsHand)events.push({...common,payload:{type:'ActorRuntimePatched',actorId:actor.id,reason:'action',patch:{equipment:{...current.runtime.equipment,[hand]:null}}}});
  events.push({...common,payload:{type:'EngineEventRecorded',actorId:actor.id,targetIds:[],event:{type:'world_interaction',operation:'thrown_weapon',parameters:{objectId,returned:keepsHand,targetActorId:data.targetActorId}}}});
 }
 return events;
}
