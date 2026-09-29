import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand} from './domain';
import {createLogicalClock,createSequentialIdFactory,createStrictRngTape} from './determinism';
import {InMemoryRulesSession} from './session';
import {availableActionCostPolicies} from '../engine/actionCostPolicy';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'additional-test',contentHash:'additional-test',errataVersion:'2024'};
function actor(extra:number,cap?:number):ActorState{return {id:'owner',name:'owner',kind:'playerCharacter',controllerId:'owner-controller',ac:10,capabilities:{actionIds:[]},character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2},
 runtime:{hp:{current:10,max:10,temp:0},resources:{action:1,bonus_action:1,reaction:1,extra:1},maxResources:{action:1,bonus_action:1,reaction:1,extra:1},equipment:{},inventory:[],activeEffects:cap?[{id:'restricted',name:'Restricted extra action',source:'test',mechanics:{activation:{mode:'passive'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'extra',amount:1,recharge:'turn'},{kind:'action_cost_policy',id:'restricted',optional:true,match:{action_categories:['attack','dash','disengage','hide','utilize']},replace:{action:'extra'},max_attacks:cap}]}]}}]:[]},
 attackProfile:{attacksPerAction:2,size:2,reachFt:5,graspingParts:['main_hand','off_hand'],sourceEntityIds:['class:extra-attack']},passives:[{kind:'modifier',op:'add',value:extra,applies_to:{roll:'attacks_per_action'}}]};}
type Input=GameCommand extends infer C?C extends GameCommand?Omit<C,'schemaVersion'|'expectedRevision'|'rulesetContentHash'|'actorId'>:never:never;
function accepted(session:InMemoryRulesSession,input:Input){const result=session.dispatch({schemaVersion:1,expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'owner',...input} as GameCommand);if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);return result;}
describe('restricted additional actions and ordinary attack budget',()=>{
 it.each([[1,1],[2,2]])('persists an optional pool and caps attacks at %s',(cap,extra)=>{
  const owner=actor(extra,cap),tape=createStrictRngTape([{label:'first attack after choice',sides:20,value:12}]),env={rng:tape.rng,clock:createLogicalClock(),nextId:createSequentialIdFactory('restricted')},catalog={getAction:()=>undefined};
  let session=new InMemoryRulesSession(createWorld({id:'restricted',ruleset,actors:[owner,{...actor(0),id:'other'}]}),catalog,env);
  accepted(session,{type:'StartEncounter',commandId:'start',initiative:['owner','other']});accepted(session,{type:'StartTurn',commandId:'turn'});
  accepted(session,{type:'BeginAttackAction',commandId:'begin',afterBegin:{type:'PerformUnarmedStrike',option:'damage',targetActorId:'other',facts:{factsSource:'scenario',boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy'}}});expect(tape.consumed()).toBe(0);expect(Object.keys(session.getState().attackActions)).toHaveLength(0);expect(session.getState().actors.owner.runtime.resources.extra).toBe(1);
  session=new InMemoryRulesSession(JSON.parse(JSON.stringify(session.snapshot().world)),catalog,env);
  const pending=session.getState().pendingResolution;if(pending?.type!=='action_cost_policy')throw Error('Missing attack cost choice');
  accepted(session,{type:'ResolveDecision',commandId:'choose',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'action_cost_policy',policyId:'restricted'}});
  const attack=Object.values(session.getState().attackActions)[0];expect(attack.sequence.totalAttacks).toBe(cap);expect(attack.costPolicyIds).toEqual(['restricted']);expect(session.getState().actors.owner.runtime.resources).toMatchObject({action:1,extra:0});expect(session.getState().actors.other.runtime.hp.current).toBe(9);expect(attack.sequence.entries).toHaveLength(1);tape.assertExhausted();
  // The same source cannot purchase a spell or an unclassified action.
  const ctx={state:owner.runtime,character:owner.character,passives:owner.passives??[],actionRefs:[]};
  const mechanics={activation:{cost:[{resource:'action'}]}};
  expect(availableActionCostPolicies(mechanics,{...ctx,spell:{baseLevel:0}})).toEqual([]);expect(availableActionCostPolicies(mechanics,ctx)).toEqual([]);
 });
 it.each([1,2])('uses the ordinary attack budget with modifier %s',extra=>{
  const session=new InMemoryRulesSession(createWorld({id:'normal',ruleset,actors:[actor(extra),{...actor(0),id:'other'}]}),{getAction:()=>undefined},{rng:()=>{throw Error('Must not roll')},clock:createLogicalClock(),nextId:createSequentialIdFactory()});
  accepted(session,{type:'StartEncounter',commandId:'start',initiative:['owner','other']});accepted(session,{type:'StartTurn',commandId:'turn'});accepted(session,{type:'BeginAttackAction',commandId:'begin',selectedCostPolicyId:null});
  expect(Object.values(session.getState().attackActions)[0].sequence.totalAttacks).toBe(2+extra);expect(session.getState().actors.owner.runtime.resources.action).toBe(0);
 });
});
