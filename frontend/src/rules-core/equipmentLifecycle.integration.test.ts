import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type GameCommand} from './domain';
import {handleCommand} from './handler';
import {foldEvents} from './reducer';
import {endEncounter,startEncounter} from '../engine/encounter';
import {collectLifePolicies,actorIsDead} from '../engine/lifePolicies';
import {executeAction} from '../engine/execute';
import {longRest} from '../engine/turn';
import type {Card} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'equipment',contentHash:'equipment',errataVersion:'equipment'};
const listener=(event:string,result:Record<string,unknown>[])=>({kind:'triggered_effect',id:event,event,subject:'self',duration:{type:'while_active'},effects:[{resolution:'auto',who:'self',result}]});
const context={abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2};
describe('equipment and encounter item lifecycle',()=>{
 it.each([{id:'blade',slot:'one_hand',fraction:.5,resource:'spell_slot_1'},{id:'ring',slot:'ring',fraction:.25,resource:'focus'}])('commits $id draw reward and inventory together, without repeating on reload',({id,slot,fraction,resource})=>{
  const card={id,name:id,type:slot==='ring'?'ring':'weapon',slot,mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[listener('equipment_changed',[{kind:'healing',max_hp_fraction:fraction},{kind:'resource',op:'restore',id:resource,restore_all:true}])]}]}} as unknown as Card;
  const actor:ActorState={id:'a',name:'a',kind:'playerCharacter',controllerId:'a',ac:10,capabilities:{actionIds:[]},character:{...context,knownCards:[card]},runtime:{hp:{current:1,max:40,temp:0},resources:{[resource]:0},maxResources:{[resource]:3},inventory:[{cardId:id,qty:1}],equipment:{},activeEffects:[]}};
  const before=createWorld({id:'equipment',ruleset,actors:[actor]});const command:GameCommand={schemaVersion:1,type:'ChangeEquipment',commandId:'equip',expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'a',operation:{equip:id}};
  const env={rng:()=>{throw Error('No dice');},nextId:()=>id,clock:()=>1},catalog={getAction:()=>undefined};
  const result=handleCommand(before,command,catalog,env);expect(result.status,JSON.stringify(result)).toBe('accepted');if(result.status!=='accepted')return;
  expect(foldEvents(before,result.events)).toEqual(result.nextState);const loaded=JSON.parse(JSON.stringify(result.nextState));
  expect(loaded.actors.a.runtime.hp.current).toBe(1+40*fraction);expect(loaded.actors.a.runtime.resources[resource]).toBe(3);expect(loaded.actors.a.runtime.inventory).toEqual([]);
  expect(handleCommand(loaded,command,catalog,env).status).toBe('rejected');expect(loaded.actors.a.runtime.hp.current).toBe(1+40*fraction);
 });
 it.each([-1,-2])('accumulates permanent %s failure-limit changes only once per encounter',delta=>{
  const passives=[listener('encounter_end',[{kind:'life_policy',death_failure_limit_delta:delta,duration:{type:'permanent'},stack_type:'stack'}])];
  const ctx={character:context,selfId:'a',passives,rng:()=>{throw Error('No dice');},nextId:()=>String(Math.random())};
  let state={hp:{current:10,max:40,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[],encounterActive:true} as ActorState['runtime'];
  state=endEncounter(state,ctx).state;expect(collectLifePolicies(state).failureLimit).toBe(Math.max(0,3+delta));
  state=JSON.parse(JSON.stringify(state));expect(endEncounter(state,ctx).state.activeEffects).toHaveLength(1);
  state=endEncounter(startEncounter(state,ctx).state,ctx).state;expect(collectLifePolicies(state).failureLimit).toBe(Math.max(0,3+2*delta));
  expect(actorIsDead({runtime:state})).toBe(false);
  if(delta===-2)expect(actorIsDead({runtime:{...state,hp:{...state.hp,current:0}}})).toBe(true);
 });
 it('blocks healing and rest resurrection except an explicitly allowed canonical spell',()=>{
  const state={hp:{current:0,max:40,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[{id:'restriction',name:'Restriction',source:'Restriction',mechanics:{kind:'life_policy',resurrection_spell_refs:['wish']}}]};
  const action={effects:[{resolution:'auto',who:'self',result:[{kind:'healing',amount:5}]}]};
  const ctx={character:context,selfId:'a',rng:()=>{throw Error('No dice');}};
  expect(executeAction(state,action,ctx).state.hp.current).toBe(0);expect(longRest(state,context).restBenefitsDenied).toBe(true);
  expect(executeAction(state,action,{...ctx,spell:{spellId:'wish',baseLevel:9,castLevel:9}}).state.hp.current).toBe(5);
 });
});
