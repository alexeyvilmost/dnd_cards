import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {effectRollFacts} from './effectRollFacts';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import {createStrictRngTape} from '../rules-core/determinism';
import type {ExecuteContext} from '../mvp/contracts';
const character={...FIGHTER_CTX_EQUIPPED,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},skillProficiencies:[],skillExpertise:[]};
const state=()=>({...equippedFighterState(),hp:{current:20,max:20,temp:0}});
describe('canonical outcome facts for defensive rolls',()=>{
 it.each([{kind:'movement',value:'push',distance:5},{kind:'movement',value:'pull',distance:15}])('defender applies forced movement advantage for $value',payload=>{
  const tape=createStrictRngTape([{label:'attacker',sides:20,value:12},{label:'defender first',sides:20,value:3},{label:'defender advantage',sides:20,value:18}]);
  const ctx:ExecuteContext={selfId:'owner',character,rng:tape.rng,target:{id:'enemy',ac:10,runtimeState:state(),characterContext:character,checkMods:{athletics:0},passives:[{kind:'modifier',op:'advantage',applies_to:{roll:'ability_check',filter:{against_forced_movement:true}}}]}};
  const result=executeAction(state(),{effects:[{resolution:'ability_check',ability:'str',skill:'athletics',contest_vs:['athletics'],on_success:[payload]}]},ctx);
  expect(result.events.some(event=>event.type==='movement')).toBe(false);tape.assertExhausted();
  const rolls=result.events.filter(event=>event.type==='roll');expect(rolls).toHaveLength(2);
 });
 it.each([2,4])('defender adds a scoped bonus die d%s to resisting disarm',faces=>{
  const tape=createStrictRngTape([{label:'attacker',sides:20,value:12},{label:'defender',sides:20,value:11},{label:'defensive bonus',sides:faces,value:faces}]);
  const target=state();target.equipment={main_hand:'held'};
  const ctx:ExecuteContext={selfId:'owner',character,rng:tape.rng,choices:{hand:'main_hand'},target:{id:'enemy',ac:10,runtimeState:target,characterContext:character,checkMods:{athletics:0},passives:[{kind:'modifier',op:'bonus_die',faces,sign:1,applies_to:{roll:'ability_check',filter:{against_disarm:true}}}]}};
  const result=executeAction(state(),{effects:[{resolution:'ability_check',ability:'str',skill:'athletics',contest_vs:['athletics'],on_success:[{kind:'world_interaction',operation:'drop_held_item',parameters:{choice_id:'hand'}}]}]},ctx);
  expect(result.targetState?.equipment.main_hand).toBe('held');tape.assertExhausted();
 });
 it.each(['sneak_attack','independent_power'])('adds damage only to tagged packet %s before defenses',tag=>{
  const ctx:ExecuteContext={selfId:'owner',character,rng:()=>.5,passives:[{kind:'modifier',op:'add',value:2,applies_to:{roll:'damage',filter:{damage_tag:tag}}}],target:{id:'enemy',ac:10,runtimeState:state(),characterContext:character}};
  const action=(damage_tag?:string)=>({effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:3,type:'force',...(damage_tag?{damage_tag}:{})}]}]});
  expect(executeAction(state(),action(tag),ctx).targetState?.hp.current).toBe(15);
  expect(executeAction(state(),action('unrelated'),ctx).targetState?.hp.current).toBe(17);
 });
 it('does not infer a condition from its label or narrative, and finds nested forced movement',()=>{
  expect(effectRollFacts({name:'Shove prone',result:[{kind:'narrative',description:'push'}]})).toEqual({});
  expect(effectRollFacts({on_fail:[{kind:'choice',options:{items:[{grants:[{kind:'movement',value:'push',distance:5}]}]}}]})).toEqual({against_forced_movement:true});
 });
});
