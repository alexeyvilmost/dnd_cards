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
  return state.inventory.some(row=>row.cardId===cardId && row.containerId==null && row.qty>0)
    ? null : 'Выбранный предмет отсутствует в доступном инвентаре';
}

/** Remove exactly one accessible item; its physical world object is created by rules-core. */
export function dropHeldItem(state: RuntimeState, hand: HeldItemHand, ownerActorId: string, character: CharacterContext): {state: RuntimeState; events: EngineEvent[]} {
  const issue=heldItemDropIssue(state,hand);if(issue)throw new Error(issue);
  const cardId=state.equipment[hand]!;
  const card=character.knownCards?.find(row=>row.id===cardId) ?? character.equippedCards?.find(row=>row.id===cardId);
  const equipment={...state.equipment,[hand]:null};
  const other=hand==='main_hand'?'off_hand':'main_hand';
  if(equipment[other]===cardId && (card?.slot==='two_hands' || cardPropertyList(card?.properties).some(property=>property==='two_handed'||property==='two-handed'))) equipment[other]=null;
  let removed=false;
  const inventory=state.inventory.flatMap(row=>{
    if(!removed && row.cardId===cardId && row.containerId==null && row.qty>0){removed=true;return row.qty>1?[{...row,qty:row.qty-1}]:[];}
    return [row];
  });
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
