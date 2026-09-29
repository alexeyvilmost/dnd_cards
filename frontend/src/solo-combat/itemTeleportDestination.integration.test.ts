import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {executeCombatAction} from './engine';
import type {SoloCombatState} from './types';
import {teleportDestinationIssue} from '../rules-core/teleportDestination';
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


describe('teleport destination rules use actual board illumination',()=>{
 it.each(['dark','dim'] as const)('validates a %s destination before paying and preserves arrival through reload',level=>{
  const initial=setup([]),hero=initial.world.actors.hero;
  initial.battleMap={id:'light',name:'Light',width:12,height:10,features:[],ambientLight:level} as unknown as SoloCombatState['battleMap'];
  hero.capabilities.actionIds=['teleport'];hero.runtime.resources.bonus_action=1;hero.runtime.maxResources.bonus_action=1;
  const action={id:'teleport',name:'Teleport',kind:'nonSpell' as const,sourceEntityIds:['item-light'] as [string],targeting:{minTargets:0,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self'] as ['self']},
   mechanics:{activation:{mode:'active',cost:[{resource:'bonus_action'}]},teleport_destination:{illumination:[level]},effects:[{resolution:'auto',who:'self',result:[{kind:'movement',value:'teleport',distance:40}]}]}};
  initial.catalogActions=[action];
  expect(teleportDestinationIssue(action,undefined)).not.toBeNull();
  const lit={...initial,battleMap:{...initial.battleMap!,ambientLight:'bright' as const}};
  expect(()=>executeCombatAction({state:lit,actorId:'hero',actionId:action.id,targetIds:[],worldPosition:{x:8,y:0},rng:()=>{throw Error('no RNG');}})).toThrow(/освещением/);
  expect(lit.world.actors.hero.runtime.resources.bonus_action).toBe(1);
  const next=executeCombatAction({state:initial,actorId:'hero',actionId:action.id,targetIds:[],worldPosition:{x:8,y:0},rng:()=>{throw Error('no RNG');}});
  expect(next.tokens.hero.position).toEqual({x:8,y:0});expect(next.world.actors.hero.runtime.resources.bonus_action).toBe(0);
  const restored=JSON.parse(JSON.stringify(next));expect(()=>executeCombatAction({state:restored,actorId:'hero',actionId:action.id,targetIds:[],worldPosition:{x:7,y:0}})).toThrow();
 });
});
