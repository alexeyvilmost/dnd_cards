import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {handleCommand} from './handler';
import {createSequentialIdFactory} from './determinism';
import {migrateWorldState} from './worldMigration';

describe('captured magic authority of queued area consequences',()=>{
 it.each(['item','artifact'] as const)('preserves %s origin across reload and rechecks antimagic on area targets',kind=>{
  const ruleset={systemId:'dnd5e-2024' as const,releaseId:'test',contentHash:'test',errataVersion:'test'};
  const actors=['source','protected','open'].map((id):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:['continue']},
   character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
   ...(id==='protected'?{passives:[{effects:[{resolution:'auto',result:[{kind:'aura',radius_ft:5,recipients:'all',include_self:true,effects:[{kind:'magic_suppression'}]}]}]}]}:{}),
   runtime:{hp:{current:10,max:20,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[]}}));
  const initial=createWorld({id:'areas',ruleset,actors});
  const magicOrigin={kind,sourceEntityId:'source-item'};
  initial.areaConsequences=['protected','open'].flatMap(targetActorId=>[
   {id:`heal-${targetActorId}`,targetActorId,effect:{type:'area_healing' as const,sourceActorId:'source',targetIds:[targetActorId],amount:2,magicOrigin}},
   {id:`effect-${targetActorId}`,targetActorId,effect:{type:'area_effect' as const,sourceActorId:'source',targetIds:[targetActorId],magicOrigin,
    effects:[{kind:'modifier',op:'add',value:1,applies_to:{roll:'ac'},duration:{type:'rounds',amount:2}}]}},
  ]);
  const world=migrateWorldState(JSON.parse(JSON.stringify(initial)));
  const action:RuleActionDefinition={id:'continue',name:'Continue',kind:'nonSpell',sourceEntityIds:['system:continue'],mechanics:{activation:{mode:'active',cost:[]},effects:[]}};
  const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'resume',expectedRevision:world.revision,rulesetContentHash:'test',actorId:'source',actionId:'continue',targetIds:[]};
  const result=handleCommand(world,command,{getAction:id=>id==='continue'?action:undefined},{rng:()=>{throw Error('No dice');},nextId:createSequentialIdFactory('area'),clock:()=>1});
  expect(result.status,JSON.stringify(result)).toBe('accepted');if(result.status!=='accepted')throw Error('Rejected');
  expect(result.nextState.actors.protected.runtime.hp.current).toBe(kind==='artifact'?12:10);
  expect(result.nextState.actors.open.runtime.hp.current).toBe(12);
  expect(result.nextState.actors.open.runtime.activeEffects[0].magicOrigin).toEqual(magicOrigin);
  expect(result.nextState.actors.protected.runtime.activeEffects).toHaveLength(kind==='artifact'?1:0);
  expect(result.nextState.areaConsequences??[]).toHaveLength(0);
  expect(handleCommand(result.nextState,command,{getAction:()=>action},{rng:()=>{throw Error('Replay');},nextId:createSequentialIdFactory('replay'),clock:()=>2})).toMatchObject({status:'rejected',code:'DuplicateCommand'});
 });
});
