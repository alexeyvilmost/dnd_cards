import type {WorldState,EngineEventRecordedEvent} from './domain';

export function beginCombatHistory(world:WorldState):WorldState{
 return {...world,combatHistorySequence:0,actors:Object.fromEntries(Object.values(world.actors).map(actor=>[actor.id,
  {...actor,character:{...actor.character,combatHistory:{damageDealt:0,turnEnded:0}}}]))};
}
/** Final damage events are emitted after all damage reactions and mitigation.
 * Keeping these observations in events makes a pending/reloaded attack use
 * the same history. Archives without this ledger retain their old projection. */
export function recordCombatHistory(world:WorldState,event:EngineEventRecordedEvent):WorldState{
 if(world.combatHistorySequence===undefined)return world;
 const value=event.event;
 const damage=value.type==='domain_event'&&value.event.kind==='damage_dealt'&&Number(value.event.data?.amount)>0;
 const turn=value.type==='turn_ended';if(!damage&&!turn)return world;
 const id=damage&&value.type==='domain_event'?value.ownerActorId:event.actorId;
 const actor=world.actors[id];if(!actor)return world;
 const sequence=world.combatHistorySequence+1;
 return {...world,combatHistorySequence:sequence,actors:{...world.actors,[id]:{...actor,character:{...actor.character,
  combatHistory:damage?{damageDealt:sequence,turnEnded:actor.character.combatHistory?.turnEnded??0}
   :{damageDealt:actor.character.combatHistory?.damageDealt??0,turnEnded:sequence}}}}};
}
