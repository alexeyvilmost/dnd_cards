import {describe,expect,it} from 'vitest';
import {advanceEventOccurrence,recordTurnMovement,resetEventOccurrences} from './eventOccurrence';
import {collectListeners,isAuto} from './dispatch';
import {evaluateCondition} from './circumstances';
import {forgeToRuntimeState,writeRulesEngineRuntimeTurnState} from '../character/runtime';
import type {ForgeCharacter} from '../character/types';
import type {RuntimeState} from '../mvp/contracts';
const state=():RuntimeState=>({hp:{current:10,max:10,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[]});
describe('data-owned event cadence and observations',()=>{
 it('third hit counts each target separately and persists across sheet reload',()=>{
  const listener={id:'third-hit-ki',occurrence:{at:3,per:'turn' as const,group_by:'target' as const}};
  let runtime=state();
  for(const [target,eligible] of [['a',false],['b',false],['a',false],['a',true],['a',false]] as const){
   const next=advanceEventOccurrence(runtime,listener,{kind:'hit',target});expect(next.eligible).toBe(eligible);runtime=next.state;
   runtime=forgeToRuntimeState({current_hp:10,max_hp:10,turn_state:JSON.parse(JSON.stringify(writeRulesEngineRuntimeTurnState({},runtime)))} as ForgeCharacter);
  }
  expect(advanceEventOccurrence(resetEventOccurrences(runtime,'turn'),listener,{kind:'hit',target:'a'}).ordinal).toBe(1);
  expect(Object.keys(runtime.eventOccurrences!)).toHaveLength(2);
 });
 it('an unrelated every-second lifetime activation survives all rest and combat boundaries',()=>{
  const listener={id:'second-bonus-failure',occurrence:{every:2,per:'lifetime' as const}};
  let runtime=advanceEventOccurrence(state(),listener,{kind:'resource_spent',data:{eventId:'command-1'}}).state;
  expect(advanceEventOccurrence(runtime,listener,{kind:'resource_spent',data:{eventId:'command-1'}}).eligible).toBe(false);
  for(const period of ['turn','round','encounter','short_rest','long_rest'] as const)runtime=resetEventOccurrences(runtime,period);
  const next=advanceEventOccurrence(runtime,listener,{kind:'resource_spent',data:{eventId:'command-2'}});
  expect(next).toMatchObject({eligible:true,ordinal:2});
  expect(advanceEventOccurrence(next.state,{...listener,id:'second-reaction-failure'},{kind:'resource_spent'}).ordinal).toBe(1);
 });
 it('keeps occurrence, optional cost and finite event formula bindings on nested listeners',()=>{
  const payload={kind:'triggered_effect',event:'attacked',subject:'self',optional:true,cost:[{resource:'reaction'}],occurrence:{at:1,per:'round'},effects:[]};
  const [listener]=collectListeners({kind:'attacked',source:'self',data:{amount:7,naturalRoll:18,spellLevel:'99'}},state(),[{effects:[{resolution:'auto',result:[payload]}]}]);
  expect(listener).toMatchObject({optional:true,cost:[{resource:'reaction'}],occurrence:{at:1,per:'round'},formulaVariables:{event_amount:7,event_natural_roll:18}});
  expect(listener.formulaVariables).not.toHaveProperty('event_spell_level');expect(isAuto(listener)).toBe(false);
 });
 it('uses actual travel rather than budget spent and does not infer facts for old snapshots',()=>{
  expect(evaluateCondition({kind:'moved_distance_ft',max:0},{state:state()})).toBe(false);
  const stationary=resetEventOccurrences(state(),'turn');
  expect(evaluateCondition({kind:'moved_distance_ft',max:0},{state:stationary})).toBe(true);
  const travelled=recordTurnMovement(recordTurnMovement(stationary,10),15);
  expect(evaluateCondition({kind:'moved_distance_ft',min:25},{state:travelled})).toBe(true);
  expect(evaluateCondition({kind:'moved_distance_ft',min:30},{state:travelled})).toBe(false);
  expect(stationary.turnMovementFt).toBe(0);
 });
 it('checks natural-roll ranges without trusting absent, string or NaN observations',()=>{
  for(const naturalRoll of [undefined,'19',NaN,18])expect(evaluateCondition({kind:'event_data_number',key:'naturalRoll',min:19,max:20},{event:{kind:'hit',data:{naturalRoll}}})).toBe(false);
  expect(evaluateCondition({kind:'event_data_number',key:'naturalRoll',min:19,max:20},{event:{kind:'hit',data:{naturalRoll:19}}})).toBe(true);
 });
});
