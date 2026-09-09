import type {UncommittedRuleEvent, WorldState} from './domain';
import type {WorldObjectMutationEvent} from './worldObjects';

type EventInput=Omit<UncommittedRuleEvent,'ordinal'>;

/** Materialize the item removed by a resolved save, including resumed resolutions. */
export function heldItemDropWorldEvents(before:WorldState,after:WorldState,execution:readonly EventInput[],commandId:string):EventInput[]{
 return execution.flatMap((envelope,index)=>{
  const payload=envelope.payload;
  if(payload.type!=='EngineEventRecorded' || payload.event.type!=='world_interaction' || payload.event.operation!=='drop_held_item')return [];
  const {ownerActorId,cardId,hand}=payload.event.parameters;
  if(typeof ownerActorId!=='string' || typeof cardId!=='string' || (hand!=='main_hand'&&hand!=='off_hand'))throw new Error('Invalid held-item drop identity');
  const oldActor=before.actors[ownerActorId],newActor=after.actors[ownerActorId];
  const quantity=(actor:typeof oldActor)=>actor?.runtime.inventory.filter(row=>row.cardId===cardId&&row.containerId==null).reduce((sum,row)=>sum+row.qty,0)??0;
  if(!oldActor || !newActor || oldActor.runtime.equipment[hand]!==cardId || newActor.runtime.equipment[hand]!=null || quantity(oldActor)-quantity(newActor)!==1)throw new Error('Held-item drop must remove exactly one equipped item');
  const held=Object.values(before.objects).find(object=>object.heldByActorId===ownerActorId&&object.heldInHand===hand&&object.itemCardId===cardId);
  const card=oldActor.character.knownCards?.find(row=>row.id===cardId)??oldActor.character.equippedCards?.find(row=>row.id===cardId);
  const event:WorldObjectMutationEvent=held?{type:'WorldObjectPatched',objectId:held.id,patch:{unattended:true},unset:['heldByActorId','heldInHand','carriedByActorId'],reason:'held_item_dropped'}:
   {type:'WorldObjectCreated',object:{id:`${commandId}:dropped:${index}`,name:card?.name??cardId,kind:'item',size:card?.mechanics?.object_size==='tiny'?'tiny':'small',itemCardId:cardId,ownerActorId,unattended:true,tags:['held_item_dropped']}};
  return [{sourceActorId:envelope.sourceActorId,obligationIds:[...envelope.obligationIds,'system:held-item-drop'],payload:{type:'WorldObjectMutationRecorded' as const,event}}];
 });
}


/** Unheld copies are consumed first; remove held instances that no longer have inventory backing. */
export function consumedHeldItemWorldEvents(after: WorldState, execution: readonly EventInput[]): EventInput[] {
 const consumed = new Map<string, Set<string>>();
 for (const envelope of execution) {
  const payload = envelope.payload;
  if (payload.type !== 'EngineEventRecorded' || payload.event.type !== 'item_consumed' || payload.event.amount <= 0) continue;
  const actorId = envelope.sourceActorId;
  const cards = consumed.get(actorId) ?? new Set<string>(); cards.add(payload.event.cardId); consumed.set(actorId, cards);
 }
 const events: EventInput[] = [];
 for (const [actorId, cards] of consumed) {
  const actor = after.actors[actorId]; if (!actor) continue;
  const equipment = {...actor.runtime.equipment}; let changed = false;
  for (const cardId of cards) {
   const quantity = actor.runtime.inventory.filter(row => row.cardId === cardId && row.containerId == null).reduce((sum, row) => sum + row.qty, 0);
   const held = Object.values(after.objects).filter(object => object.heldByActorId === actorId && object.itemCardId === cardId).sort((a, b) => a.id.localeCompare(b.id));
   for (const object of held.slice(quantity)) {
    if (object.heldInHand && equipment[object.heldInHand] === cardId) {equipment[object.heldInHand] = null; changed = true;}
    events.push({sourceActorId: actorId, obligationIds: ['system:consumed-held-item'], payload: {type: 'WorldObjectMutationRecorded', event: {type: 'WorldObjectRemoved', objectId: object.id, reason: 'item_consumed'}}});
   }
  }
  if (changed) events.push({sourceActorId: actorId, obligationIds: ['system:consumed-held-item'], payload: {type: 'ActorRuntimePatched', actorId, reason: 'action', patch: {equipment}}});
 }
 return events;
}
