import {projectRuleAction} from '../canon/ruleActionProjection';
import type {Action} from '../types';
import type {CharacterContext,RuntimeState,EngineEvent} from '../mvp/contracts';
import {slotRecoveryPickerState} from '../character/sheetRestDecisions';
import {resolveSlotRecoveryRestDecision} from './restDecisions';

type Dict=Record<string,unknown>;
/** Active use shares the strict declaration compiler and resolver with rest recovery. */
export function activeSlotRecoveryChoice(mechanics:Dict,state:RuntimeState,character:CharacterContext){
  const raw=mechanics.active_slot_recovery as Dict|undefined;
  if(raw===undefined)return undefined;
  if(!raw||typeof raw!=='object'||typeof raw.charge_resource!=='string')throw Error('Некорректное восстановление ячеек');
  const {charge_resource:resource,...declaration}=raw;
  const projected=projectRuleAction({id:'active-slot-recovery-policy',card_number:'active-slot-recovery-policy',name:'Восстановление ячеек',
    mechanics:{activation:{mode:'rest_decision',cost:[{resource,amount:1}]},effects:[],rest_decision:declaration}} as unknown as Action);
  const policy=projected.restDecision!;
  return {policy,...slotRecoveryPickerState({state,classLevels:character.classLevels,policy})};
}

export function applyActiveSlotRecovery(mechanics:Dict,state:RuntimeState,character:CharacterContext,slotLevels:number[]):{state:RuntimeState;events:EngineEvent[]}{
  const choice=activeSlotRecoveryChoice(mechanics,state,character);
  if(!choice)throw Error('Действие не восстанавливает ячейки');
  const result=resolveSlotRecoveryRestDecision({state,classLevels:character.classLevels,policy:choice.policy,decision:{type:choice.policy.decisionType,slotLevels}});
  if(result.status==='rejected')throw Error(result.message);
  return {state:result.state,events:[{type:'resource_spent',...result.spentResource},...result.restoredResources.map(row=>({type:'resource_restored' as const,...row}))]};
}
