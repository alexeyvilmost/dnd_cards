import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {compileMechanicsTargeting} from './actionTargeting';
import {handleCommand} from './handler';
import {createSequentialIdFactory} from './determinism';
import {bindItemTool} from './itemTools';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'load',contentHash:'load',errataVersion:'2024'};
const actor:ActorState={id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',ac:10,capabilities:{actionIds:['anchor']},
 character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
 runtime:{hp:{current:10,max:10,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[]}};
const action=(limit:number):RuleActionDefinition=>{
 const mechanics={activation:{mode:'active',cost:[]},primitive:{type:'item_tool',policy:{operation:'anchor',max_load_lb:limit}},
  targeting:{domain:'world',shape:'single',actor_targets:false,min_targets:0,max_targets:0,range_ft:5,requires_line_of_sight:true,allowed_relations:[]},
  effects:[{resolution:'auto',result:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}]};
 return {id:'anchor',name:'Anchor',kind:'nonSpell',sourceEntityIds:[`item-${limit}`],mechanics,targeting:compileMechanicsTargeting(mechanics)};
};

describe('declared physical limits for world-object anchors',()=>{
 it.each([500,4000])('persists a %i-pound anchor and rejects heavier load before mutation',limit=>{
  const definition=action(limit),world=createWorld({id:`load-${limit}`,ruleset,actors:[actor]});
  world.objects.wall={id:'wall',name:'Wall',kind:'environment',size:'large'};
  const facts={factsSource:'scenario' as const,boardRevision:0,distanceFt:5,lineOfSight:true,loadLb:limit};
  expect(()=>bindItemTool(world,definition,{type:'item_tool',objectId:'wall',description:'Anchor',facts:{...facts,loadLb:limit+1}}))
   .toThrow(`Нагрузка превышает предел ${limit}`);
  const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'secure',actorId:'hero',expectedRevision:0,
   rulesetContentHash:'load',actionId:'anchor',targetIds:[],worldInput:{type:'item_tool',objectId:'wall',description:'Anchor',facts}};
  const result=handleCommand(world,command,{getAction:()=>definition},{rng:()=>{throw Error('No roll');},clock:()=>1,nextId:createSequentialIdFactory('load')});
  if(result.status==='rejected')throw Error(result.message);
  expect(result.nextState.objects.wall.toolState?.anchor).toMatchObject({maxLoadLb:limit,sourceActorId:'hero'});
  expect(handleCommand(result.nextState,command,{getAction:()=>definition},{rng:()=>0,clock:()=>1,nextId:createSequentialIdFactory('repeat')}).status).toBe('rejected');
 });
 it('uses the catalog grappling-hook limit',()=>{
  const row=related.entities.find(entry=>entry.card_number==='ACT-item-completion-high-795-anchor');
  expect(row?.patch.mechanics?.primitive).toMatchObject({type:'item_tool',policy:{operation:'anchor',max_load_lb:500}});
 });
});
