import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {executeCombatAction,moveActorAlongRoute,declineAdditionalMovement,resumePendingMovement} from './engine';
import {reachableRoutes} from './tacticalGrid';
import type {SoloCombatState} from './types';
type Dict=Record<string,unknown>;
function setup(payloads:Dict[]):SoloCombatState{
 const actors=['hero','enemy'].map((id):ActorState=>({id,name:id,kind:id==='hero'?'playerCharacter':'monster',controllerId:id,ac:10,capabilities:{actionIds:[]},
  character:{baseSpeed:30,baseSize:2,abilityScores:{str:10},abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
  passives:id==='hero'?[{id:'item',effects:[{resolution:'auto',result:payloads}]}]:[],
  runtime:{hp:{current:20,max:20,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},inventory:[],equipment:{},activeEffects:[]}}));
 const world=createWorld({id:'traversal',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['hero','enemy'],turnStarted:true};
 return {schemaVersion:1,deathSavesVersion:1,routeCommandVersion:1,characterId:'hero',controlledCharacterIds:['hero'],runtimeRevision:0,world,
  tokens:{hero:{actorId:'hero',position:{x:0,y:0}},enemy:{actorId:'enemy',position:{x:11,y:9}}},sideByActorId:{hero:'party',enemy:'enemy'},combatAreas:{},boardRevision:0,
  catalogActions:[],playerActionIds:[],certifiedPlayerActionIds:[],opportunityActionIds:{},movementRemainingFt:{hero:30,enemy:30},log:[],outcome:'active',actionPresentation:{}} as unknown as SoloCombatState;
}

function jumpSetup(distance:number,dice:string){
 const state=setup([]),hero=state.world.actors.hero;
 hero.capabilities.actionIds=['jump'];hero.runtime.resources={...hero.runtime.resources,bonus_action:1,jump_charge:1};hero.runtime.maxResources={...hero.runtime.resources};
 hero.character.abilityScores={str:2};
 state.catalogActions=[{id:'jump',name:'Прыжок',kind:'nonSpell',sourceEntityIds:['item-jump'],targeting:{minTargets:0,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']},
 mechanics:{activation:{mode:'active',cost:[{resource:'bonus_action'},{resource:'jump_charge'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'movement',value:'additional',distance,traversal:'jump',on_arrival:[{kind:'area_damage',origin:'self',amount:dice,type:'piercing',radius_ft:5,recipients:'all',exclude_source:true}]}]}]}}];
 state.tokens.enemy.position={x:distance/5+1,y:0};
 return state;
}
describe('additional jump and actual landing consequences',()=>{
 it.each([[15,'2d6',2],[10,'1d4',1]] as const)('moves %s feet before applying its saved arrival rule', (distance,dice,count)=>{
  let rolls=0;const rng=()=>{rolls++;return 0;};
  const before=jumpSetup(distance,dice);
  const declared=executeCombatAction({state:before,actorId:'hero',actionId:'jump',targetIds:[],rng});
  expect(declared.pendingAdditionalMovement).toMatchObject({remainingFt:distance,traversal:'jump'});
  expect(declared.world.actors.hero.runtime.resources.bonus_action).toBe(0);expect(declared.world.actors.hero.runtime.resources.jump_charge).toBe(0);
  expect(declared.world.actors.enemy.runtime.hp.current).toBe(20);expect(rolls).toBe(0);
  const restored:SoloCombatState=JSON.parse(JSON.stringify(declared));
  const destination={x:distance/5,y:0};
  expect(reachableRoutes(restored,'hero',distance).some(route=>route.destination.x===destination.x&&route.destination.y===0)).toBe(true);
  const landed=moveActorAlongRoute({state:restored,actorId:'hero',destination,rng});
  expect(landed.tokens.hero.position).toEqual(destination);expect(landed.world.actors.enemy.runtime.hp.current).toBe(20-count);
  expect(landed.world.actors.hero.runtime.hp.current).toBe(20);expect(landed.movementRemainingFt.hero).toBe(30);
  expect(landed.pendingAdditionalMovement).toBeUndefined();expect(rolls).toBe(count);
  const replay=resumePendingMovement(JSON.parse(JSON.stringify(landed)),()=>{throw Error('replay cannot roll');});
  expect(replay.world.actors.enemy.runtime.hp.current).toBe(20-count);
  expect(()=>executeCombatAction({state:replay,actorId:'hero',actionId:'jump',targetIds:[],rng})).toThrow();
 });
 it('does not land, roll damage, or refund its paid declaration when declined or blocked',()=>{
  const declared=executeCombatAction({state:jumpSetup(15,'2d6'),actorId:'hero',actionId:'jump',targetIds:[],rng:()=>0});
  expect(()=>moveActorAlongRoute({state:declared,actorId:'hero',destination:{x:4,y:0},rng:()=>{throw Error('invalid move');}})).toThrow();
  expect(declared.tokens.hero.position).toEqual({x:0,y:0});expect(declared.world.actors.enemy.runtime.hp.current).toBe(20);
  const declined=declineAdditionalMovement(declared);expect(declined.pendingAdditionalMovement).toBeUndefined();expect(declined.world.actors.hero.runtime.resources.jump_charge).toBe(0);
 });
});
