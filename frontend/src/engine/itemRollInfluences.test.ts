import {describe,expect,it} from 'vitest';
import {availableRollInfluences, influencedD20Options, spendRollInfluence, withD20Influences} from './rollInfluence';
import {rollD20} from './roll';
import {influencedSheetRoll} from '../character/influencedSheetRoll';
import type {RuntimeState} from '../mvp/contracts';

const runtime = ():RuntimeState=>({resources:{charges:3,reaction:1},maxResources:{charges:3,reaction:1},equipment:{},inventory:[],activeEffects:[],hp:{current:10,max:10,temp:0}});
const source = (id:string,operation:string,timing='before_roll',extra={})=>({id,name:id,activation:{mode:'triggered',cost:[{resource:'charges',amount:1}]},effects:[{resolution:'auto',result:[{kind:'roll_influence',operation,timing,eligible_rolls:['attack','save','check'],...extra}]}]});

describe('generic item roll influences',()=>{
  it('folds all advantage causes once, including a cancelled base pair',()=>{
    const choices=availableRollInfluences(runtime(),[source('a','advantage'),source('d','disadvantage'),source('b','advantage')],'attack',undefined,{timing:'before_roll'});
    expect(influencedD20Options({rng:()=>.5},choices).advantage).toBe('none');
    expect(influencedD20Options({rng:()=>.5,advantage:'none',hasAdvantage:true,hasDisadvantage:true},[choices[0]]).advantage).toBe('none');
  });
  it('separates before-roll choices from held outcomes and checks the actual ability',()=>{
    const state=runtime(); const sources=[source('charisma','advantage','before_roll',{ability:'cha'}),source('evade','force_success','after_roll_before_outcome',{ability:'dex',eligible_outcomes:['fail']})];
    const failed=rollD20({rng:()=>.1,target:{type:'dc',value:99}});
    expect(availableRollInfluences(state,sources,'check',undefined,{timing:'before_roll',ability:'cha'}).map(a=>a.id)).toEqual(['charisma']);
    expect(availableRollInfluences(state,sources,'check',undefined,{timing:'before_roll',ability:'wis'})).toEqual([]);
    const evade=availableRollInfluences(state,sources,'save',failed,{ability:'dex'})[0];
    expect(rollD20(influencedD20Options({rng:()=>.1,target:{type:'dc',value:99}},[evade]))).toMatchObject({total:3,outcome:'success'});
    expect(availableRollInfluences(state,sources,'save',{...failed,outcome:'success'},{ability:'dex'})).toEqual([]);
  });
  it.each([6,10])('accepts a distinct penalty d%s only before rolling, upgrades a hit but never a miss',faces=>{
    const choice=availableRollInfluences(runtime(),[source(`greed-${faces}`,'critical_on_hit','before_roll',{penalty_dice:`2d${faces}`})],'attack',undefined,{timing:'before_roll'})[0];
    const values=[.7,0,0];
    const roll=rollD20({rng:withD20Influences(()=>values.shift()!,[choice]),target:{type:'ac',value:12}});
    expect(roll).toMatchObject({total:13,outcome:'crit'});
    expect(roll.dice.filter(d=>d.sign===-1)).toEqual([expect.objectContaining({sides:faces,result:1,source:`greed-${faces}`}),expect.objectContaining({sides:faces,result:1})]);
    const miss=rollD20({rng:withD20Influences(()=>.05,[choice]),target:{type:'ac',value:12}});
    expect(miss.outcome).toBe('miss');
  });
  it('sheet pre-choice pays once at finalization, retains the die and applies a declared failed-choice consequence',()=>{
    const state=runtime();
    const choice=source('temptation','advantage','before_roll',{failure_disadvantage_until_rest:true});
    const flow=influencedSheetRoll('check',{target:{type:'dc',value:99}},state,[choice],()=>.2);
    flow.request.beforeInfluence('temptation');
    expect(state.resources.charges).toBe(3);
    const roll=flow.request.roll();
    expect(roll.advantage).toBe('advantage');
    expect(flow.request.roll()).toBe(roll);
    const paid=flow.finalize(state).state;
    expect(paid.resources.charges).toBe(2);
    expect(paid.activeEffects).toMatchObject([{expiry:'long_rest',name:'temptation'}]);
    expect(()=>flow.finalize(paid)).toThrow();
  });
  it('checks both resource payment and once-per-turn use again at acceptance',()=>{
    const state=runtime(),data=source('time','reroll_kept_d20','after_roll_before_outcome',{once_per_turn:'item-time'});
    const roll=rollD20({rng:()=>.2});
    const action=availableRollInfluences(state,[data],'attack',roll)[0];
    const paid=spendRollInfluence(state,action).state;
    expect(availableRollInfluences(paid,[data],'attack',roll)).toEqual([]);
    expect(()=>spendRollInfluence(paid,action)).toThrow();
    expect(()=>spendRollInfluence({...state,resources:{}},action)).toThrow();
  });
});
