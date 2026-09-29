import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition,type GameCommand} from './domain';
import {InMemoryRulesSession} from './session';
import type {Card} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'binding',contentHash:'binding',errataVersion:'2024'};
describe('data owned bound spell recipients',()=>{
 it.each([{capacity:2,bonus:3},{capacity:6,bonus:5}])('shares a real spell effect to $capacity bound recipients with one cost and survives reload',({capacity,bonus})=>{
  const item={id:'provider',name:'Provider',mechanics:{activation:{mode:'passive',while:'equipped'}}} as unknown as Card;
  const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:id==='owner'?['bind','ward']:[]},character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1,knownCards:[item]},runtime:{hp:{current:10,max:10,temp:0},resources:{action:1,spell_slot_1:2},maxResources:{action:1,spell_slot_1:2},equipment:id==='owner'?{amulet:'provider'}:{},inventory:[],activeEffects:[]},passives:id==='owner'?[{kind:'spell_effect_share',binding_key:'segments',spell_refs:['ward']}]:[]});
  const targeting={shape:'multi',domain:'actor',actor_targets:true,range_ft:5,min_targets:0,max_targets:capacity,allowed_relations:['ally'],requires_line_of_sight:false};
  const bind:RuleActionDefinition={id:'bind',name:'Bind',kind:'nonSpell',sourceEntityIds:['provider'],targeting:{minTargets:0,maxTargets:capacity,rangeFt:5,requiresLineOfSight:false,allowedRelations:['ally']},mechanics:{requires_item_source:'provider',recipient_binding:{key:'segments',max_recipients:capacity},targeting,activation:{mode:'active',cost:[]},effects:[{resolution:'auto',who:'target',result:[]}]}};
  const ward:RuleActionDefinition={id:'ward',name:'Ward',kind:'spell',sourceEntityIds:['spell-source'],spell:{level:1},mechanics:{activation:{mode:'active',cost:[{resource:'action'},{resource:'spell_slot',level:1,amount:1}]},effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',op:'add',value:bonus,applies_to:{roll:'ac'},duration:{type:'rounds',amount:2}}]}]}};
  const actors=[actor('owner'),...Array.from({length:capacity},(_,i)=>actor('ally'+i)),actor('unbound')];
  const catalog={getAction:(id:string)=>id==='bind'?bind:id==='ward'?ward:undefined},env={rng:()=>{throw Error('No RNG required');},nextId:()=>'',clock:()=>1};
  let session=new InMemoryRulesSession(createWorld({id:'world',ruleset,actors}),catalog,env);
  const dispatch=(input:Record<string,unknown>)=>{const command={schemaVersion:1,expectedRevision:session.getState().revision,commandId:'c'+session.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'owner',...input} as GameCommand;const result=session.dispatch(command);if(result.status==='rejected')throw Error(result.message);return command;};
  const ids=actors.slice(1,-1).map(a=>a.id),factsByTarget=Object.fromEntries(ids.map(id=>[id,{factsSource:'scenario',boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none',relation:'ally'}]));
  dispatch({type:'UseAction',actionId:'bind',targetIds:ids,factsByTarget});session=new InMemoryRulesSession(JSON.parse(JSON.stringify(session.getState())),catalog,env);
  const last=dispatch({type:'UseAction',actionId:'ward',targetIds:[]});
  for(const id of ids){const effects=session.getState().actors[id].runtime.activeEffects;expect(effects).toHaveLength(1);expect(effects[0]).toMatchObject({roundsLeft:2,ownerId:id,sourceId:'owner',mechanics:{value:bonus},spellOriginId:'ward'});}
  expect(session.getState().actors.unbound.runtime.activeEffects).toHaveLength(0);expect(session.getState().actors.owner.runtime.resources).toMatchObject({action:0,spell_slot_1:1});
  session.dispatch(last);for(const id of ids)expect(session.getState().actors[id].runtime.activeEffects).toHaveLength(1);
  const restored=JSON.parse(JSON.stringify(session.getState()));restored.actors.owner.runtime.resources.action=1;restored.actors.owner.runtime.equipment={};for(const id of ids)restored.actors[id].runtime.activeEffects=[];
  session=new InMemoryRulesSession(restored,catalog,env);dispatch({type:'UseAction',actionId:'ward',targetIds:[]});for(const id of ids)expect(session.getState().actors[id].runtime.activeEffects).toHaveLength(0);
 });
});
