import {describe, it, expect} from 'vitest';
import {availableRollInfluences, spendRollInfluence} from './rollInfluence';
import {influencedSheetRoll} from '../character/influencedSheetRoll';
import {rollD20, retargetAttackRoll} from './roll';
import type {RuntimeState} from '../mvp/contracts';

const state: RuntimeState = {resources:{heroic_inspiration:1, ring_charge:2}, maxResources:{heroic_inspiration:1,ring_charge:2},
  hp:{current:10,max:10,temp:0}, inventory:[],equipment:{},activeEffects:[]};
const ring = {id:'test-ring',name:'Кольцо второго шанса',description:'Переброс к20 меньше 3.',
  activation:{mode:'triggered',cost:[{resource:'ring_charge',amount:1}]},
  effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'reroll_kept_d20',timing:'after_roll_before_outcome',eligible_rolls:['check'],die_max:2}]}]};
describe('entity-owned roll influences',()=>{
  it('discovers a second entity without source-name/UUID or resource branches',()=>{
    const roll = rollD20({rng:()=>.05});
    expect(availableRollInfluences(state,[ring],'check',roll).map(action=>action.id)).toEqual(['core.heroic-inspiration','test-ring']);
    expect(availableRollInfluences(state,[ring],'attack',roll).map(action=>action.id)).not.toContain('test-ring');
    expect(availableRollInfluences(state,[ring],'check',rollD20({rng:()=>.1})).map(action=>action.id)).not.toContain('test-ring');
  });
  it('uses the chosen entity cost, source and replay, not inspiration',()=>{
    const draws=[.05,.65];
    const pending=influencedSheetRoll('check',{},state,[ring],()=>draws.shift()!);
    pending.request.roll();
    expect(pending.request.influence('test-ring').dice.at(-1)?.source).toBe(ring.name);
    expect(pending.finalize(state).state.resources).toEqual({heroic_inspiration:1,ring_charge:1});
    expect(()=>pending.request.influence('core.heroic-inspiration')).toThrow();
    expect(()=>pending.finalize({...state,resources:{ring_charge:0}})).toThrow();
  });
  it('fails closed for unsupported phases, missing or malformed prices and stale costs',()=>{
    const roll=rollD20({rng:()=>0});
    const sources=[{...ring,activation:{mode:'triggered',cost:[{resource:'ring_charge',amount:-1}]}}];
    expect(availableRollInfluences(state,sources,'check',roll).map(action=>action.id)).not.toContain('test-ring');
    const action=availableRollInfluences(state,[ring],'check',roll)[1];
    expect(()=>spendRollInfluence({...state,resources:{}},action)).toThrow();
  });
  it('retains a truthful AC snapshot when a reaction changes the target',()=>{
    const roll=rollD20({rng:()=>.75,target:{type:'ac',value:14,breakdown:{value:14,parts:[{source:'Доспех',value:14}]}}});
    const revised=retargetAttackRoll(roll,19);
    expect(revised.target?.breakdown?.parts.reduce((sum,part)=>sum+part.value,0)).toBe(19);
    expect(roll.target?.breakdown?.value).toBe(14);
    expect(revised.outcome).toBe('miss');
  });
});
