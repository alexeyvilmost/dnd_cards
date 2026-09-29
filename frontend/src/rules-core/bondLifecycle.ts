import type {WorldState} from './domain';
import {itemSourceRequirementIssue} from '../engine/actionRequirements';
type Dict=Record<string,unknown>;

/** A bond is one actual effect instance, so ending it removes its modifiers,
 * resistance and echo together. Recasting on either endpoint replaces it. */
export function endedBondEffects(world:WorldState,before?:WorldState):Map<string,Set<string>>{
 const entries=Object.values(world.actors).flatMap(owner=>owner.runtime.activeEffects.flatMap(effect=>{
  const policy=effect.mechanics.bond_policy as Dict|undefined;
  return policy&&effect.sourceId&&typeof policy.group==='string'?[{owner,effect,policy,source:world.actors[effect.sourceId]}]:[];
 }));
 const removed=new Map<string,Set<string>>();
 const remove=(owner:string,id:string)=>{const ids=removed.get(owner)??new Set<string>();ids.add(id);removed.set(owner,ids);};
 for(const entry of entries){
  const {owner,effect,policy,source}=entry;
  if(!source||policy.end_on_source_zero_hp===true&&source.runtime.hp.current===0){remove(owner.id,effect.id);continue;}
  if(typeof policy.source_item_id==='string'&&itemSourceRequirementIssue({requires_item_source:policy.source_item_id},source.runtime,source.character)
   ||typeof policy.target_item_id==='string'&&itemSourceRequirementIssue({requires_item_source:policy.target_item_id},owner.runtime,owner.character))remove(owner.id,effect.id);
  const observed=source.character.spatialObservations?.nearby.find(row=>row.actorId===owner.id);
  if(typeof policy.max_source_distance_ft==='number'&&observed&&observed.distanceFt>policy.max_source_distance_ft)remove(owner.id,effect.id);
  if(before&&policy.exclusive_on_either===true&&!before.actors[owner.id]?.runtime.activeEffects.some(old=>old.id===effect.id)){
   const endpoints=[owner.id,source.id];
   for(const old of entries){
    if(old.effect.id===effect.id||old.policy.group!==policy.group
      ||!before.actors[old.owner.id]?.runtime.activeEffects.some(candidate=>candidate.id===old.effect.id))continue;
    if(endpoints.includes(old.owner.id)||endpoints.includes(old.effect.sourceId!))remove(old.owner.id,old.effect.id);
   }
  }
 }
 return removed;
}
