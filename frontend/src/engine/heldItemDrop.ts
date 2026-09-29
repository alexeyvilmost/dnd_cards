import {payloadsOf} from './mechanicsView';
import {cardPropertyList} from '../utils/cardProperties';
import type {CharacterContext, EngineEvent, RuntimeState} from '../mvp/contracts';

export type HeldItemHand = 'main_hand' | 'off_hand';

export function selectedHeldItemHand(choices: Record<string,string|string[]> | undefined, choiceId: unknown): HeldItemHand {
  if (typeof choiceId !== 'string' || !choiceId) throw new Error('Не указан выбор удерживаемого предмета');
  const value=choices?.[choiceId];const values=Array.isArray(value)?value:[value];
  if(values.length!==1 || (values[0]!=='main_hand' && values[0]!=='off_hand')) throw new Error('Выберите один удерживаемый предмет');
  return values[0];
}

export function heldItemDropIssue(state: RuntimeState | undefined, hand: HeldItemHand): string | null {
  const cardId=state?.equipment[hand];
  if(!cardId) return 'В выбранной руке нет предмета';
  return null;
}

/** Remove the equipped instance, leaving bag contents unchanged; its physical world object is created by rules-core. */
export function dropHeldItem(state: RuntimeState, hand: HeldItemHand, ownerActorId: string, character: CharacterContext, options:{forced?:boolean;passives?:readonly Record<string,unknown>[]}={}): {state: RuntimeState; events: EngineEvent[]} {
  if(options.forced&&[...(options.passives??[]),...state.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)].flatMap(payloadsOf).some(p=>p.kind==='equipment_policy'&&p.cannot_be_disarmed===true&&(p.weapon_id===undefined||p.weapon_id===state.equipment[hand])))return {state,events:[{type:'narrative',text:'Предмет не может быть выбит из рук: действующий источник защищает владельца от обезоруживания.'}]};
  const issue=heldItemDropIssue(state,hand);if(issue)throw new Error(issue);
  const cardId=state.equipment[hand]!;
  const card=character.knownCards?.find(row=>row.id===cardId) ?? character.equippedCards?.find(row=>row.id===cardId);
  if(card?.mechanics&&payloadsOf(card.mechanics).some(p=>p.kind==='equipment_policy'&&p.cannot_remove===true))return {state,events:[{type:'narrative',text:'Этот предмет нельзя снять: действует его собственное ограничение.'}]};
  const equipment={...state.equipment,[hand]:null};
  const other=hand==='main_hand'?'off_hand':'main_hand';
  if(equipment[other]===cardId && (card?.slot==='two_hands' || cardPropertyList(card?.properties).some(property=>property==='two_handed'||property==='two-handed'))) equipment[other]=null;
  const inventory = state.inventory;
  return {state:{...state,equipment,inventory},events:[
    {type:'world_interaction',operation:'drop_held_item',parameters:{cardId,hand,ownerActorId}},
    {type:'narrative',text:`Предмет выпал из руки: ${card?.name??cardId}`},
  ]};
}


export function disarmingSelectionIssue(mechanics:Record<string,unknown>,target:RuntimeState|undefined,choices:Record<string,string|string[]>|undefined):string|null{
 const trigger=(mechanics.activation as Record<string,unknown>|undefined)?.trigger as Record<string,unknown>|undefined;
 if(trigger?.disarm_held_item!==true)return null;
 try{return heldItemDropIssue(target,selectedHeldItemHand(choices,'disarm_held_item'));}
 catch(reason){return reason instanceof Error?reason.message:'Выберите удерживаемый предмет';}
}
