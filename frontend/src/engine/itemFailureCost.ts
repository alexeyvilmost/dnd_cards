import type {EngineEvent,RuntimeState} from '../mvp/contracts';
import {canPay,costAmount} from './cost';
import {payloadsOf} from './mechanicsView';
type Dict=Record<string,unknown>;
/** Called only for a committed tool-failure consequence, after any saved check
 * influence. Inventory stacks consume their first unit; wear survives reload
 * and is cleared precisely when that unit breaks. */
export function planItemFailureCost(state:RuntimeState,cost:Dict[],passives:Dict[],source:string):{state:RuntimeState;cost:Dict[];events:EngineEvent[]}{
 const available=canPay(state,cost);if(!available.ok)throw Error(`Недостаточно предметов: ${available.missing.join(', ')}`);
 let next=state;const result:Dict[]=[],events:EngineEvent[]=[];
 const policies=[...passives,...state.activeEffects.filter(entry=>entry.roundsLeft===undefined||entry.roundsLeft>0).map(entry=>entry.mechanics)].flatMap(payloadsOf);
 for(const entry of cost){
  if(entry.resource!=='item'||costAmount(entry)!==1){result.push(entry);continue;}
  const cardId=String(entry.card_id),id=`item-failure:${cardId}`;
  const thresholds=policies.filter(row=>row.kind==='item_failure_policy'&&row.card_id===cardId&&Number.isInteger(row.break_after_failures)&&Number(row.break_after_failures)>1).map(row=>Number(row.break_after_failures));
  const threshold=Math.max(1,...thresholds),previous=next.activeEffects.find(row=>row.id===id);
  const failures=Math.max(0,Number(previous?.mechanics.failures)||0)+1;
  next={...next,activeEffects:next.activeEffects.filter(row=>row.id!==id)};
  if(failures>=threshold){result.push(entry);if(previous)events.push({type:'effect_expired',name:previous.name});continue;}
  const name=`Повреждение инструмента: ${failures}/${threshold}`;
  next.activeEffects.push({id,name,source,mechanics:{kind:'item_failure_count',card_id:cardId,failures,duration:{type:'permanent'}}});
  events.push({type:'effect_applied',name,source});
 }
 return {state:next,cost:result,events};
}
