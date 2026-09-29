import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {endTurn} from './turn';
import {availableActionCostPolicies,applyActionCostPolicies} from './actionCostPolicy';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import {createStrictRngTape} from '../rules-core/determinism';
import type {ExecuteContext} from '../mvp/contracts';
const state=()=>({...equippedFighterState(),hp:{current:1,max:20,temp:0}});
describe('generic chance and paid attack contexts',()=>{
 it.each([{die:4,hit:4,pool:'lucky'},{die:6,hit:5,pool:'other'}])('rolls one d$die and grants only a paid success effect',({die,hit,pool})=>{
  for(const result of [1,hit]){
   const tape=createStrictRngTape([{label:'activation chance',sides:die,value:result}]);
   const effect={kind:'grant_effect',value:'EFFECT-chance'};
   const mechanics={activation:{mode:'active',cost:[{resource:'bonus_action'}]},effects:[{resolution:'auto',result:[{kind:'chance',chance:{die,equals:[hit]},on_success:[effect]}]}]};
   const ctx:ExecuteContext={selfId:'owner',character:FIGHTER_CTX_EQUIPPED,rng:tape.rng,grantedEffects:{'EFFECT-chance':{id:'EFFECT-chance',name:'Chance effect',mechanics:{duration:{type:'until_end_of_turn'},activation:{mode:'passive'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:pool,amount:1},{kind:'action_cost_policy',id:pool,optional:true,match:{action_categories:['spell']},replace:{action:pool}}]}]}}}};
   const applied=executeAction(state(),mechanics,ctx);expect(applied.state.resources.bonus_action).toBe(0);expect(applied.state.resources[pool]??0).toBe(result===hit?1:0);tape.assertExhausted();
   if(result===hit){
    const reloaded=JSON.parse(JSON.stringify(applied.state));const policyCtx={state:reloaded,character:ctx.character,passives:[],actionRefs:[],spell:{baseLevel:2}};
    const spell={activation:{cost:[{resource:'action'},{resource:'spell_slot_2'}]}};
    expect(availableActionCostPolicies(spell,policyCtx)).toHaveLength(1);
    expect((applyActionCostPolicies(spell,policyCtx,pool).mechanics.activation as {cost:unknown[]}).cost).toEqual([{resource:pool},{resource:'spell_slot_2'}]);
    expect(endTurn(reloaded,ctx.character).state.maxResources[pool]).toBe(0);
   }
  }
 });
 it.each([1,3])('bonuses only an attack paid with bonus action, including held roll (+%s)',bonus=>{
  const passives=[{kind:'modifier',op:'add',value:bonus,applies_to:{roll:'attack',filter:{bonus_action:true}}}];
  const ctx:ExecuteContext={selfId:'owner',character:FIGHTER_CTX_EQUIPPED,passives,rng:()=>.5,target:{id:'enemy',ac:100,runtimeState:state(),characterContext:FIGHTER_CTX_EQUIPPED}};
  const attack=(resource:string)=>({activation:{mode:'active',cost:[{resource}]},effects:[{resolution:'attack_roll',attack_kind:'weapon_melee',ability:'auto',on_hit:[{kind:'damage',amount:1,type:'slashing'}]}]});
  const normal=executeAction(state(),attack('action'),ctx).events.find(event=>event.type==='roll');
  const held=executeAction(state(),attack('bonus_action'),{...ctx,pauseAfterAttackRoll:true}).events.find(event=>event.type==='roll');
  if(normal?.type!=='roll'||held?.type!=='roll')throw Error('Missing attack');
  expect(held.roll.total-normal.roll.total).toBe(bonus);expect(held.roll.actionCostResources).toEqual(['bonus_action']);
  const resumed=executeAction(state(),{...attack('action'),activation:{mode:'active',cost:[]}},{...ctx,forcedAttackRoll:held.roll});
  const roll=resumed.events.find(event=>event.type==='roll');expect(roll?.type==='roll'&&roll.roll.total).toBe(held.roll.total);
 });
});
