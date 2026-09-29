import type {Card} from '../types';
import type {ExecuteContext,ExecuteResult,RuntimeState} from '../mvp/contracts';
import {parseWeaponProfile} from './weaponProfile';
type Dict=Record<string,unknown>;
export function weaponFormIssue(state:RuntimeState,payload:Dict):string|null{
 const id=payload.item_id;if(typeof id!=='string'||!id)return 'Weapon form requires item identity';
 if(!Object.values(state.equipment).includes(id)&&!state.inventory.some(row=>row.cardId===id&&!row.containerId&&row.qty>0))return 'Weapon form source is not carried';
 const parsed=parseWeaponProfile({id,mechanics:{weapon_profile:payload.profile}});if(!parsed.valid)return parsed.issue;
 if(state.firedThisTurn?.includes(`weapon-form:${id}`))return 'Форму оружия можно менять только один раз за ход';
 const hand=state.equipment.main_hand===id?'main_hand':state.equipment.off_hand===id?'off_hand':undefined;
 if(hand&&parsed.profile.properties.includes('two_handed')&&Object.entries(state.equipment).some(([slot,value])=>['main_hand','off_hand'].includes(slot)&&value&&value!==id))return 'Для этой формы нужны обе свободные руки';
 return null;
}
export function applyWeaponForm(state:RuntimeState,payload:Dict,ctx:ExecuteContext):ExecuteResult{
 const issue=weaponFormIssue(state,payload);if(issue)throw Error(issue);
 const id=String(payload.item_id),parsed=parseWeaponProfile({id,mechanics:{weapon_profile:payload.profile}});if(!parsed.valid)throw Error(parsed.issue);
 const equipment={...state.equipment};
 if(equipment.main_hand===id||equipment.off_hand===id){
  if(parsed.profile.properties.includes('two_handed')){equipment.main_hand=id;equipment.off_hand=id;}
  else if(equipment.main_hand===id&&equipment.off_hand===id)equipment.off_hand=null;
 }
 const name=String(payload.name??'Форма оружия'),activeEffects=state.activeEffects.filter(entry=>!(entry.mechanics.kind==='weapon_form'&&entry.mechanics.item_id===id));
 activeEffects.push({id:ctx.nextId?.()??`weapon-form:${id}`,name,source:name,sourceId:ctx.selfId,ownerId:ctx.selfId,
  mechanics:{...payload,kind:'weapon_form',duration:{type:'until_removed'},stack_id:`weapon-form:${id}`}});
 return {state:{...state,equipment,activeEffects,firedThisTurn:[...state.firedThisTurn??[],`weapon-form:${id}`]},events:[{type:'effect_applied',name}]};
}
/** Base cards are restored before every projection, including JSON reloads. */
export function projectWeaponFormCards(cards:readonly Card[]|undefined,state:RuntimeState):Card[]|undefined{
 return cards?.map(input=>{
  const saved=input.mechanics?.runtime_weapon_form_base as Card|undefined;
  const card=saved??input;
  const entry=[...state.activeEffects].reverse().find(e=>e.mechanics.kind==='weapon_form'&&e.mechanics.item_id===card.id&&(e.roundsLeft===undefined||e.roundsLeft>0));
  if(!entry)return card;
  const profile=entry.mechanics.profile as Dict,parsed=parseWeaponProfile({id:card.id,mechanics:{weapon_profile:profile}});if(!parsed.valid)throw Error(parsed.issue);
  return {...card,type:'weapon' as const,slot:parsed.profile.properties.includes('two_handed')?'two_hands' as const:'one_hand' as const,weapon_type:parsed.profile.weaponType,
   mechanics:{...card.mechanics,weapon_profile:profile,weapon_mastery_granted:entry.mechanics.grants_mastery===true,runtime_weapon_form_base:card}};
 });
}
