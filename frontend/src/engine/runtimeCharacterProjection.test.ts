import {describe,expect,it,vi} from 'vitest';
import {executeAction} from './execute';
import {startTurn} from './turn';
import {runtimeActionContext} from './actionGrantContext';
import {projectRuntimeCharacter} from './runtimeCharacterProjection';
import {reconcileTemporaryResourceGrants} from './temporaryResourceGrants';
import {combatActorMovementSpeeds} from '../solo-combat/tacticalGrid';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import type {ActorState} from '../rules-core/domain';
type Dict=Record<string,unknown>;
const effect=(payloads:Dict[],amount=2)=>({id:'runtime',name:'Runtime',mechanics:{duration:{type:'rounds',amount},activation:{mode:'passive'},effects:[{resolution:'auto',result:payloads}]}});
const cast=(payloads:Dict[],amount=2)=>executeAction(equippedFighterState(),{effects:[{resolution:'auto',result:[{kind:'grant_effect',value:'runtime'}]}]},
 {character:FIGHTER_CTX_EQUIPPED,rng:()=>.5,grantedEffects:{runtime:effect(payloads,amount)}}).state;
describe('temporary character capabilities',()=>{
 it.each(['str','wis'] as const)('allows a declared fixed %s score to lower an ability and restores baseline when removed',ability=>{
  const initial={...FIGHTER_CTX_EQUIPPED,abilityScores:{...FIGHTER_CTX_EQUIPPED.abilityScores,[ability]:18}};
  const policy={kind:'value_method',target:ability,formula:6,mode:'set'};
  const projected=projectRuntimeCharacter(initial,equippedFighterState(),[policy]);
  expect(projected.abilityScores?.[ability]).toBe(6);expect(projected.abilityMods[ability]).toBe(-2);
  expect(projectRuntimeCharacter({...projected},equippedFighterState(),[]).abilityScores?.[ability]).toBe(18);
 });
 it.each([-1,2])('projects proficiency %s once across nested contexts and revokes it cleanly',delta=>{
  const policy={kind:'modifier',op:'add',value:delta,applies_to:{roll:'prof_bonus'}};
  const projected=projectRuntimeCharacter(FIGHTER_CTX_EQUIPPED,equippedFighterState(),[policy]);
  expect(projected.profBonus).toBe(FIGHTER_CTX_EQUIPPED.profBonus+delta);
  expect(projectRuntimeCharacter({...projected},equippedFighterState(),[policy]).profBonus).toBe(projected.profBonus);
  expect(projectRuntimeCharacter({...projected},equippedFighterState()).profBonus).toBe(FIGHTER_CTX_EQUIPPED.profBonus);
 });
 it.each([['str',21],['wis',19]] as const)('projects %s from the active method, including target saves, without changing the build',(ability,value)=>{
  const state=cast([{kind:'value_method',target:ability,formula:String(value)}]);
  const base={...FIGHTER_CTX_EQUIPPED,abilityScores:{[ability]:10},abilityMods:{...FIGHTER_CTX_EQUIPPED.abilityMods,[ability]:0}};
  const context=runtimeActionContext(state,{}, {character:base,rng:()=>.5,target:{runtimeState:state,characterContext:base}});
  expect(context.character.abilityMods[ability]).toBe(Math.floor((value-10)/2));
  expect(context.target?.characterContext?.abilityMods[ability]).toBe(Math.floor((value-10)/2));
  expect(base.abilityMods[ability]).toBe(0);
  expect(projectRuntimeCharacter(base,{...state,activeEffects:[]}).abilityMods[ability]).toBe(0);
 });
 it.each([['fly',60],['climb','character_speed']] as const)('makes %s available to actual combat movement and revokes on expiry',(mode,value)=>{
  const state=cast([{kind:'grant_speed',mode,value}]);
  const actor={character:FIGHTER_CTX_EQUIPPED,runtime:state,passives:[]} as unknown as ActorState;
  expect(combatActorMovementSpeeds(actor)[mode]).toBe(value==='character_speed'?combatActorMovementSpeeds(actor).walk:value);
  expect(combatActorMovementSpeeds({...actor,runtime:{...state,activeEffects:[]}})[mode]).toBe(0);
 });
 it('rolls duration once and shares it across effects, surviving serialization',()=>{
  const rng=vi.fn(()=>.5);
  const result=executeAction(equippedFighterState(),{formula_bindings:{hours:'1d4'},effects:[{resolution:'auto',result:[
   {kind:'modifier',op:'add',value:1,applies_to:{roll:'size'},duration:{type:'hours',amount:'hours'}},
   {kind:'modifier',op:'advantage',applies_to:{roll:'ability_check'},duration:{type:'hours',amount:'hours'}},
  ]}]},{character:FIGHTER_CTX_EQUIPPED,rng});
  expect(rng).toHaveBeenCalledTimes(1);
  expect(result.state.activeEffects.map(entry=>entry.roundsLeft)).toEqual([1800,1800]);
  const restored=JSON.parse(JSON.stringify(result.state));
  expect(startTurn(restored).state.activeEffects.map(entry=>entry.roundsLeft)).toEqual([1799,1799]);
 });
 it.each([['action',1],['custom_pool',3]] as const)('adds and expires a %s capacity while preserving spent charges',(id,amount)=>{
  const state=cast([{kind:'resource',op:'grant',id,amount}],1);
  const baseline=equippedFighterState().maxResources[id]??0;
  expect(state.maxResources[id]).toBe(baseline+amount);
  const spent={...state,resources:{...state.resources,[id]:0}};
  expect(reconcileTemporaryResourceGrants(spent,JSON.parse(JSON.stringify(spent)))).toEqual(spent);
  const expired=startTurn(JSON.parse(JSON.stringify(spent)),FIGHTER_CTX_EQUIPPED).state;
  expect(expired.maxResources[id]).toBe(baseline);
  expect(expired.resources[id]).toBe(id==='action'?baseline:0);
 });
});
