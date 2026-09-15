import {describe,it,expect} from 'vitest';
import {rollD20} from './roll';
import {withD20Replacement} from './rollInfluence';
import {influencedSheetRoll} from '../character/influencedSheetRoll';
import type {RuntimeState} from '../mvp/contracts';
const withHeroicD20 = (rng: () => number, result: number) => withD20Replacement(rng, result, 'Героическое вдохновение');

describe('one heroic inspiration d20',()=>{
 it.each([['advantage',.7,.2,2,5],['disadvantage',.7,.2,19,15],['none',.7,0,1,1]] as const)(
  '%s preserves the other die and must use the new result', (advantage,a,b,replacement,natural)=>{
   const values=[a,b];const rng=withHeroicD20(()=>values.shift()??.5,replacement);
   const roll=rollD20({advantage,rng,target:{type:'ac',value:10}});
   expect(roll.dice.find(d=>!d.discarded)?.result).toBe(natural);
   expect(roll.dice).toContainEqual(expect.objectContaining({result:replacement,source:'Героическое вдохновение'}));
   expect(rollD20({rng}).dice).toHaveLength(1);
 });
 it('recomputes critical hit and critical miss',()=>{
  expect(rollD20({rng:withHeroicD20(()=>.1,20),target:{type:'ac',value:99}}).outcome).toBe('crit');
  expect(rollD20({rng:withHeroicD20(()=>.95,1),modifiers:[{source:'bonus',value:99}],target:{type:'ac',value:1}}).outcome).toBe('miss');
 });
 it('spends only when a sheet reroll was requested, exactly one d20',()=>{
  const state:RuntimeState={resources:{heroic_inspiration:1},maxResources:{heroic_inspiration:1},hp:{current:10,max:10,temp:0},equipment:{},inventory:[],activeEffects:[]};
  const draws=[.05,.95];let calls=0;
  const prepared=influencedSheetRoll('check',{},state,[],()=>{calls++;return draws.shift()!;});
  expect(prepared.finalize(state).state).toBe(state);
  expect(prepared.request.roll().total).toBe(2);
  const action = prepared.request.influences(prepared.request.roll())[0];
  expect(prepared.request.influence(action.id).total).toBe(20);
  expect(calls).toBe(2);
  expect(prepared.finalize(state).state.resources.heroic_inspiration).toBe(0);
  expect(()=>prepared.request.influence(action.id)).toThrow();
  const empty=influencedSheetRoll('save',{}, {...state, resources:{}});
  expect(empty.request.influences(empty.request.roll())).toEqual([]);
 });
});
