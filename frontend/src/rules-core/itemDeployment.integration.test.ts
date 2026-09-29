import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition,type GameCommand} from './domain';
import {handleCommand} from './handler';
import {createStrictRngTape,createSequentialIdFactory} from './determinism';
import {foldEvents} from './reducer';
import type {Card} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'deploy',contentHash:'deploy',errataVersion:'deploy'};
describe('physical item deployment',()=>{
 it.each([{at:'target',held:false},{at:'self',held:true}])('deploys $at from one physical instance, reloads and tears only that item',({at,held})=>{
  const card={id:'net',name:'Net',type:'weapon',slot:'one_hand',mechanics:{activation:{mode:'active',while:'carried'}}} as unknown as Card;
  const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:['deploy','escape']},character:{knownCards:[card],abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},runtime:{hp:{current:20,max:20,temp:0},resources:{action:1},maxResources:{action:1},inventory:id==='a'&&!held?[{cardId:'net',qty:1}]:[],equipment:id==='a'&&held?{main_hand:'net'}:{},activeEffects:[]}});
  const targetId=at==='self'?'a':'b';
  const targeting={minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:false,allowedRelations:['self','enemy'] as const};
  const deploy:RuleActionDefinition={id:'deploy',name:'Deploy',kind:'nonSpell',sourceEntityIds:['net'],targeting:{...targeting,allowedRelations:[...targeting.allowedRelations]},mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:at==='self'?'self':'target',result:[{kind:'world_interaction',operation:'deploy_item',parameters:{card_id:'net',at}}]}]}};
  const escape:RuleActionDefinition={id:'escape',name:'Tear',kind:'nonSpell',sourceEntityIds:['net'],mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'ability_check',ability:'str',dc:10,on_success:[{kind:'world_interaction',operation:'destroy_deployed_item',parameters:{card_id:'net'}}],on_fail:[]}]}};
  const catalog={getAction:(id:string)=>[deploy,escape].find(a=>a.id===id)},tape=createStrictRngTape([{sides:20,value:15,label:'tear'}]),env={rng:tape.rng,nextId:createSequentialIdFactory('net'),clock:()=>1};
  let world=createWorld({id:'net',ruleset,actors:[actor('a'),actor('b')]});
  const run=(input:Record<string,unknown>)=>{const cmd={schemaVersion:1,commandId:`cmd${world.revision}`,expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,actorId:'a',...input} as GameCommand;const result=handleCommand(world,cmd,catalog,env);expect(result.status,JSON.stringify(result)).toBe('accepted');if(result.status!=='accepted')throw Error(result.message);expect(foldEvents(world,result.events)).toEqual(result.nextState);world=result.nextState;return cmd;};
  const command=run({type:'UseAction',actionId:'deploy',targetIds:[targetId],factsByTarget:{[targetId]:{factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true,cover:'none',relation:at==='self'?'self':'enemy'}}});
  expect(world.actors.a.runtime.inventory).toEqual([]);expect(world.actors.a.runtime.equipment.main_hand??null).toBeNull();expect(Object.values(world.objects)).toHaveLength(1);expect(Object.values(world.objects)[0].deployedToActorId).toBe(targetId);
  world=JSON.parse(JSON.stringify(world));expect(handleCommand(world,command,catalog,env).status).toBe('rejected');
  world.actors[targetId].runtime.resources.action=1;
  run({type:'UseAction',actorId:targetId,actionId:'escape',targetIds:[]});expect(Object.values(world.objects)).toHaveLength(0);tape.assertExhausted();
 });
});
