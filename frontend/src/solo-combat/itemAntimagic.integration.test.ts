import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition} from '../rules-core/domain';
import {handleCommand} from '../rules-core/handler';
import {foldEvents} from '../rules-core/reducer';
import {migrateWorldState} from '../rules-core/worldMigration';
import {projectMagicSuppression} from '../rules-core/magicSuppression';
import {executeCombatAction} from './engine';
import {projectCombatAuras} from './combatAuras';
import {antimagicAt} from './combatAntimagic';
import {createCombatArea,movementCostThroughAreas,queueCombatAreaEvent,decrementSourceAreas} from './combatAreas';
import {spatialFacts,type SoloCombatState} from './types';
import {weaponContext} from '../engine/weapon';
import type {Card} from '../types';

const noRng=()=>{throw Error('Unexpected RNG');};
function setup(radius=10):SoloCombatState{
 const actors=['hero','ward','near','far'].map((id):ActorState=>({id,name:id,kind:id==='hero'?'playerCharacter':'monster',controllerId:id,ac:10,
  capabilities:{actionIds:['cast','teleport']},character:{baseSpeed:30,baseSize:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
  passives:id==='ward'?[{id:'field',magical:true,effects:[{resolution:'auto',result:[{kind:'aura',radius_ft:radius,recipients:'all',include_self:true,effects:[{kind:'magic_suppression'}]}]}]}]:[],
  runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,bonus_action:1,reaction:1},maxResources:{action:1,bonus_action:1,reaction:1},inventory:[],equipment:{},activeEffects:[]}}));
 const world=createWorld({id:'antimagic',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['hero','ward','near','far'],turnStarted:true};
 return {schemaVersion:1,deathSavesVersion:1,routeCommandVersion:1,characterId:'hero',controlledCharacterIds:['hero'],runtimeRevision:0,world,
  tokens:{hero:{actorId:'hero',position:{x:8,y:0}},ward:{actorId:'ward',position:{x:0,y:0}},near:{actorId:'near',position:{x:2,y:0}},far:{actorId:'far',position:{x:6,y:0}}},
  sideByActorId:{hero:'party',ward:'enemy',near:'enemy',far:'enemy'},combatAreas:{},boardRevision:1,catalogActions:[],playerActionIds:[],certifiedPlayerActionIds:[],opportunityActionIds:{},movementRemainingFt:{hero:30,ward:30,near:30,far:30},log:[],outcome:'active',actionPresentation:{},actorPresentation:{},initiative:[],initiativeBonuses:{},resourceBindings:{}} as unknown as SoloCombatState;
}
const cast:RuleActionDefinition={id:'cast',name:'Magic damage',kind:'nonSpell',sourceEntityIds:['magic-source'],
 targeting:{minTargets:1,maxTargets:1,rangeFt:60,requiresLineOfSight:true,allowedRelations:['enemy']},
 mechanics:{magical:true,activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:5,type:'fire'}]}]}};

describe('antimagic uses the actual board and canonical commands',()=>{
 it.each([10,20])('suppresses within %s ft, restores the same effects after reload and preserves duration/concentration',radius=>{
  const original=setup(radius),near=original.world.actors.near;
  near.runtime.activeEffects=[{id:'spell',source:'spell',name:'Haste',magicOrigin:{kind:'spell',sourceEntityId:'haste'},roundsLeft:7,mechanics:{kind:'modifier',applies_to:{roll:'ac'},op:'add',value:2}},
   {id:'artifact',source:'artifact',name:'Artifact',magicOrigin:{kind:'artifact',sourceEntityId:'artifact'},roundsLeft:5,mechanics:{kind:'modifier',applies_to:{roll:'ac'},op:'add',value:1}},
   {id:'concentration',source:'spell',name:'Concentration',mechanics:{kind:'concentration'}}];
  near.passives=[{magical:true,kind:'modifier',applies_to:{roll:'save'},op:'add',value:3},{kind:'modifier',applies_to:{roll:'save'},op:'add',value:1}];
  const projected=projectCombatAuras(original);
  expect(projected.world.actors.near.character.magicSuppressed).toBe(true);
  expect(projected.world.actors.near.runtime.activeEffects[0]).toMatchObject({id:'spell',roundsLeft:7,mechanics:{kind:'suppressed'},suppressedMechanics:{kind:'modifier'}});
  expect(projected.world.actors.near.runtime.activeEffects[1].mechanics.kind).toBe('modifier');
  expect(projected.world.actors.near.runtime.activeEffects[2].mechanics.kind).toBe('concentration');
  expect(projected.world.actors.near.passives![0]).toHaveProperty('antimagicSuppressedMechanics');
  expect(projected.world.actors.near.passives![1]).toHaveProperty('kind','modifier');
  const reloaded=JSON.parse(JSON.stringify(projected)) as SoloCombatState;reloaded.world=migrateWorldState(reloaded.world);
  reloaded.world.actors.near.runtime.activeEffects[0].roundsLeft=6;
  reloaded.tokens.near.position={x:10,y:4};
  const restored=projectCombatAuras(reloaded).world.actors.near;
  expect(restored.character.magicSuppressed).toBe(false);
  expect(restored.runtime.activeEffects[0]).toMatchObject({id:'spell',roundsLeft:6,mechanics:{kind:'modifier',value:2}});
  expect(restored.runtime.activeEffects[0].suppressedMechanics).toBeUndefined();
  expect(restored.passives![0]).toHaveProperty('magical',true);
  expect(antimagicAt(projected,original.tokens.ward.position,'ward')).toBe(true);
 });
 it('rejects both magic from inside and external spells targeting the field before cost or random draws',()=>{
  const initial=setup();initial.catalogActions=[cast];
  expect(()=>executeCombatAction({state:initial,actorId:'hero',actionId:'cast',targetIds:['near'],rng:noRng})).toThrow(/антимагии/);
  expect(initial.world.actors.hero.runtime.resources.action).toBe(1);
  const inside={...initial,tokens:{...initial.tokens,hero:{...initial.tokens.hero,position:{x:1,y:0}}}};
  expect(()=>executeCombatAction({state:inside,actorId:'hero',actionId:'cast',targetIds:['far'],rng:noRng})).toThrow(/антимагии/);
  const world=projectCombatAuras(initial).world;
  const spell:RuleActionDefinition={...cast,kind:'spell',spell:{level:1},mechanics:{...cast.mechanics,magical:undefined}};
  const result=handleCommand(world,{schemaVersion:1,commandId:'spell',expectedRevision:world.revision,rulesetContentHash:'test',type:'UseAction',actorId:'hero',actionId:'cast',targetIds:['near'],factsByTarget:{near:spatialFacts(initial,'hero','near')}},{getAction:()=>spell},{rng:noRng,nextId:()=>'',clock:()=>1});
  expect(result.status).toBe('rejected');if(result.status==='rejected')expect(result.message).toMatch(/антимагии/);
 });
 it('area magic pays once and affects only creatures outside the field',()=>{
  const initial=setup();initial.catalogActions=[{...cast,targeting:{...cast.targeting!,minTargets:0,maxTargets:8},mechanics:{...cast.mechanics,targeting:{shape:'area',range_ft:60,area:{kind:'sphere',radius_ft:20}}}}];
  const result=executeCombatAction({state:initial,actorId:'hero',actionId:'cast',targetIds:['near'],worldPosition:{x:6,y:0},rng:noRng});
  expect(result.world.actors.near.runtime.hp.current).toBe(30);
  expect(result.world.actors.far.runtime.hp.current).toBe(25);
  expect(result.world.actors.hero.runtime.resources.action).toBe(0);
 });
 it('blocks teleport into and out of an empty field cell before payment',()=>{
  const initial=setup();initial.catalogActions=[{id:'teleport',name:'Teleport',kind:'nonSpell',sourceEntityIds:['teleport-source'],targeting:{minTargets:0,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']},
   mechanics:{activation:{mode:'active',cost:[{resource:'bonus_action'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'movement',value:'teleport',distance:60}]}]}}];
  expect(()=>executeCombatAction({state:initial,actorId:'hero',actionId:'teleport',targetIds:[],worldPosition:{x:1,y:1},rng:noRng})).toThrow(/антимагии/);
  const inside={...initial,tokens:{...initial.tokens,hero:{...initial.tokens.hero,position:{x:1,y:1}}}};
  expect(()=>executeCombatAction({state:inside,actorId:'hero',actionId:'teleport',targetIds:[],worldPosition:{x:9,y:1},rng:noRng})).toThrow(/антимагии/);
  expect(inside.world.actors.hero.runtime.resources.bonus_action).toBe(1);
 });
 it('suppresses magical terrain and its hazard while duration continues, without removing the area',()=>{
  let state=setup();
  const action:RuleActionDefinition={...cast,mechanics:{magical:true,targeting:{shape:'area',domain:'world',actor_targets:false,area:{kind:'sphere',radius_ft:20}},effects:[{resolution:'auto',result:[{kind:'world_zone',zone_type:'test',geometry:{shape:'sphere',radius_ft:20},duration:{type:'rounds',amount:4},tactical:{difficult_terrain:true,triggers:['enter'],auto_effects:[{kind:'damage',amount:2,type:'fire'}]}}]}]}};
  const area=createCombatArea({state,action,sourceActorId:'hero',origin:{x:3,y:0}})!;state={...state,combatAreas:{[area.id]:area}};
  expect(area.magicOrigin?.kind).toBe('item');
  expect(movementCostThroughAreas(state,{x:1,y:1},{x:2,y:1},5,'near')).toBe(5);
  expect(movementCostThroughAreas(state,{x:4,y:1},{x:5,y:1},5,'far')).toBe(10);
  expect(queueCombatAreaEvent(state,'enter',['near']).pendingCombatAreaTriggers).toEqual([]);
  expect(queueCombatAreaEvent(state,'enter',['far']).pendingCombatAreaTriggers).toHaveLength(1);
  expect(decrementSourceAreas(state,'hero').combatAreas![area.id].duration).toMatchObject({roundsLeft:3});
 });
 it('records suppression in canonical events and preserves mundane weapon statistics',()=>{
  const state=setup(),near=state.world.actors.near;
  const card={id:'sword',name:'Sword',type:'weapon',mechanics:{magical:true,weapon_profile:{weapon_type:'longsword',proficiency_category:'martial',attack_ability:'str',damage_lines:[{dice:'1d8',type:'slashing'}],default_attack_mode:'melee',attack_modes:[{kind:'melee',reach_ft:5}],properties:[],ammo:null,mastery_effect_id:'mastery:sword',enchantment:{attack_bonus:2,damage_bonus:2,extra_damage_lines:[{dice:'1d4',type:'fire'}]},attunement:{required:false}}}} as unknown as Card;
  near.character.knownCards=[card];near.runtime.equipment.main_hand='sword';
  near.runtime.activeEffects=[{id:'buff',name:'Buff',source:'Buff',magicOrigin:{kind:'spell',sourceEntityId:'buff'},mechanics:{kind:'modifier',applies_to:{roll:'ac'},op:'add',value:1}}];
  const harmless:RuleActionDefinition={...cast,mechanics:{activation:{mode:'active',cost:[]},effects:[]}};
  const result=handleCommand(projectCombatAuras(state).world,{schemaVersion:1,commandId:'ordinary',expectedRevision:0,rulesetContentHash:'test',type:'UseAction',actorId:'hero',actionId:'cast',targetIds:['far'],factsByTarget:{far:spatialFacts(state,'hero','far')}},{getAction:()=>harmless},{rng:noRng,nextId:()=>'',clock:()=>1});
  expect(result.status,JSON.stringify(result)).toBe('accepted');
  const projected=projectMagicSuppression(state.world,(a,b)=>a==='ward'&&b==='near'?10:100);
  const weapon=weaponContext(projected.actors.near.character,'main',near.runtime.equipment,projected.actors.near.runtime)!;
  expect(weapon.damages).toEqual([{dice:'1d8',type:'slashing'}]);
  expect(weapon.enchant).toBe(0);
  if(result.status==='accepted')expect(foldEvents(projectCombatAuras(state).world,result.events)).toEqual(result.nextState);
 });
});
