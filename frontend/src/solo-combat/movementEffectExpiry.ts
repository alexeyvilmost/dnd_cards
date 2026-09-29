import {expireEffectsForTrigger} from '../engine/execute';
import type {EngineEvent} from '../mvp/contracts';
import type {UncommittedRuleEvent} from '../rules-core/domain';
import type {SoloCombatState} from './types';
/** A committed coordinate change, including forced movement and teleport,
 * expires only instances that existed before this movement. */
export function movementEffectExpiryEvents(before:SoloCombatState,after:SoloCombatState):UncommittedRuleEvent[]{
 const events:Omit<UncommittedRuleEvent,'ordinal'>[]=[];
 for(const [actorId,token] of Object.entries(after.tokens)){
  const old=before.tokens[actorId]?.position;if(!old||old.x===token.position.x&&old.y===token.position.y)continue;
  const actor=after.world.actors[actorId],oldIds=new Set(before.world.actors[actorId]?.runtime.activeEffects.map(e=>e.id)??[]);if(!actor)continue;
  const engineEvents:EngineEvent[]=[];
  const current=actor.runtime;
  const expired=expireEffectsForTrigger({...current,activeEffects:current.activeEffects.filter(e=>oldIds.has(e.id))},'actor_moves',engineEvents);
  if(!engineEvents.length)continue;
  const retained=new Set(expired.activeEffects.map(e=>e.id));
  events.push({sourceActorId:actorId,obligationIds:['system:movement-effect-expiry'],payload:{type:'ActorRuntimePatched',actorId,reason:'action',patch:{activeEffects:current.activeEffects.filter(e=>!oldIds.has(e.id)||retained.has(e.id))}}});
  events.push(...engineEvents.map(event=>({sourceActorId:actorId,obligationIds:['system:movement-effect-expiry'],payload:{type:'EngineEventRecorded' as const,actorId,targetIds:[actorId],event}})));
 }
 return events.map((event,ordinal)=>({...event,ordinal}));
}
