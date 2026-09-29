import {describe,expect,it} from 'vitest';
import {executeAction} from './execute';
import {activeEffectRequirementIssue} from './actionRequirements';
import {availableResources} from './resourceRestrictions';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {Card} from '../types';
describe('data owned spell slot restrictions preserve the underlying counters',()=>{
 it.each([2,5])('blocks all uses of the highest level %s, even when its current count is zero',level=>{
  const item={id:'curse',name:'Curse',mechanics:{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[{kind:'resource_restriction',spell_slots:'highest'}]}]}} as unknown as Card;
  const character={...FIGHTER_CTX_EQUIPPED,knownCards:[item]},state=equippedFighterState();
  state.inventory=[{cardId:item.id,qty:1}];state.resources={spell_slot_1:2,[`spell_slot_${level}`]:1,[`pact_slot_${level}`]:1};state.maxResources={...state.resources};
  const action=(resource:string)=>({activation:{mode:'active',cost:[{resource,amount:1}]},effects:[]});
  expect(availableResources(state,character)).toMatchObject({spell_slot_1:2,[`spell_slot_${level}`]:0,[`pact_slot_${level}`]:0});
  expect(activeEffectRequirementIssue(action(`spell_slot_${level}`),state,character)).toContain('лиша');
  expect(()=>executeAction(state,action(`pact_slot_${level}`),{character,rng:()=>{throw Error('No RNG');}})).toThrow('лиша');
  expect(executeAction(state,action('spell_slot_1'),{character,rng:()=>0}).state.resources.spell_slot_1).toBe(1);
  const empty=JSON.parse(JSON.stringify(state));empty.resources[`spell_slot_${level}`]=0;empty.resources[`pact_slot_${level}`]=0;
  expect(activeEffectRequirementIssue(action('spell_slot_1'),empty,character)).toBeNull();
  const dropped=JSON.parse(JSON.stringify(state));dropped.inventory=[];
  expect(availableResources(dropped,character)[`spell_slot_${level}`]).toBe(1);
  expect(executeAction(dropped,action(`spell_slot_${level}`),{character,rng:()=>0}).state.resources[`spell_slot_${level}`]).toBe(0);
 });
});
