import {describe,it,expect,afterEach} from 'vitest';
import {conditionGrantedActions} from './conditionActions';
import {registerConditions, resetConditionsToOfflineFixture} from './conditions';
import type {RuntimeState} from '../mvp/contracts';
const state:RuntimeState={resources:{},maxResources:{},equipment:{},inventory:[],hp:{current:10,max:10,temp:0},activeEffects:[]};
const effect=(value:string)=>({id:value,name:value,source:'test',mechanics:{kind:'condition',value}});
afterEach(()=>resetConditionsToOfflineFixture('test finished'));
describe('condition action grants',()=>{
  it('comes from the active condition and disappears with it',()=>{
    expect(conditionGrantedActions(state)).toEqual([]);
    const actions=conditionGrantedActions({...state,activeEffects:[effect('prone')]});
    expect(actions[0]).toMatchObject({name:'Встать',movementFraction:.5});
    expect(actions[0].effects).toEqual([{resolution:'auto',result:[{kind:'condition',value:'prone',op:'remove'}]}]);
  });
  it('does not remove the parent when a composed condition supplies the grant',()=>{
    const action=conditionGrantedActions({...state,activeEffects:[effect('unconscious')]})[0];
    expect(JSON.stringify(action.effects)).toContain('prone');
    expect(JSON.stringify(action.effects)).not.toContain('unconscious');
  });
  it('supports a different condition, price and action from data',()=>{
    registerConditions([{id:'sticky',label:'Липкая грязь',modifiers:[],worldFacts:{granted_actions:[{
      id:'mud.clear',name:'Очистить сапоги',description:'Четверть скорости',movementFraction:.25,
      effects:[{resolution:'auto',result:[{kind:'condition',value:'$granting_condition',op:'remove'}]}],
    }]}}]);
    const action=conditionGrantedActions({...state,activeEffects:[effect('sticky')]})[0];
    expect(action).toMatchObject({id:'mud.clear:sticky',name:'Очистить сапоги',movementFraction:.25});
    expect(JSON.stringify(action.effects)).toContain('sticky');
  });
});
