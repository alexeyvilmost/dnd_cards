import {describe,expect,it} from 'vitest';
import cards from '../testing/fixtures/item-catalog.cards.json';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import {createWorld,type ActorState,type RuleActionDefinition} from '../rules-core/domain';
import {executeCombatAction,resolvePlayerReaction} from './engine';
import type {SoloCombatState} from './types';
import type {Card} from '../types';

const weapon=cards.find(row=>row.card_number==='CARD-0889')! as unknown as Card;
const raw=related.entities.find(row=>row.card_number==='ACT-item-completion-high-889-hit-teleport')?.patch;
if(!raw?.mechanics)throw Error('Teleport reaction missing');
const reaction:RuleActionDefinition={id:raw.card_number,name:raw.name,kind:'nonSpell',sourceEntityIds:[weapon.id],
 targeting:{minTargets:1,maxTargets:1,rangeFt:10,requiresLineOfSight:true,allowedRelations:['enemy']},mechanics:raw.mechanics};
const attack:RuleActionDefinition={id:'weapon-strike',name:'Weapon strike',kind:'nonSpell',sourceEntityIds:[weapon.id],
 targeting:{minTargets:1,maxTargets:1,rangeFt:10,requiresLineOfSight:true,allowedRelations:['enemy']},
 mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},effects:[{resolution:'attack_roll',ability:'auto',attack_kind:'weapon_melee',on_hit:[{kind:'damage',amount:3,type:'slashing'}]}]}};
function setup():SoloCombatState{
 const actors=['hero','enemy'].map((id):ActorState=>({id,name:id,kind:id==='hero'?'playerCharacter':'monster',controllerId:id,ac:12,
  capabilities:{actionIds:id==='hero'?[attack.id,reaction.id]:[]},
  character:{baseSpeed:30,baseSize:2,abilityScores:{str:16,dex:10,con:10,int:10,wis:10,cha:10},
   abilityMods:{str:3,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:4,
   ...(id==='hero'?{knownCards:[weapon],equippedCards:[weapon]}:{})},
  runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1,item_completion_889_teleport:3},
   maxResources:{action:1,reaction:1,item_completion_889_teleport:3},inventory:id==='hero'?[{cardId:weapon.id,qty:1}]:[],
   equipment:id==='hero'?{main_hand:weapon.id}:{},activeEffects:[]}}));
 const world=createWorld({id:'item-target-teleport',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['hero','enemy'],turnStarted:true};
 return {schemaVersion:1,deathSavesVersion:1,routeCommandVersion:1,characterId:'hero',controlledCharacterIds:['hero'],runtimeRevision:0,world,
  tokens:{hero:{actorId:'hero',position:{x:0,y:0}},enemy:{actorId:'enemy',position:{x:2,y:0}}},
  sideByActorId:{hero:'party',enemy:'enemy'},combatAreas:{},boardRevision:0,
  battleMap:{id:'teleport',name:'Teleport',width:12,height:10,features:[],ambientLight:'bright'},
  catalogActions:[attack,reaction],playerActionIds:[attack.id,reaction.id],certifiedPlayerActionIds:[attack.id,reaction.id],
  opportunityActionIds:{},movementRemainingFt:{hero:30,enemy:30},log:[],outcome:'active',actionPresentation:{}} as unknown as SoloCombatState;
}

describe('target teleport on the tactical board',()=>{
 it('moves the hit target only after a persisted reaction choice',()=>{
  const hit=executeCombatAction({state:setup(),actorId:'hero',actionId:attack.id,targetIds:['enemy'],rng:()=>0.8});
  expect(hit.world.pendingResolution?.type).toBe('event_reaction');
  const reloaded=JSON.parse(JSON.stringify(hit)) as SoloCombatState;
  expect(()=>resolvePlayerReaction(reloaded,{kind:'reaction',actionId:reaction.id,teleportDestination:{x:8,y:0}},()=>0.8))
   .toThrow(/видимое свободное место/);
  expect(reloaded.world.actors.hero.runtime.resources.item_completion_889_teleport).toBe(3);
  const moved=resolvePlayerReaction(reloaded,{kind:'reaction',actionId:reaction.id,teleportDestination:{x:4,y:0}},()=>0.8);
  expect(moved.tokens.enemy.position).toEqual({x:4,y:0});
  expect(moved.tokens.hero.position).toEqual({x:0,y:0});
  expect(moved.world.actors.hero.runtime.resources.item_completion_889_teleport).toBe(2);
  expect(moved.world.pendingResolution).toBeNull();
 });
});
