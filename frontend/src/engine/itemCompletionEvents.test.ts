import {describe,expect,it} from 'vitest';
import {executeAction,resolveDeferredSourceConsequences} from './execute';
import {startTurn} from './turn';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import type {ExecuteContext,RuntimeState} from '../mvp/contracts';

type Dict=Record<string,unknown>;
const state=():RuntimeState=>({...equippedFighterState(),hp:{current:20,max:40,temp:0}});
const context=(passives:Dict[]=[],targetPassives:Dict[]=[],rng=()=>0.99):ExecuteContext=>({
  character:FIGHTER_CTX_EQUIPPED,selfId:'a',passives,rng,
  target:{id:'b',actorKind:'monster',ac:10,runtimeState:state(),characterContext:FIGHTER_CTX_EQUIPPED,passives:targetPassives},
});
const attack={effects:[{resolution:'attack_roll',attack_kind:'weapon_melee',ability:'auto',
  on_hit:[{kind:'damage',amount:3,type:'force'}]}]};
const listener=(id:string,event:string,result:Dict[],extra:Dict={}):Dict=>({id,name:id,activation:{mode:'passive'},effects:[{resolution:'auto',result:[{
  id,kind:'triggered_effect',event,effects:[{resolution:'auto',who:'self',result}],...extra,
}]}]});

describe('item completion event lifecycle',()=>{
  it('defers source healing and kill rewards until damage mitigation is final',()=>{
    const recovery=listener('leech','damage_dealt',[{kind:'healing',amount:'event_amount'}]);
    const reward=listener('kill','kill',[{kind:'temp_hp',amount:5}]);
    const ctx={...context([recovery,reward],[],()=>0.6),deferIncomingDamageConsequences:true};
    ctx.target!.runtimeState!.hp.current=2;
    const pending=executeAction(state(),attack,ctx);
    expect(pending.state.hp).toMatchObject({current:20,temp:0});
    const mitigated=pending.events.map(event=>event.type==='damage'?{...event,amount:1}:event);
    const targetAfter={...pending.targetState!,hp:{...pending.targetState!.hp,current:1}};
    const final=resolveDeferredSourceConsequences(pending.state,targetAfter,ctx,mitigated);
    expect(final.state.hp).toMatchObject({current:21,temp:0});
    const full=resolveDeferredSourceConsequences(pending.state,pending.targetState!,ctx,pending.events);
    expect(full.state.hp).toMatchObject({current:23,temp:5});
  });
  it.each(['spell_slot_1','ki'])('restores all of an existing %s pool without granting a foreign pool',id=>{
    const action={effects:[{resolution:'auto',who:'self',result:[{kind:'resource',id,op:'restore',restore_all:true}]}]};
    const before=state();before.maxResources[id]=4;before.resources[id]=1;
    expect(executeAction(before,action,context()).state.resources[id]).toBe(4);
    delete before.maxResources[id];delete before.resources[id];
    expect(executeAction(before,action,context()).state.resources[id]).toBeUndefined();
  });
  it.each(['stunned','paralyzed'])('executes an explicit fallback only when immune to %s',value=>{
    const action={effects:[{resolution:'auto',who:'target',result:[{kind:'condition',value,
      on_immune:[{kind:'damage',amount:4,type:'psychic'}]}]}]};
    const ctx=context();ctx.target!.conditionImmunities=[{condition:value,sourceEntityIds:['immunity']}];
    expect(executeAction(state(),action,ctx).targetState?.hp.current).toBe(16);
    expect(executeAction(state(),action,context()).targetState?.hp.current).toBe(20);
  });
  it('projects distinct target-owned critical and natural-roll policies',()=>{
    const noCrit={kind:'modifier',scope:'target',op:'deny_critical',applies_to:{roll:'attack'}};
    const result=executeAction(state(),attack,context([],[noCrit]));
    expect(result.events.find(e=>e.type==='roll')?.roll.outcome).toBe('hit');
    const forceOne={kind:'modifier',scope:'target',op:'set_die_result',value:1,applies_to:{roll:'attack'}};
    expect(executeAction(state(),attack,context([],[forceOne])).events.find(e=>e.type==='roll')?.roll.outcome).toBe('miss');
  });
  it('does not count held attacks; counts committed misses and the defender independently',()=>{
    const source=listener('source','attack_roll_made',[{kind:'temp_hp',amount:7}],{occurrence:{at:1,per:'turn'}});
    const defender=listener('defender','attacked',[{kind:'temp_hp',amount:9}],{occurrence:{every:2,per:'round'}});
    const ctx=context([source],[defender],()=>0);
    const held=executeAction(state(),attack,{...ctx,pauseAfterAttackRoll:true});
    expect(held.state.eventOccurrences).toBeUndefined();
    expect(held.targetState?.eventOccurrences).toBeUndefined();
    const first=executeAction(state(),attack,ctx);
    expect(first.state.hp.temp).toBe(7);expect(first.targetState?.hp.temp).toBe(0);
    const again=executeAction(first.state,attack,{...ctx,target:{...ctx.target,runtimeState:JSON.parse(JSON.stringify(first.targetState))}});
    expect(again.targetState?.hp.temp).toBe(9);
  });
  it('third hit counter is target-scoped, persisted, and renewed by the owner turn',()=>{
    const third=listener('third','hit',[{kind:'temp_hp',amount:6}],{occurrence:{at:3,per:'turn',group_by:'target'}});
    const ctx=context([third],[],()=>0.6);
    let current=state();
    for(let n=0;n<2;n++)current=executeAction(current,attack,ctx).state;
    const other=executeAction(current,attack,{...ctx,target:{...ctx.target,id:'other'}});
    expect(other.state.hp.temp).toBe(0);
    const loaded=JSON.parse(JSON.stringify(other.state)) as RuntimeState;
    expect(executeAction(loaded,attack,ctx).state.hp.temp).toBe(6);
    const renewed=startTurn(loaded,FIGHTER_CTX_EQUIPPED).state;
    expect(executeAction(renewed,attack,ctx).state.hp.temp).toBe(0);
  });
  it('binds actual healing and damage amounts to the correct owner',()=>{
    const heal=listener('heal','healing_given',[{kind:'temp_hp',amount:'event_amount'}]);
    const dealt=listener('dealt','damage_dealt',[{kind:'healing',amount:'event_amount/2'}]);
    const ctx=context([heal,dealt],[],()=>0.6);
    const healed=executeAction(state(),{effects:[{resolution:'auto',who:'target',result:[{kind:'healing',amount:8}]}]},ctx);
    expect(healed.state.hp.temp).toBe(8);expect(healed.targetState?.hp.current).toBe(28);
    const hit=executeAction(state(),attack,ctx);
    expect(hit.state.hp.current).toBe(21);expect(hit.targetState?.hp.current).toBe(17);
  });
  it('a zero-HP player is not a kill; a defeated monster is',()=>{
    const reward=listener('reward','kill',[{kind:'temp_hp',amount:5}]);
    const ctx=context([reward],[],()=>0.6);
    ctx.target!.runtimeState!.hp.current=1;
    expect(executeAction(state(),attack,ctx).state.hp.temp).toBe(5);
    expect(executeAction(state(),attack,{...ctx,target:{...ctx.target,actorKind:'playerCharacter'}}).state.hp.temp).toBe(0);
  });
});
