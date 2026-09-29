import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen} from './circumstances';
import {itemGate} from '../character/attunement';
import {costKey} from './cost';
type Dict=Record<string,unknown>;
const slotLevel=(key:string)=>Number(/^(?:spell_slot|pact_slot|warlock_spell_slot)_(\d+)$/.exec(key)?.[1]??0);
export function restrictedResourceKeys(state:RuntimeState,character?:CharacterContext,passives:readonly Dict[]=[]):Set<string>{
 const policies=[...passives,...state.activeEffects.filter(row=>row.roundsLeft===undefined||row.roundsLeft>0).map(row=>row.mechanics),
  ...(character?.knownCards??[]).filter(card=>itemGate(card,{inventory:state.inventory,equipment:state.equipment,attuned:character?.attunedIds??[]})).flatMap(card=>card.mechanics?[card.mechanics]:[])]
  .flatMap(payloadsOf).filter(row=>row.kind==='resource_restriction'&&matchesWhen(row.when as Dict[]|undefined,{state,character}));
 const slots=Object.entries(state.maxResources).filter(([key,max])=>slotLevel(key)>0&&max>0).map(([key])=>key);
 const highest=Math.max(0,...slots.map(slotLevel)),blocked=new Set<string>();
 for(const policy of policies){
  if(policy.spell_slots!=='highest'&&(!Array.isArray(policy.spell_slots)||!policy.spell_slots.every(value=>Number.isInteger(value)&&Number(value)>0&&Number(value)<=9)))throw Error('Invalid spell slot restriction');
  for(const key of slots)if(policy.spell_slots==='highest'?slotLevel(key)===highest:(policy.spell_slots as number[]).includes(slotLevel(key)))blocked.add(key);
 }
 return blocked;
}
export function resourceRestrictionIssue(state:RuntimeState,cost:readonly Dict[],character?:CharacterContext,passives:readonly Dict[]=[]):string|null{
 const blocked=restrictedResourceKeys(state,character,passives);
 return cost.some(row=>Number(row.amount??1)>0&&blocked.has(costKey(row)))?'Действующее правило лишает этих ячеек заклинаний':null;
}
/** A view only. Retained counts are not destroyed when a source appears or leaves. */
export function availableResources(state:RuntimeState,character?:CharacterContext,passives:readonly Dict[]=[]):Record<string,number>{
 return {...state.resources,...Object.fromEntries([...restrictedResourceKeys(state,character,passives)].map(key=>[key,0]))};
}
