import type {RuntimeState} from '../mvp/contracts';
type Dict=Record<string,unknown>;
export function sourceWeaponMechanics(mechanics:Dict,state:RuntimeState):Dict{
 const id=mechanics.weapon_source_id;if(id===undefined)return mechanics;
 if(typeof id!=='string'||!id)throw Error('Weapon source must have a stable identity');
 const hand=state.equipment.main_hand===id?'main':state.equipment.off_hand===id?'off':null;
 if(!hand)throw Error('The source weapon must be held to use this action');
 const walk=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(walk);
  if(!value||typeof value!=='object')return value;
  const row=value as Dict;const next=Object.fromEntries(Object.entries(row).map(([k,v])=>[k,walk(v)]));
  if(row.resolution==='attack_roll')next.tags=[...(Array.isArray(row.tags)?row.tags.filter(tag=>tag!=='off_hand'):[]),...(hand==='off'?['off_hand']:[])];
  return next;
 };
 return walk(mechanics) as Dict;
}
export function selectedResourcePool(state:RuntimeState,selection:unknown,recharge:Record<string,string>|undefined):string|undefined{
 if(!selection||typeof selection!=='object')throw Error('Resource pool selector must be an object');
 const rule=selection as Dict;
 if(typeof rule.prefix!=='string'||!rule.prefix||typeof rule.recharge!=='string'||rule.take!=='highest_level')throw Error('Invalid resource pool selector');
 return Object.keys(state.maxResources).filter(key=>key.startsWith(rule.prefix as string)&&state.maxResources[key]>0&&recharge?.[key]===rule.recharge)
  .map(key=>({key,level:Number(key.slice(String(rule.prefix).length))})).filter(row=>Number.isSafeInteger(row.level)&&row.level>=1)
  .sort((a,b)=>b.level-a.level)[0]?.key;
}
