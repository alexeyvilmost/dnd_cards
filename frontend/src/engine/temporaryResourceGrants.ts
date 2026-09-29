import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {evaluate} from './formula';
function totals(state:RuntimeState,character?:CharacterContext):Record<string,number>{
 const values:Record<string,number>={};
 for(const entry of state.activeEffects){
  if(entry.roundsLeft!==undefined&&entry.roundsLeft<=0)continue;
  // Suppression suspends the effect, not its spent-resource ledger. Restoring
  // magic must never replenish a pool by removing and adding its capacity.
  for(const payload of payloadsOf(entry.suppressedMechanics??entry.mechanics)){
   if(payload.kind!=='resource'||payload.op!=='grant'||typeof payload.id!=='string'||!payload.id)continue;
   const amount=evaluate(String(payload.amount??1),{abilityMods:character?.abilityMods,profBonus:character?.profBonus,selfLevel:character?.level,classLevels:character?.classLevels,variables:character?.variables,rng:()=>{throw Error('Resource capacity must not roll');}});
   if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0)throw Error('Temporary resource grant must be a non-negative integer');
   values[payload.id]=(values[payload.id]??0)+amount;
  }
 }
 return values;
}
/** Apply a change in active grants, preserving spent resources and independent
 * class/item capacity. Repeated application of the same active set is a no-op. */
export function reconcileTemporaryResourceGrants(before:RuntimeState,after:RuntimeState,character?:CharacterContext):RuntimeState{
 const previous=totals(before,character),current=totals(after,character);
 const resources={...after.resources},maxResources={...after.maxResources};
 let changed=false;
 for(const key of new Set([...Object.keys(previous),...Object.keys(current)])){
  const delta=(current[key]??0)-(previous[key]??0);
  if(!delta)continue;
  maxResources[key]=Math.max(0,(after.maxResources[key]??0)+delta);
  resources[key]=Math.max(0,Math.min(maxResources[key],(after.resources[key]??0)+Math.max(0,delta)));
  changed=true;
 }
 return changed?{...after,resources,maxResources}:after;
}
