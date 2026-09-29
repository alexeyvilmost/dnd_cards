import {describe,expect,it} from 'vitest';
import {applyActionCostPolicies,availableActionCostPolicies} from './actionCostPolicy';
import {pay} from './cost';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';

const policy=(id:string,extra:Record<string,unknown>={})=>({kind:'action_cost_policy',id,match:{costs_resource:'wild_shape'},replace:{action:'bonus_action'},...extra});
const mechanics={activation:{mode:'active',cost:[{resource:'action',amount:1},{resource:'wild_shape',amount:1}]},effects:[]};
const context=(passives:Record<string,unknown>[])=>({state:{...equippedFighterState(),resources:{action:1,bonus_action:1,wild_shape:2,ki:3,quick:2}},character:FIGHTER_CTX_EQUIPPED,passives,actionRefs:['ACT-wild-shape']});

describe('authoritative item cost policies',()=>{
  it.each(['bonus_action','free_action'])('replaces action with %s while preserving the transformation charge',replacement=>{
    const ctx=context([policy(`armor-${replacement}`,{replace:{action:replacement}})]);
    const changed=applyActionCostPolicies(mechanics,ctx);
    const cost=(changed.mechanics.activation as {cost:Record<string,unknown>[]}).cost;
    expect(cost).toEqual([...(replacement==='free_action'?[]:[{resource:replacement,amount:1}]),{resource:'wild_shape',amount:1}]);
    const paid=pay(ctx.state,cost).state;
    expect(paid.resources.wild_shape).toBe(1);expect(paid.resources.action).toBe(1);
    expect(mechanics.activation.cost[0].resource).toBe('action');
  });
  it('uses explicit optional selection, charges its own pool and rejects a stale/forged selection',()=>{
    const action={activation:{mode:'active',cost:[{resource:'action',amount:1}]}};
    const ctx={...context([policy('quick-cantrip',{match:{spell_level:0},optional:true,additional_cost:[{resource:'quick',amount:1}]})]),spell:{baseLevel:0,school:'evocation'}};
    expect(availableActionCostPolicies(action,ctx)).toHaveLength(1);
    expect(applyActionCostPolicies(action,ctx,null).mechanics).toBe(action);
    const changed=applyActionCostPolicies(action,ctx,'quick-cantrip');
    const loaded=JSON.parse(JSON.stringify(changed));
    const paid=pay(ctx.state,loaded.mechanics.activation.cost).state;
    expect(paid.resources).toMatchObject({action:1,bonus_action:0,quick:1});
    expect(()=>applyActionCostPolicies(action,{...ctx,spell:{baseLevel:1}},'quick-cantrip')).toThrow();
    expect(()=>applyActionCostPolicies(action,ctx,'another-actor-policy')).toThrow();
  });
  it('waives a named resource only for immutable matching actions and higher mandatory priority wins',()=>{
    const ctx=context([policy('bonus'),policy('free',{priority:10,replace:{action:'free_action'}}),
      policy('waiver',{match:{action_refs:['ACT-other']},waive_resources:['wild_shape'],replace:undefined})]);
    expect((applyActionCostPolicies(mechanics,ctx).mechanics.activation as {cost:unknown[]}).cost).toEqual([{resource:'wild_shape',amount:1}]);
    ctx.actionRefs=['ACT-other'];
    expect((applyActionCostPolicies(mechanics,ctx).mechanics.activation as {cost:unknown[]}).cost).toEqual([]);
  });
  it('offers a concentration waiver only for a concentrating spell and carries a two-round cap',()=>{
    const ctx={...context([{kind:'action_cost_policy',id:'short-focus',optional:true,match:{concentrating_spell:true},concentration:false,duration_cap_rounds:2}]),spell:{baseLevel:1,concentration:true}};
    const result=applyActionCostPolicies(mechanics,ctx,'short-focus');
    expect(result.spellOverrides).toEqual({concentration:false,durationCapRounds:2});
    expect((result.mechanics.activation as {cost:unknown[]}).cost).toEqual(mechanics.activation.cost);
    expect(availableActionCostPolicies(mechanics,{...ctx,spell:{baseLevel:1,concentration:false}})).toEqual([]);
  });

});
