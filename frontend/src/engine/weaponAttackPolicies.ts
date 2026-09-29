import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {activeConditionsOf,matchesWhen} from './circumstances';
type Dict=Record<string,unknown>;
/** Rules are carried by the equipped source, and must match the weapon actually rolled. */
export function weaponAttackPolicy(state:RuntimeState,passives:readonly Dict[],weaponId:string|undefined,character:CharacterContext):{movementCostFt:number;halfDamageOnMiss:boolean;separateD20Modes:string[];additionalAttacks:number;disabled:boolean}{
 const matched=[...passives,...state.activeEffects.filter(entry=>entry.roundsLeft===undefined||entry.roundsLeft>0).map(entry=>entry.mechanics)]
  .filter(mechanics=>!(mechanics.activation as Dict|undefined)?.mode||(mechanics.activation as Dict).mode==='passive')
  .flatMap(payloadsOf).filter(p=>p.kind==='weapon_attack_policy'&&typeof p.weapon_id==='string'&&p.weapon_id===weaponId
   &&matchesWhen(p.when as Dict[]|undefined,{state,character,activeConditions:activeConditionsOf(state)}));
 let movementCostFt=0;
 for(const rule of matched){
  if(rule.movement_cost_ft===undefined)continue;
  if(!Number.isSafeInteger(rule.movement_cost_ft)||Number(rule.movement_cost_ft)<0)throw new Error('Invalid weapon attack movement cost');
  movementCostFt+=Number(rule.movement_cost_ft);
 }
 const separateD20Modes=[...new Set(matched.flatMap(rule=>{
  if(rule.separate_d20_modes===undefined)return [];
  if(!Array.isArray(rule.separate_d20_modes)||rule.separate_d20_modes.some(mode=>!['advantage','disadvantage'].includes(String(mode))))throw new Error('Invalid separate d20 modes');
  return rule.separate_d20_modes.map(String);
 }))];
 let additionalAttacks=0;
 for(const rule of matched){if(rule.additional_attacks===undefined)continue;if(!Number.isSafeInteger(rule.additional_attacks)||Number(rule.additional_attacks)<0||Number(rule.additional_attacks)>8)throw Error('Invalid additional attack count');additionalAttacks+=Number(rule.additional_attacks);}
 return {disabled:matched.some(rule=>rule.disabled===true),additionalAttacks,movementCostFt,halfDamageOnMiss:matched.some(rule=>rule.miss_damage==='half'),separateD20Modes};
}
