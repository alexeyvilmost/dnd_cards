import {describe,expect,it,vi} from 'vitest';
import {executeAction,applyIncomingDamage} from './execute';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import type {ExecuteContext,RuntimeState} from '../mvp/contracts';
type Dict=Record<string,unknown>;
const state=():RuntimeState=>({...equippedFighterState(),hp:{current:20,max:40,temp:0}});
const context=(rng=()=>0.25):ExecuteContext=>({character:FIGHTER_CTX_EQUIPPED,selfId:'source',rng,
  target:{id:'target',ac:12,actorKind:'monster',runtimeState:state(),characterContext:FIGHTER_CTX_EQUIPPED}});
const automatic=(result:Dict[],who='self')=>({resolution:'auto',who,result});

describe('shared item execution primitives',()=>{
  it.each(['reaction','bonus_action'])('cancels every second paid %s after payment and preserves the counter on reload',resource=>{
    const cancel={id:`cancel-${resource}`,activation:{mode:'passive'},effects:[automatic([{kind:'triggered_effect',event:'resource_spent',
      circumstances:[{kind:'event_data_equals',key:'resource',value:resource}],occurrence:{every:2,per:'lifetime'},
      effects:[automatic([{kind:'cancel_execution'}])]}])]};
    const ctx={...context(),passives:[cancel]},initial=state();initial.resources[resource]=3;initial.maxResources[resource]=3;
    const action={activation:{mode:'active',cost:[{resource,amount:1}]},effects:[automatic([{kind:'healing',amount:2}])]};
    const first=executeAction(initial,action,ctx);expect(first.state.hp.current).toBe(22);
    const second=executeAction(JSON.parse(JSON.stringify(first.state)),action,ctx);
    expect(second.state.hp.current).toBe(22);expect(second.state.resources[resource]).toBe(1);
    expect(second.events.some(event=>event.type==='execution_cancelled')).toBe(true);
    const third=executeAction(second.state,action,ctx);expect(third.state.hp.current).toBe(24);
  });
  it.each([1,2])('rolls an explicit visible chance once when slot %s is paid',level=>{
    const resource=`spell_slot_${level}`,rng=vi.fn(()=>0),ctx={...context(rng),passives:[{id:'refund',activation:{mode:'passive'},effects:[automatic([
      {kind:'triggered_effect',event:'resource_spent',chance:{die:100,equals:[1]},circumstances:[{kind:'event_data_equals',key:'resource',value:resource}],
        effects:[automatic([{kind:'resource',op:'restore',id:resource,amount:1}])]},
    ])]}]};
    const initial=state();initial.resources[resource]=1;initial.maxResources[resource]=1;
    const result=executeAction(initial,{activation:{mode:'active',cost:[{resource}]},effects:[automatic([{kind:'healing',amount:1}])]},ctx);
    expect(result.state.resources[resource]).toBe(1);expect(rng).toHaveBeenCalledTimes(1);
    expect(result.events.some(event=>event.type==='roll'&&event.roll.dice[0]?.sides===100)).toBe(true);
  });
  it.each(['2d4+2','3d6'])('shares %s once between healing and self-damage, preserving the selected recipient',formula=>{
    const rng=vi.fn(()=>0.25),ctx=context(rng);
    const result=executeAction(state(),{damage_source_kind:'item',formula_bindings:{shared:formula},effects:[
      automatic([{kind:'healing',amount:'shared'}],'target'),
      automatic([{kind:'damage',amount:'floor(shared/2)',type:'necrotic',suppress_damage_modifiers:true}]),
    ]},ctx);
    const total=formula==='2d4+2'?6:6;
    expect(rng).toHaveBeenCalledTimes(formula==='2d4+2'?2:3);
    expect(result.targetState?.hp.current).toBe(20+total);
    expect(result.state.hp.current).toBe(20-Math.floor(total/2));
    expect(result.events.filter(e=>e.type==='roll')).toHaveLength(1);
  });
  it.each(['spell','ability'] as const)('matches own %s damage without applying that policy to another source or item',kind=>{
    const policy={kind:'modifier',op:'multiply',value:0,applies_to:{roll:'damage_received',filter:{source_actor:'self',source_kinds:[kind]}}};
    const ctx={...context(),passives:[policy]};
    const action={damage_source_kind:kind,effects:[automatic([{kind:'damage',amount:5,type:'fire'}])]};
    expect(executeAction(state(),action,ctx).state.hp.current).toBe(20);
    expect(executeAction(state(),{...action,damage_source_kind:'item'},ctx).state.hp.current).toBe(15);
    expect(applyIncomingDamage(state(),5,{...ctx,damageSource:{actorId:'enemy',kind}},{damageType:'fire'}).state.hp.current).toBe(15);
  });
  it('bounds mutually retaliating actors and resets the budget for an independent invocation',()=>{
    const retaliation={id:'retaliation',name:'Retaliation',activation:{mode:'passive'},effects:[automatic([
      {kind:'triggered_effect',event:'damage_taken',effects:[automatic([{kind:'damage',amount:1,type:'force'}],'target')]},
    ])]};
    const ctx={...context(),passives:[retaliation]};ctx.target!.passives=[retaliation];
    const action={effects:[automatic([{kind:'damage',amount:1,type:'force'}],'target')]};
    const first=executeAction(state(),action,ctx),second=executeAction(state(),action,ctx);
    expect(first.state.hp.current).toBeLessThan(20);
    expect(first.events.filter(e=>e.type==='damage').length).toBeLessThan(40);
    expect(first.events.some(e=>e.type==='narrative'&&e.text.includes('лимит'))).toBe(true);
    expect(second.state.hp).toEqual(first.state.hp);
    expect(second.targetState?.hp).toEqual(first.targetState?.hp);
  });
  it.each([2,3])('caps inline and referenced sustained effects to %s rounds',cap=>{
    const ctx={...context(),grantedEffects:{'effect.test':{id:'effect-id',name:'Persist',card_number:'effect.test',mechanics:{
      id:'effect-test',duration:{type:'minutes',amount:10,concentration:true},effects:[automatic([
        {kind:'modifier',op:'add',value:2,applies_to:{roll:'attack'}},
      ])],
    }}}};
    const result=executeAction(state(),{duration_cap_rounds:cap,effects:[automatic([
      {kind:'modifier',op:'add',value:1,applies_to:{roll:'saving_throw'},duration:{type:'minutes',amount:10,concentration:true}},
      {kind:'grant_effect',values:['effect.test']},
    ])]},ctx);
    expect(result.state.activeEffects).toHaveLength(2);
    expect(result.state.activeEffects.every(effect=>effect.roundsLeft===cap&&!(effect.mechanics.duration as Dict)?.concentration)).toBe(true);
  });
  it('consumes a next-damage rule only on an actual damage roll',()=>{
    const before=state();before.activeEffects=[{id:'next',name:'Next',source:'Next',mechanics:{kind:'modifier',op:'add_dice_drop_lowest',extra:2,drop:1,consume:'next',applies_to:{roll:'damage'}}}];
    const result=executeAction(before,{effects:[automatic([{kind:'damage',dice:'1d6',type:'force'}],'target')]},context());
    expect(result.state.activeEffects).toHaveLength(0);
    const flat=executeAction(before,{effects:[automatic([{kind:'damage',amount:3,type:'force'}],'target')]},context());
    expect(flat.state.activeEffects).toHaveLength(1);
  });
});
