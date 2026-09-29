import type {ActorState,RuleActionDefinition,SpatialFacts} from './domain';
import type {EngineEvent} from '../mvp/contracts';

type Dict=Record<string,unknown>;
export function damageTransferSpec(action:RuleActionDefinition):{fraction:number;requiresLink?:string}|null{
  const raw=action.mechanics.damage_transfer as Dict|undefined;
  if(!raw||typeof raw.fraction!=='number'||raw.fraction<=0||raw.fraction>1)return null;
  return {fraction:raw.fraction,...typeof raw.requires_link==='string'?{requiresLink:raw.requires_link}:{}};
}
export function damageTransferEligible(owner:ActorState,target:ActorState,action:RuleActionDefinition,facts:SpatialFacts):boolean{
  const spec=damageTransferSpec(action);
  if(!spec||owner.id===target.id)return false;
  const trigger=(action.mechanics.activation as Dict|undefined)?.trigger as Dict|undefined;
  const observation=owner.character.spatialObservations?.nearby.find(row=>row.actorId===target.id);
  const distance=observation?.distanceFt??facts.damageObservers?.find(row=>row.actorId===owner.id)?.distanceFt;
  if(trigger?.observer_range_ft!==undefined&&(!Number.isFinite(distance)||distance!<0||distance!>Number(trigger.observer_range_ft)))return false;
  if(Array.isArray(trigger?.observer_relations)&&(!observation||!trigger.observer_relations.includes(observation.relation)))return false;
  if(trigger?.requires_visibility===true&&!facts.damageObservers?.some(row=>row.actorId===owner.id&&row.canSeeTarget))return false;
  return !spec.requiresLink||target.runtime.activeEffects.some(effect=>effect.sourceId===owner.id
    &&effect.mechanics.kind==='damage_transfer_link'&&effect.mechanics.key===spec.requiresLink);
}
/** The shared portion is taken from damage actually destined for the protected
 * creature. Its recipient then applies its own defenses to that new packet. */
export function transferDamageEvents(events:readonly EngineEvent[],fraction:number,sourceActorId:string,targetActorId:string,source:string):{events:EngineEvent[];transferred:EngineEvent[];amount:number}{
  const transferred:EngineEvent[]=[];let amount=0;
  const adjusted=events.map(event=>{
    if(event.type!=='damage')return event;
    const moved=Math.floor(event.amount*fraction),remaining=event.amount-moved;
    amount+=remaining;
    if(moved)transferred.push({type:'area_damage',amount:moved,damageType:event.damageType,sourceActorId,targetIds:[targetActorId],source,damageSourceKind:'item',transferred:true});
    return {...event,amount:remaining,...event.calculation?{calculation:{...event.calculation,transferredDamage:(event.calculation.transferredDamage??0)+moved}}:{}};
  });
  return {events:adjusted,transferred,amount};
}
