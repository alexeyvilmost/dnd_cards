import {conditionRule} from './legacy/engineAdapter';
import {deniedCapabilities} from './legacy/engineAdapter';
import type {ActiveEffectEntry} from '../mvp/contracts';
import type {ActorState,QueuedEventReaction,RuleActionDefinition,UncommittedRuleEvent,WorldState} from './domain';
type Dict=Record<string,unknown>;
export function isNegativeEffect(effect:ActiveEffectEntry):boolean {
 if(effect.mechanics.polarity==='negative')return true;
 if(effect.mechanics.polarity==='positive'||effect.mechanics.polarity==='neutral')return false;
 return effect.mechanics.kind==='condition'&&conditionRule(String(effect.mechanics.value))?.polarity==='negative';
}
/** Eligibility excludes exactly the new instance, never all current conditions.
 * Costs and other current state remain live. */
export function effectReactionActor(actor:ActorState|undefined,opportunity:QueuedEventReaction):ActorState|null {
 if(!actor)return null;
 if(opportunity.event.kind!=='effect_received')return actor;
 const data=opportunity.event.data,effect=actor.runtime.activeEffects.find(entry=>entry.id===data?.effectId);
 if(!effect||!isNegativeEffect(effect)||data?.negative!==true||data.reactionBeforeApplication!==true)return null;
 return {...actor,runtime:{...actor.runtime,activeEffects:actor.runtime.activeEffects.filter(entry=>entry!==effect)}};
}
export function bindReceivedEffectAction(action:RuleActionDefinition,opportunity:QueuedEventReaction):RuleActionDefinition|null {
 if(opportunity.event.kind!=='effect_received')return null;
 let found=false;
 const visit=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(visit);
  if(!value||typeof value!=='object')return value;
  const row=value as Dict;
  if(row.kind==='remove_effect'&&row.event_effect===true){found=true;const {event_effect:_,...rest}=row;return {...rest,instance_id:opportunity.event.data?.effectId};}
  return Object.fromEntries(Object.entries(row).map(([key,nested])=>[key,visit(nested)]));
 };
 const mechanics=visit(action.mechanics) as RuleActionDefinition['mechanics'];
 return found?{...action,mechanics}:null;
}
export function receivedEffectEvents(before:WorldState,after:WorldState):Array<Omit<UncommittedRuleEvent,'ordinal'>> {
 const events:Array<Omit<UncommittedRuleEvent,'ordinal'>>=[];
 for(const actor of Object.values(after.actors)){
  const prior=before.actors[actor.id];if(!prior)continue;
  const ids=new Set(prior.runtime.activeEffects.map(effect=>effect.id));
  for(const effect of actor.runtime.activeEffects){
   if(ids.has(effect.id)||!isNegativeEffect(effect))continue;
   events.push({sourceActorId:effect.sourceId??actor.id,obligationIds:['system:effect-received'],payload:{type:'EngineEventRecorded',actorId:actor.id,targetIds:[actor.id],event:{type:'domain_event',ownerActorId:actor.id,targetActorId:effect.sourceId,
    event:{kind:'effect_received',timing:'after',source:'self',data:{effectId:effect.id,negative:true,reactionBeforeApplication:!deniedCapabilities(prior.runtime,prior.passives??[]).has('reaction')}}}}});
  }
 }
 return events;
}
