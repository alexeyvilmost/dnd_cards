import type {Card} from '../types';
import type {RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';

/** The restriction belongs to the equipped item. Removing attunement or
 * submitting a new passive list cannot erase a still-worn curse. */
export function itemEquipmentChangeIssue(before:Pick<RuntimeState,'equipment'>,after:Pick<RuntimeState,'equipment'>,cards:readonly Card[]):string|null{
 for(const [slot,id] of Object.entries(before.equipment)){
  if(!id||after.equipment[slot]===id)continue;
  const card=cards.find(row=>row.id===id);
  if(card?.mechanics&&payloadsOf(card.mechanics as Record<string,unknown>).some(payload=>payload.kind==='equipment_policy'&&payload.cannot_remove===true))return `Нельзя снять предмет «${card.name}»: действующее свойство запрещает снятие.`;
 }
 return null;
}
