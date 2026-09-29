import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {handleCommand} from './handler';
import {foldEvents} from './reducer';
import {migrateWorldState} from './worldMigration';
import {createStrictRngTape} from './determinism';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'history',contentHash:'history',errataVersion:'history'};
const facts={factsSource:'scenario' as const,boardRevision:0,distanceFt:5,lineOfSight:true,cover:'none' as const,relation:'enemy' as const};
const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds:['attack','hurt']},
 character:{abilityMods:{str:3,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},runtime:{hp:{current:100,max:100,temp:0},resources:{action:1,reaction:1,bonus_action:1},maxResources:{action:1,reaction:1,bonus_action:1},inventory:[],equipment:{},activeEffects:[]}});
const attack:RuleActionDefinition={id:'attack',name:'Attack',kind:'nonSpell',sourceEntityIds:['weapon'],targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']},
 mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'attack_roll',ability:'str',attack_kind:'melee',on_hit:[{kind:'damage',amount:1,type:'slashing'}]}]}};
const hurt:RuleActionDefinition={...attack,id:'hurt',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:3,type:'fire'}]}]}};
describe('committed history and owned actions at encounter start',()=>{
 it.each([true,false])('uses recorded target damage since the previous completed turn, variant %s',dealt=>{
  const a=actor('a'),b=actor('b');
  a.passives=[{effects:[{resolution:'auto',result:[{kind:'modifier',op:'advantage',applies_to:{roll:'attack'},when:[{kind:'target_damage_since_source_turn',value:dealt}]},
   {kind:'modifier',op:'disadvantage',applies_to:{roll:'attack'},when:[{kind:'target_damage_since_source_turn',value:!dealt}]}]}]}];
  let world=createWorld({id:'history',ruleset,actors:[a,b]});
  const tape=createStrictRngTape([12,4,16,6].map((value,index)=>({sides:20,value,label:`attack-${index}`}))),env={rng:tape.rng,nextId:()=>'',clock:()=>1};
  const catalog={getAction:(id:string)=>id==='attack'?attack:id==='hurt'?hurt:undefined};
  const dispatch=(data:Record<string,unknown>)=>{
   const before=world,command={schemaVersion:1,commandId:`c${world.revision}`,expectedRevision:world.revision,rulesetContentHash:'history',actorId:'a',...data} as GameCommand;
   const result=handleCommand(world,command,catalog,env);expect(result.status,JSON.stringify(result)).toBe('accepted');
   if(result.status!=='accepted')throw Error('Rejected');expect(foldEvents(before,result.events)).toEqual(result.nextState);world=result.nextState;return result;
  };
  dispatch({type:'StartEncounter',initiative:['b','a']});dispatch({type:'StartTurn',actorId:'b'});
  dispatch({type:'UseAction',actorId:'b',actionId:'hurt',targetIds:['a'],factsByTarget:{a:facts}});dispatch({type:'EndTurn',actorId:'b'});
  world=migrateWorldState(JSON.parse(JSON.stringify(world)));dispatch({type:'StartTurn'});
  const first=dispatch({type:'UseAction',actionId:'attack',targetIds:['b'],factsByTarget:{b:facts}});
  const roll=(result:typeof first)=>result.events.flatMap(event=>event.payload.type==='EngineEventRecorded'&&event.payload.event.type==='roll'&&event.payload.event.roll.kind==='d20'?[event.payload.event.roll]:[])[0];
  expect(roll(first).advantage).toBe(dealt?'advantage':'disadvantage');
  dispatch({type:'EndTurn'});dispatch({type:'StartTurn',actorId:'b'});dispatch({type:'EndTurn',actorId:'b'});dispatch({type:'StartTurn'});
  world=migrateWorldState(JSON.parse(JSON.stringify(world)));
  const second=dispatch({type:'UseAction',actionId:'attack',targetIds:['b'],factsByTarget:{b:facts}});
  expect(roll(second).advantage).toBe(dealt?'disadvantage':'advantage');
  expect(world.actors.b.character.combatHistory!.damageDealt).toBeLessThan(world.actors.a.character.combatHistory!.turnEnded);
 });
 it.each([{key:'rage_charge',cost:2,hp:5},{key:'focus',cost:1,hp:8}])('invokes only an available owned $key action and pays its real cost exactly once',spec=>{
  const a=actor('a'),b=actor('b'),c=actor('c');
  const enter:RuleActionDefinition={id:'feature',name:'Feature',kind:'nonSpell',sourceEntityIds:['owned-feature'],targeting:{minTargets:1,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']},
   mechanics:{activation:{mode:'active',cost:[{resource:'bonus_action'},{resource:spec.key,amount:spec.cost}]},effects:[{resolution:'auto',who:'self',result:[{kind:'temp_hp',amount:spec.hp}]}]}};
  for(const candidate of [a,b,c]){
   candidate.passives=[{kind:'automatic_action',event:'encounter_start',action_refs:['owned-feature'],requires_owned:true,target:'self'}];
   candidate.runtime.resources[spec.key]=spec.cost;candidate.runtime.maxResources[spec.key]=spec.cost;
  }
  a.capabilities.actionIds.push('feature');b.capabilities.actionIds.push('feature');b.runtime.resources[spec.key]=0;
  const world=createWorld({id:'auto',ruleset,actors:[a,b,c]}),env={rng:()=>{throw Error('No RNG');},nextId:()=>'',clock:()=>1};
  const command:GameCommand={schemaVersion:1,commandId:'start',expectedRevision:0,rulesetContentHash:'history',actorId:'a',type:'StartEncounter',initiative:['a','b','c']};
  const result=handleCommand(world,command,{getAction:id=>id==='feature'?enter:undefined},env);
  expect(result.status,JSON.stringify(result)).toBe('accepted');if(result.status!=='accepted')return;
  expect(result.nextState.actors.a.runtime.hp.temp).toBe(spec.hp);expect(result.nextState.actors.a.runtime.resources[spec.key]).toBe(0);
  expect(result.nextState.actors.a.runtime.resources.bonus_action).toBe(0);
  expect(result.nextState.actors.b.runtime.hp.temp).toBe(0);expect(result.nextState.actors.c.runtime.hp.temp).toBe(0);
  expect(foldEvents(world,result.events)).toEqual(result.nextState);
  const loaded=migrateWorldState(JSON.parse(JSON.stringify(result.nextState)));
  expect(handleCommand(loaded,command,{getAction:()=>enter},env)).toMatchObject({status:'rejected',code:'DuplicateCommand'});
 });
});
