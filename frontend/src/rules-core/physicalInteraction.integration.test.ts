import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type GameCommand} from './domain';
import {InMemoryRulesSession} from './session';
import {createStrictRngTape,createSequentialIdFactory} from './determinism';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'physical',contentHash:'physical',errataVersion:'2024'};
const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds:[]},character:{abilityScores:{str:16,dex:12,con:10,int:10,wis:10,cha:10},abilityMods:{str:3,dex:1,con:0,int:0,wis:0,cha:0},level:1,profBonus:2},runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},equipment:{},inventory:[],activeEffects:[]},attackProfile:{attacksPerAction:1,size:2,reachFt:5,graspingParts:['main_hand','off_hand'],sourceEntityIds:['test-profile']}});
describe('committed physical interaction consequences',()=>{
 it.each([{kind:'grapple' as const,sides:4,value:3},{kind:'shove' as const,sides:6,value:5}])('applies $kind owner damage once after outcome through reload',({kind,sides,value})=>{
  const source=actor('source'),target=actor('target');
  source.passives=[{kind:'triggered_effect',id:'physical-test-'+kind,event:'physical_interaction',subject:'self',duration:{type:'while_active'},effects:[{resolution:'auto',who:'target',result:[{kind:'damage',dice:'1d'+sides,type:'bludgeoning',suppress_damage_modifiers:true}]}]}];
  const tape=createStrictRngTape([{label:'physical damage',sides,value}]);const env={rng:tape.rng,nextId:createSequentialIdFactory(),clock:()=>1},catalog={getAction:()=>undefined};
  let session=new InMemoryRulesSession(createWorld({id:'test',ruleset,actors:[source,target]}),catalog,env);
  const dispatch=(input:Record<string,unknown>)=>{const cmd={schemaVersion:1,commandId:'cmd-'+session.getState().revision,expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'source',...input} as GameCommand;const result=session.dispatch(cmd);if(result.status==='rejected')throw Error(result.message);return cmd;};
  dispatch({type:'StartEncounter',initiative:['source','target']});dispatch({type:'StartTurn'});
  dispatch({type:'BeginAttackAction'});const attackAction=Object.values(session.getState().attackActions)[0];
  dispatch({type:'PerformUnarmedStrike',attackActionId:attackAction.id,targetActorId:'target',option:kind,facts:{factsSource:'scenario',boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy'}});
  expect(session.getState().actors.target.runtime.hp.current).toBe(30);
  session=new InMemoryRulesSession(JSON.parse(JSON.stringify(session.getState())),catalog,env);let pending=session.getState().pendingResolution!;
  let last=dispatch({type:'ResolveDecision',actorId:'target',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'voluntary_fail'}});
  if(kind==='shove'){expect(session.getState().actors.target.runtime.hp.current).toBe(30);pending=session.getState().pendingResolution!;last=dispatch({type:'ResolveDecision',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'shove_outcome',outcome:'prone'}});}
  expect(session.getState().actors.target.runtime.hp.current).toBe(30-value);expect(session.getState().actors.source.runtime.hp.current).toBe(30);
  session.dispatch(last);expect(session.getState().actors.target.runtime.hp.current).toBe(30-value);tape.assertExhausted();
 });
});
