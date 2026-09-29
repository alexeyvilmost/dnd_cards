import type {Card} from '../types';
import type {RuntimeState,CharacterContext} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {parseWeaponProfile} from './weaponProfile';
import {collectItemMechanics} from '../character/attunement';
type Dict=Record<string,unknown>;
const object=(value:unknown):value is Dict=>!!value&&typeof value==='object'&&!Array.isArray(value);
function capabilities(passives:readonly unknown[],kind:string):Dict[]{
 return passives.filter(object).flatMap(mechanics=>{
  const activation=object(mechanics.activation)?mechanics.activation:{};
  return activation.mode!==undefined&&activation.mode!=='passive'?[]:payloadsOf(mechanics).filter(payload=>payload.kind===kind);
 });
}
export function hasRitualCasting(passives:readonly unknown[]):boolean{
 return capabilities(passives,'ritual_casting').length>0;
}
/** Changes required hands, without removing the weapon property or claiming
 * that a one-handed attack is actually wielded in two hands. */
export function allowsOneHandedHeavyWeapon(card:Card,equipment:Record<string,string|null|undefined>,cards:ReadonlyMap<string,Card>,passives:readonly unknown[]):boolean{
 const parsed=parseWeaponProfile(card);
 if(!parsed.valid||!parsed.profile.properties.includes('two_handed'))return false;
 const held=[...new Set([equipment.main_hand,equipment.off_hand].filter((id):id is string=>typeof id==='string'))];
 const twoHandedCount=held.filter(id=>{const c=cards.get(id);if(!c)return false;const p=parseWeaponProfile(c);return p.valid&&p.profile.properties.includes('two_handed');}).length;
 return capabilities(passives,'weapon_handling').some(payload=>payload.required_hands===1&&Number.isSafeInteger(payload.max_weapons)&&Number(payload.max_weapons)>=twoHandedCount);
}
export function weaponHandlingPassives(character:CharacterContext,state:RuntimeState|undefined,provided:readonly unknown[]):unknown[]{
 if(!state)return [...provided];
 const cards=new Map([...(character.knownCards??[]),...(character.equippedCards??[])].map(card=>[card.id,card]));
 return [...provided,...collectItemMechanics(state.equipment,cards,{attuned_ids:character.attunedIds??[]},state.inventory).map(entry=>entry.mechanics),...state.activeEffects.map(entry=>entry.mechanics)];
}
/** Apply once to source mechanics while projecting actions for UI/authority. */
export function applyItemActionTargetLimit(mechanics:Dict,actionRefs:readonly string[],passives:readonly unknown[],isSpell=false,spellLevel?:number):Dict{
 const targeting=object(mechanics.targeting)?mechanics.targeting:null;
 if(!targeting||typeof targeting.max_targets!=='number'||!Number.isInteger(targeting.max_targets))return mechanics;
 const containsHealing=(value:unknown):boolean=>Array.isArray(value)?value.some(containsHealing):object(value)?value.kind==='healing'||Object.values(value).some(containsHealing):false;
 const matched=capabilities(passives,'action_target_limit').filter(payload=>{
  const constrained=payload.action_refs!==undefined||payload.healing_spells!==undefined||payload.spell_level!==undefined;
  if(!constrained)return false;
  if(payload.action_refs!==undefined&&(!Array.isArray(payload.action_refs)||!payload.action_refs.some(ref=>typeof ref==='string'&&actionRefs.includes(ref))))return false;
  if(payload.healing_spells!==undefined&&(payload.healing_spells!==true||!isSpell||!containsHealing(mechanics.effects)))return false;
  if(payload.spell_level!==undefined&&(!isSpell||!Number.isSafeInteger(payload.spell_level)||payload.spell_level!==spellLevel))return false;
  return true;
 });
 if(!matched.length)return mechanics;
 const bonus=matched.reduce((sum,payload)=>{if(!Number.isSafeInteger(payload.add)||Number(payload.add)<0)throw new Error('Action target bonus must be a non-negative integer');return sum+Number(payload.add);},0);
 const maximum=targeting.max_targets+bonus;
 if(!Number.isSafeInteger(maximum)||maximum>64)throw new Error('Action target count exceeds engine limit');
 if(maximum===targeting.max_targets)return mechanics;
 return {...mechanics,targeting:{...targeting,max_targets:maximum,...(maximum>1&&targeting.shape==='single'?{shape:'multi'}:{})}};
}
