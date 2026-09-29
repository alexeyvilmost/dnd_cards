import {describe,expect,it} from 'vitest';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import {createWorld,type ActorState,type RuleActionDefinition,type RulesCatalog,type SpatialFacts} from './domain';
import {handleCommand} from './handler';
import {foldEvents} from './reducer';
import {createSequentialIdFactory} from './determinism';
import {teleportDestinationIssue} from './teleportDestination';
import type {Card} from '../types';

const item=cards.find(row=>row.card_number==='CARD-0889')! as unknown as Card;
const rawReaction=related.entities.find(row=>row.card_number==='ACT-item-completion-high-889-hit-teleport')?.patch;
if(!rawReaction?.mechanics)throw Error('Target teleport action missing');
const reaction:RuleActionDefinition={id:rawReaction.card_number,name:rawReaction.name,kind:'nonSpell',
 sourceEntityIds:[item.id],targeting:{minTargets:1,maxTargets:1,rangeFt:10,requiresLineOfSight:true,allowedRelations:['enemy']},
 mechanics:rawReaction.mechanics};
const strike:RuleActionDefinition={id:'weapon-strike',name:'Weapon strike',kind:'nonSpell',sourceEntityIds:[item.id],
 targeting:{minTargets:1,maxTargets:1,rangeFt:10,requiresLineOfSight:true,allowedRelations:['enemy']},
 mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},effects:[{resolution:'attack_roll',ability:'auto',attack_kind:'weapon_melee',on_hit:[{kind:'damage',amount:3,type:'slashing'}]}]}};
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'item-hit-teleport',contentHash:'sha256:item-hit-teleport',errataVersion:'2024'};
const facts:SpatialFacts={factsSource:'board',boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy',canSeeTarget:true};
const actor=(id:string,actionIds:string[]):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds},
 character:{abilityMods:{str:3,dex:0,con:0,int:0,wis:0,cha:0},abilityScores:{str:16,dex:10,con:10,int:10,wis:10,cha:10},profBonus:2,level:4,
  ...(id==='a'?{knownCards:[item],equippedCards:[item]}:{})},
 runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,bonus_action:1,reaction:1,item_completion_889_teleport:3},
  maxResources:{action:1,bonus_action:1,reaction:1,item_completion_889_teleport:3},inventory:id==='a'?[{cardId:item.id,qty:1}]:[],
  equipment:id==='a'?{main_hand:item.id}:{},activeEffects:[]}});

describe('data-owned target teleport after a hit',()=>{
 it('uses another item’s declared destination limit instead of the first weapon’s ten feet',()=>{
  const other:RuleActionDefinition={...reaction,id:'other-weapon-teleport',sourceEntityIds:['other-weapon'],
   mechanics:{...reaction.mechanics,teleport_destination:{relative_to:'target',max_distance_ft:5,requires_visible:true}}};
  expect(teleportDestinationIssue(other,{...facts,teleportDestinationValidated:true,destinationVisible:true,destinationDistanceFt:10}))
   .toMatch(/5 фт/);
  expect(teleportDestinationIssue(other,{...facts,teleportDestinationValidated:true,destinationVisible:true,destinationDistanceFt:5})).toBeNull();
 });
 it('offers a choice only for the hit weapon, validates destination facts, then spends once',()=>{
  const catalog:RulesCatalog={getAction:id=>[strike,reaction].find(row=>row.id===id),getCard:id=>id===item.id?item:undefined};
  let world=createWorld({id:'target-teleport',ruleset,actors:[actor('a',[strike.id,reaction.id]),actor('b',[])]});
  const env={rng:()=>0.8,clock:()=>1,nextId:createSequentialIdFactory('target-teleport')};
  const hit={schemaVersion:1 as const,type:'UseAction' as const,commandId:'hit',expectedRevision:world.revision,
   rulesetContentHash:ruleset.contentHash,actorId:'a',actionId:strike.id,targetIds:['b'],factsByTarget:{b:facts}};
  const result=handleCommand(world,hit,catalog,env);
  expect(result.status,JSON.stringify(result)).toBe('accepted');
  if(result.status!=='accepted')return;
  world=foldEvents(world,result.events);
  expect(world.pendingResolution?.type,JSON.stringify(result.events)).toBe('event_reaction');
  if(world.pendingResolution?.type!=='event_reaction')return;
  const pending=world.pendingResolution;
  const base={schemaVersion:1 as const,type:'ResolveDecision' as const,commandId:'move',expectedRevision:world.revision,
   rulesetContentHash:ruleset.contentHash,actorId:'a',resolutionId:pending.id,requestId:pending.request.id};
  const invalid=handleCommand(world,{...base,response:{kind:'reaction',actionId:reaction.id,
   teleportDestination:{x:1,y:1},teleportDestinationFacts:{...facts,teleportDestinationValidated:true,destinationVisible:true,destinationDistanceFt:15}}},catalog,env);
  expect(invalid.status).toBe('rejected');
  expect(world.actors.a.runtime.resources.item_completion_889_teleport).toBe(3);
  const moved=handleCommand(world,{...base,response:{kind:'reaction',actionId:reaction.id,
   teleportDestination:{x:1,y:1},teleportDestinationFacts:{...facts,teleportDestinationValidated:true,destinationVisible:true,destinationDistanceFt:10}}},catalog,env);
  expect(moved.status,JSON.stringify(moved)).toBe('accepted');
  if(moved.status!=='accepted')return;
  world=foldEvents(world,moved.events);
  expect(world.actors.a.runtime.resources.item_completion_889_teleport).toBe(2);
  expect(moved.events.some(row=>row.payload.type==='EngineEventRecorded'&&row.payload.event.type==='movement'
   &&row.payload.event.mode==='teleport'&&row.payload.event.recipientActorId==='b')).toBe(true);
  expect(handleCommand(world,{...base,expectedRevision:world.revision,response:{kind:'reaction',actionId:reaction.id,
   teleportDestination:{x:1,y:1},teleportDestinationFacts:{...facts,teleportDestinationValidated:true,destinationVisible:true,destinationDistanceFt:10}}},catalog,env).status).toBe('rejected');
 });
});
