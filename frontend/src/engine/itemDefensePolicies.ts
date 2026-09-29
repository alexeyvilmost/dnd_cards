import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {matchesWhen,activeConditionsOf} from './circumstances';
import {payloadsOf} from './mechanicsView';
type Dict=Record<string,unknown>;
function policies(state:RuntimeState,passives:readonly Dict[],character?:CharacterContext):Dict[]{
 return [...passives,...state.activeEffects.map(entry=>entry.mechanics)].flatMap(mechanics=>{
  const activation=mechanics.activation as Dict|undefined;
  if(activation?.mode!==undefined&&activation.mode!=='passive')return [];
  return payloadsOf(mechanics).filter(payload=>matchesWhen(payload.when as Dict[]|undefined,{state,character,activeConditions:activeConditionsOf(state)}));
 });
}
/** A save policy affects damage only: failed-save conditions still apply. */
export function saveDamagePolicy(state:RuntimeState,passives:readonly Dict[],ability:string,success:boolean,character?:CharacterContext):'none'|'half'|undefined{
 const values=policies(state,passives,character).filter(payload=>payload.kind==='save_damage_policy'
  &&(payload.abilities===undefined||(Array.isArray(payload.abilities)&&payload.abilities.includes(ability))))
  .map(payload=>payload[success?'on_success':'on_failure']);
 return values.includes('none')?'none':values.includes('half')?'half':undefined;
}
/** Voluntary movement remains available; this is queried only for external displacement. */
export function preventsForcedMovement(state:RuntimeState,passives:readonly Dict[],character?:CharacterContext):boolean{
 return policies(state,passives,character).some(payload=>payload.kind==='movement_policy'&&payload.forced_movement==='immune');
}
export function savePolicyPayloads(payloads:Dict[],policy:'none'|'half'|undefined):Dict[]{
 if(policy!=='none')return payloads;
 return payloads.flatMap(payload=>payload.kind==='damage'?[]:[payload]);
}

/** Slipping is a provenance-tagged cause; protection never blocks a shove. */
export function preventsSlip(state:RuntimeState,passives:readonly Dict[],payload:Dict,character?:CharacterContext):boolean{
 if(payload.kind!=='condition'||payload.value!=='prone')return false;
 const cause=payload.cause as Dict|undefined,tags=Array.isArray(cause?.tags)?cause.tags:Array.isArray(payload.cause_tags)?payload.cause_tags:[];
 if(!tags.includes('slip'))return false;
 return policies(state,passives,character).some(rule=>rule.kind==='movement_policy'&&(rule.slip_immune===true||Array.isArray(rule.slip_immune)&&rule.slip_immune.some(tag=>tags.includes(tag))));
}
