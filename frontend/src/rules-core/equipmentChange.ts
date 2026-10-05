import type {ActorState,DeterministicEnvironment} from './domain';
import {equipCardSwapping,unequipToInventory} from '../character/inventory';
import {collectItemMechanics} from '../character/attunement';
import {itemEquipmentChangeIssue} from './legacy/engineAdapter';
import {emitEvent} from './legacy/engineAdapter';
import type {EngineEvent} from '../mvp/contracts';
import {payloadsOf} from '../rules-primitives/mechanicsView';
import {projectRuntimeCharacter,reconcileEquipmentResourceGrants} from './legacy/engineAdapter';

/** The requested operation carries identity only; inventory, slots and effects
 * are recomputed from the same immutable cards used by ordinary equipment UI. */
export function changeEquipment(actor:ActorState,operation:{equip:string}|{unequip:string},env:DeterministicEnvironment){
 actor={...actor,character:projectRuntimeCharacter(actor.character,actor.runtime,actor.passives??[])};
 const cards=actor.character.knownCards??actor.character.equippedCards??[];
 const changedId='equip'in operation?operation.equip:actor.runtime.equipment[operation.unequip];
 const policyCard=cards.find(row=>row.id===changedId);
 const seconds=payloadsOf(policyCard?.mechanics??{}).filter(p=>p.kind==='equipment_policy'&&p.change_duration_seconds!==undefined)
  .reduce((max,p)=>{if(!Number.isSafeInteger(p.change_duration_seconds)||Number(p.change_duration_seconds)<0)throw Error('Invalid equipment duration');return Math.max(max,Number(p.change_duration_seconds));},0);
 if(seconds>6&&actor.runtime.encounterActive)throw Error('Для смены этого предмета требуется свободный интервал вне боя');
 let next=actor.runtime;
 if('equip' in operation){
  const card=cards.find(row=>row.id===operation.equip);if(!card)throw Error('Unknown equipment item');
  const result=equipCardSwapping(next,card);if(result.error)throw Error(result.error);next=result.state;
 }else{
  if(!next.equipment[operation.unequip])throw Error('Equipment slot is empty');
  next=unequipToInventory(next,operation.unequip);
 }
 const issue=itemEquipmentChangeIssue(actor.runtime,next,cards);if(issue)throw Error(issue);
 const known=new Set(cards.map(row=>row.id));
 const passives=[...(actor.passives??[]).filter(source=>!known.has(String(source.id??''))),
  ...collectItemMechanics(next.equipment,new Map(cards.map(card=>[card.id,card])),{attuned_ids:actor.character.attunedIds??[]},next.inventory)
   .filter(source=>(source.mechanics.activation as Record<string,unknown>|undefined)?.mode!=='active').map(source=>source.mechanics)];
 const character={...actor.character,equippedCards:cards.filter(card=>Object.values(next.equipment).includes(card.id))};
 // The draw event may restore a newly granted pool. Reconcile capacity before
 // emitting it, in the same accepted transition as the physical placement.
 next=reconcileEquipmentResourceGrants(actor.character,projectRuntimeCharacter(character,next,passives),actor.runtime,next,cards);
 const events:EngineEvent[]=[];
 const beforeIds=new Set(Object.values(actor.runtime.equipment));
 for(const cardId of new Set(Object.values(next.equipment))){
  if(!cardId||beforeIds.has(cardId))continue;
  const slot=Object.keys(next.equipment).find(key=>next.equipment[key]===cardId)!;
  next=emitEvent({kind:'equipment_changed',source:'self',data:{cardId,slot,operation:'equipped'}},next,
   {selfId:actor.id,character,passives,grantedEffects:actor.grantedEffects,rng:env.rng,nextId:env.nextId},events,[],undefined,[],true);
 }
 return {state:next,passives,character,events,seconds};
}
