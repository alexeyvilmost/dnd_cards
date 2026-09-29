import {describe,expect,it} from 'vitest';
import {executeAction} from './execute';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';
type Dict=Record<string,unknown>;
const listener=(event:string,result:Dict[])=>({id:event,activation:{mode:'passive'},effects:[{resolution:'auto',result:[{kind:'triggered_effect',id:event,event,subject:'self',effects:[{resolution:'auto',who:'self',result}]}]}]});
function context(passives:Dict[]):ExecuteContext{return {character:FIGHTER_CTX_EQUIPPED,selfId:'source',passives,rng:()=>.5,target:{id:'target',actorKind:'monster',ac:5,runtimeState:equippedFighterState(),characterContext:FIGHTER_CTX_EQUIPPED}};}
describe('middle item event and spell identity hooks',()=>{
  it.each(['prone','blinded'])('grants one inventory charge only when %s is actually applied',condition=>{
    const ctx=context([listener('condition_applied',[{kind:'add_item',card_id:`charge-${condition}`,qty:1}])]);
    const action={effects:[{resolution:'auto',who:'target',result:[{kind:'condition',value:condition}]}]};
    const result=executeAction(equippedFighterState(),action,ctx);
    expect(result.state.inventory.find(row=>row.cardId===`charge-${condition}`)?.qty).toBe(1);
    ctx.target!.conditionImmunities=[{condition,sourceEntityIds:['immune']}];
    expect(executeAction(equippedFighterState(),action,ctx).state.inventory.some(row=>row.cardId===`charge-${condition}`)).toBe(false);
  });
  it.each(['dex','con'])('dispatches one forced %s save event with the saved outcome',ability=>{
    const ctx=context([listener('forced_save',[{kind:'resource',id:'reward',op:'restore',amount:1}])]);
    const state=equippedFighterState();state.resources.reward=0;state.maxResources.reward=2;
    const result=executeAction(state,{effects:[{resolution:'save',ability,dc:12,who:'target',on_fail:[],on_success:[]}]},{...ctx,forceSaveOutcome:'success'});
    expect(result.state.resources.reward).toBe(1);
  });
  it.each(['spell-a','spell-b'])('limits an extra explosion to its immutable spell %s while preserving native maxima',spellId=>{
    const passive={kind:'modifier',op:'explode',natural:{eq:7},limit:1,once_per_turn:'extra',applies_to:{roll:'damage',filter:{spellId}}};
    const rolls=[.8,.99,.375];let i=0;
    const ctx={...context([passive]),spell:{baseLevel:0,spellId},rng:()=>rolls[i++]??(()=>{throw Error('unexpected die');})()};
    const action={effects:[{resolution:'auto',who:'target',result:[{kind:'damage',dice:'1d8',type:'force',explode:{limit:2}}]}]};
    const result=executeAction(equippedFighterState(),action,ctx);
    expect(result.events.find(event=>event.type==='damage')?.amount).toBe(19);expect(result.state.firedThisTurn).toContain('extra');expect(i).toBe(3);
    i=0;const other=executeAction(equippedFighterState(),action,{...ctx,spell:{baseLevel:0,spellId:'unrelated'}});
    expect(other.events.find(event=>event.type==='damage')?.amount).toBe(7);expect(i).toBe(1);
  });
});
