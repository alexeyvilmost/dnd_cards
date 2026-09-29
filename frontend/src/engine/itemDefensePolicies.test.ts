import {describe,expect,it} from 'vitest';
import {executeAction} from './execute';
import {preventsForcedMovement} from './itemDefensePolicies';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import type {RuntimeState} from '../mvp/contracts';
type Dict=Record<string,unknown>;
const state=():RuntimeState=>({...equippedFighterState(),hp:{current:20,max:20,temp:0}});
const passive=(id:string,payload:Dict)=>({id,activation:{mode:'passive'},effects:[{resolution:'auto',result:[payload]}]});
const attack=(ability:string)=>({effects:[{resolution:'save',ability,dc:15,who:'target',on_fail:[{kind:'damage',amount:9,type:'fire'},{kind:'condition',value:'prone'}],on_success:[{kind:'damage',amount:9,type:'fire',on_success:'half'}]}]});
describe('data-owned item defense policies',()=>{
 it.each(['dex','con'])('all-save protection uses target policy on %s without reducing a failed-save condition',ability=>{
  const protection=passive('cloak',{kind:'save_damage_policy',on_success:'none',on_failure:'half'});
  for(const outcome of ['success','fail'] as const){
   const result=executeAction(state(),attack(ability),{character:FIGHTER_CTX_EQUIPPED,selfId:'attacker',rng:()=>.5,forceSaveOutcome:outcome,
    target:{id:'defender',runtimeState:state(),characterContext:FIGHTER_CTX_EQUIPPED,passives:[protection]}});
   const after=result.targetState??state();
   expect(after.hp.current).toBe(outcome==='success'?20:16);
   expect(after.activeEffects.some(entry=>entry.mechanics.value==='prone')).toBe(outcome==='fail');
  }
 });
 it('a second ability-scoped declaration excludes other saves and attacker-owned defenses',()=>{
  const protection=passive('another-item',{kind:'save_damage_policy',abilities:['dex'],on_success:'none',on_failure:'half'});
  const run=(ability:string,targetPassives:Dict[])=>executeAction(state(),attack(ability),{character:FIGHTER_CTX_EQUIPPED,selfId:'source',passives:[protection],rng:()=>.5,forceSaveOutcome:'fail',target:{id:'target',runtimeState:state(),characterContext:FIGHTER_CTX_EQUIPPED,passives:targetPassives}});
  expect(run('dex',[protection]).targetState?.hp.current).toBe(16);
  expect(run('con',[protection]).targetState?.hp.current).toBe(11);
  expect(run('dex',[]).targetState?.hp.current).toBe(11);
 });
 it.each(['boots','anchoring-effect'])('%s prevents push and pull while keeping ordinary movement',id=>{
  const protection=passive(id,{kind:'movement_policy',forced_movement:'immune'});
  for(const value of ['push','pull','move']){
   const result=executeAction(state(),{effects:[{resolution:'auto',who:'target',result:[{kind:'movement',value,distance:5}]}]},
    {character:FIGHTER_CTX_EQUIPPED,selfId:'source',rng:()=>.5,target:{id:'target',runtimeState:state(),passives:[protection]}});
   expect(result.events.some(event=>event.type==='movement')).toBe(value==='move');
  }
  expect(preventsForcedMovement(state(),[protection])).toBe(true);
  expect(preventsForcedMovement(state(),[])).toBe(false);
 });
});
