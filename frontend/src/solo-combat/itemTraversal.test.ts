import {FIGHTER_CTX_EQUIPPED,equippedFighterState,MECH_WEAPON_ATTACK} from '../mvp/fixtures';
import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {executeCombatAction,moveActor,moveActorAlongRoute,selectCombatMovementMode,selectCombatFacing} from './engine';
import {spatialFacts} from './types';
import {reachableRoutes} from './tacticalGrid';
import {movementCostThroughAreas} from './combatAreas';
import {actorLongJumpFt} from './jump';
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
describe('item traversal on the authoritative combat board',()=>{
 it.each([4,6])('uses persisted target facing for a data-owned d%s rear attack rider',faces=>{
  const state=setup([]),hero=state.world.actors.hero;
  hero.character={...FIGHTER_CTX_EQUIPPED,baseSpeed:30};hero.runtime=equippedFighterState();hero.runtime.resources.heroic_inspiration=0;hero.capabilities.actionIds=['rear'];
  hero.passives=[{name:'Rear weapon',effects:[{resolution:'auto',result:[
   {kind:'modifier',op:'add',value:1,applies_to:{roll:'attack',filter:{weaponId:hero.runtime.equipment.main_hand}},when:[{kind:'target_nearby_enemies',min:1,range_ft:5}]},
   {kind:'damage_rider',trigger:'hit_by_attack_roll',dice:`1d${faces}`,type:'slashing',filter:{attackFromBehind:true,weaponId:hero.runtime.equipment.main_hand},duration:{type:'while_active'}},
  ]}]}];
  state.catalogActions=[{id:'rear',name:'Rear attack',kind:'nonSpell',sourceEntityIds:['rear-weapon'],mechanics:MECH_WEAPON_ATTACK,targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']}}];
  state.tokens.enemy.position={x:1,y:0};state.tokens.enemy.facing='e';
  const restored:SoloCombatState=JSON.parse(JSON.stringify(selectCombatFacing(state,'hero','n')));
  expect(spatialFacts(restored,'hero','enemy').attackFromBehind).toBe(true);
  const rear=executeCombatAction({state:restored,actorId:'hero',actionId:'rear',targetIds:['enemy'],rng:()=>.5});
  const trace=rear.log.flatMap(row=>row.records??[]).flatMap(row=>row.event?[row.event]:[]);
  expect(trace.filter(event=>event.type==='damage')).toHaveLength(2);
  expect(trace.some(event=>event.type==='roll'&&event.roll.kind==='d20'&&event.roll.modifiers.some(mod=>mod.source==='Rear weapon'&&mod.value===1))).toBe(true);
  expect(rear.tokens.hero.facing).toBe('e');expect(rear.tokens.enemy.facing).toBe('e');
  restored.tokens.enemy.facing='w';expect(spatialFacts(restored,'hero','enemy').attackFromBehind).toBe(false);
  const front=executeCombatAction({state:restored,actorId:'hero',actionId:'rear',targetIds:['enemy'],rng:()=>.5});
  expect(front.log.flatMap(row=>row.records??[]).filter(row=>row.event?.type==='damage')).toHaveLength(1);
  expect(()=>selectCombatFacing(state,'enemy','w')).toThrow();
 });
 it.each([1,2])('grants all current allies a stationary +%s effect and records its removal on movement',bonus=>{
  const initial=setup([]);initial.world.actors.ally={...initial.world.actors.enemy,id:'ally',name:'Ally',controllerId:'hero',kind:'playerCharacter',runtime:{...initial.world.actors.enemy.runtime,activeEffects:[]}};initial.tokens.ally={actorId:'ally',position:{x:2,y:1},color:'#fff'};initial.sideByActorId!.ally='party';initial.movementRemainingFt.ally=30;
  initial.world.actors.hero.grantedEffects={stationary:{id:'stationary',name:'Stationary',mechanics:{activation:{mode:'passive'},end_triggers:['actor_moves'],effects:[{resolution:'auto',result:[{kind:'modifier',op:'add',value:bonus,applies_to:{roll:'ac'}}]}]}}};
  initial.world.actors.hero.capabilities.actionIds=['banner'];initial.catalogActions=[{id:'banner',name:'Banner',kind:'nonSpell',sourceEntityIds:['item'],mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'area_effect',all_scene:true,recipients:'allies',effects:[{kind:'grant_effect',value:'stationary'}]}]}]}}];
  const granted=executeCombatAction({state:initial,actorId:'hero',actionId:'banner',targetIds:[],rng:()=>{throw Error('no RNG');}});
  expect(granted.world.actors.ally.runtime.activeEffects.some(e=>e.entityRef?.id==='stationary')).toBe(true);expect(granted.world.actors.enemy.runtime.activeEffects).toHaveLength(0);
  const restored:SoloCombatState=JSON.parse(JSON.stringify(granted));const moved=moveActor({state:restored,actorId:'ally',destination:{x:3,y:1},voluntary:false,maxFeet:5});
  expect(moved.world.actors.ally.runtime.activeEffects).toHaveLength(0);expect(moved.log.flatMap(row=>row.records??[]).some(row=>row.event?.type==='effect_expired')).toBe(true);
 });

 it.each([5,10])('commits random-direction displacement %s once, without voluntary movement cost',distance=>{
  const initial=setup([]);initial.tokens.hero.position={x:4,y:4};initial.world.actors.hero.runtime.resources.bonus_action=1;initial.world.actors.hero.runtime.maxResources.bonus_action=1;initial.world.actors.hero.capabilities.actionIds=['random-push'];
  initial.catalogActions=[{id:'random-push',name:'Push',kind:'nonSpell',sourceEntityIds:['item'],mechanics:{activation:{mode:'active',cost:[{resource:'bonus_action'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'movement',value:'push',distance,direction:'random_compass'}]}]}}];
  let draws=0;const next=executeCombatAction({state:initial,actorId:'hero',actionId:'random-push',targetIds:[],rng:()=>{draws++;return .26;}});
  expect(next.tokens.hero.position).toEqual({x:4+distance/5,y:4});expect(draws).toBe(1);expect(next.movementRemainingFt.hero).toBe(30);
  const restored:SoloCombatState=JSON.parse(JSON.stringify(next));expect(()=>executeCombatAction({state:restored,actorId:'hero',actionId:'random-push',targetIds:[],rng:()=>{throw Error('replay RNG');}})).toThrow();
  expect(restored.world.actors.hero.runtime.resources.bonus_action).toBe(0);
 });

 it.each([{environment:{requires_breathing:'water' as const},payload:{kind:'environment_adaptation',breathing:['water']}},{environment:{passage:'gap' as const,requires_weightless:true},payload:{kind:'environment_adaptation',can_pass_gaps:true,weightless:true}}])('uses explicit environment facts in both preview and the movement command',({environment,payload})=>{
  const initial=setup([]);initial.battleMap={id:'adaptation',name:'Adaptation',description:'',width:12,height:10,maxActors:2,maxFootprint:1,background:'',features:[
   {id:'passage',name:'Passage',x:1,y:0,width:1,height:1,sprite:'wall',blocksMovement:environment.passage==='gap',environment},
   {id:'solid',name:'Solid wall',x:2,y:0,width:1,height:1,sprite:'wall',blocksMovement:true},
  ]};
  expect(reachableRoutes(initial,'hero',5).some(r=>r.destination.x===1&&r.destination.y===0)).toBe(false);
  initial.world.actors.hero.runtime.activeEffects=[{id:'adaptation',name:'Adaptation',source:'Potion',roundsLeft:600,mechanics:payload}];
  expect(reachableRoutes(initial,'hero',5).some(r=>r.destination.x===1&&r.destination.y===0)).toBe(true);
  const moved=moveActor({state:JSON.parse(JSON.stringify(initial)),actorId:'hero',destination:{x:1,y:0}});
  expect(moved.tokens.hero.position.x).toBe(1);expect(()=>moveActor({state:moved,actorId:'hero',destination:{x:2,y:0}})).toThrow();
  initial.world.actors.hero.runtime.activeEffects[0].roundsLeft=0;
  expect(()=>moveActor({state:initial,actorId:'hero',destination:{x:1,y:0}})).toThrow();
 });
 it.each([5,10])('charges difficult terrain on crossing an enemy aura radius %i, but not an ally or an expired source',radius=>{
  const initial=setup([]);initial.tokens.enemy.position={x:radius/5+1,y:0};
  initial.world.actors.enemy.runtime.activeEffects=[{id:'aura',name:'Aura',source:'Armor',roundsLeft:2,mechanics:{kind:'aura',radius_ft:radius,recipients:'enemies',effects:[{kind:'movement_policy',difficult_terrain:true}]}}];
  const route=reachableRoutes(initial,'hero',30).find(r=>r.destination.x===1&&r.destination.y===0);
  expect(route?.costFt).toBe(10);expect(moveActor({state:initial,actorId:'hero',destination:{x:1,y:0}}).movementRemainingFt.hero).toBe(20);
  initial.sideByActorId!.enemy='party';expect(reachableRoutes(initial,'hero',30).find(r=>r.destination.x===1&&r.destination.y===0)?.costFt).toBe(5);
  initial.sideByActorId!.enemy='enemy';initial.world.actors.enemy.runtime.activeEffects[0].roundsLeft=0;
  expect(reachableRoutes(initial,'hero',30).find(r=>r.destination.x===1&&r.destination.y===0)?.costFt).toBe(5);
 });

 it.each([5,10])('recoil moves the declared self and target away from each other by %s',distance=>{
  const initial=setup([]);initial.tokens.hero.position={x:4,y:0};initial.tokens.enemy.position={x:6,y:0};initial.world.actors.hero.capabilities.actionIds=['recoil'];
  initial.catalogActions=[{id:'recoil',name:'Recoil',kind:'nonSpell',sourceEntityIds:['recoil-source'],targeting:{minTargets:1,maxTargets:1,rangeFt:30,requiresLineOfSight:true,allowedRelations:['enemy']},mechanics:{effects:[
   {resolution:'auto',who:'self',result:[{kind:'movement',value:'push',distance}]},
   {resolution:'auto',who:'target',result:[{kind:'movement',value:'push',distance}]},
  ]}}];
  const after=executeCombatAction({state:initial,actorId:'hero',actionId:'recoil',targetIds:['enemy'],rng:()=>.5});
  expect(after.tokens.hero.position).toEqual({x:4-distance/5,y:0});expect(after.tokens.enemy.position).toEqual({x:6+distance/5,y:0});
  expect(after.movementRemainingFt.hero).toBe(30);expect(after.world.actors.hero.runtime.turnMovementFt).toBeUndefined();
 });
 it.each([5,10])('awards %s movement after real exhaustion once per turn and persists the unsuccessful/successful roll',bonus=>{
  const trigger={kind:'triggered_effect',id:'exhaustion-'+bonus,event:'movement_exhausted',subject:'self',duration:{type:'while_active'},
   occurrence:{at:1,per:'turn'},chance:{die:4,equals:[4]},effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',op:'add',value:bonus,applies_to:{roll:'speed'},duration:{type:'until_end_of_turn'}}]}]};
  const initial=setup([trigger]);initial.movementRemainingFt.hero=5;
  let rolls=0;
  const first=moveActor({state:initial,actorId:'hero',destination:{x:1,y:0},rng:()=>{rolls++;return .99;}});
  expect(first.movementRemainingFt.hero).toBe(bonus);expect(rolls).toBe(1);
  const restored=JSON.parse(JSON.stringify(first));restored.movementRemainingFt.hero=5;
  const second=moveActor({state:restored,actorId:'hero',destination:{x:2,y:0},rng:()=>{rolls++;return .99;}});
  expect(second.movementRemainingFt.hero).toBe(0);expect(rolls).toBe(1);
  const forced=moveActor({state:initial,actorId:'hero',destination:{x:1,y:0},voluntary:false,maxFeet:5,rng:()=>{throw Error('forced movement cannot roll');}});
  expect(forced.world.actors.hero.runtime.eventOccurrences).toBeUndefined();
 });

 it.each([5,10])('spends %s real board movement for an attack and keeps the cost after reload',cost=>{
  const state=setup([]),hero=state.world.actors.hero;
  hero.character={...FIGHTER_CTX_EQUIPPED,baseSpeed:30};hero.runtime=equippedFighterState();hero.runtime.resources.heroic_inspiration=0;hero.capabilities.actionIds=['costed-attack'];
  hero.passives=[{kind:'weapon_attack_policy',weapon_id:hero.runtime.equipment.main_hand,movement_cost_ft:cost}];
  state.catalogActions=[{id:'costed-attack',name:'Attack',kind:'nonSpell',sourceEntityIds:['test:weapon'],mechanics:MECH_WEAPON_ATTACK,
   targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']}}];
  state.tokens.enemy.position={x:1,y:0};
  const next=executeCombatAction({state,actorId:'hero',actionId:'costed-attack',targetIds:['enemy'],rng:()=>.5});
  expect(next.movementRemainingFt.hero).toBe(30-cost);
  const restored:SoloCombatState=JSON.parse(JSON.stringify(next));
  restored.world.actors.hero.runtime.resources.action=1;restored.movementRemainingFt.hero=cost-1;
  expect(()=>executeCombatAction({state:restored,actorId:'hero',actionId:'costed-attack',targetIds:['enemy'],rng:()=>.5})).toThrow();
  expect(restored.movementRemainingFt.hero).toBe(cost-1);
 });
 it.each([[{kind:'modifier',op:'add',value:5,applies_to:{roll:'jump_distance'}},10],[{kind:'movement_policy',standing_jump:true},10]] as const)('permits a ten-foot jump with either independently declared rule',(payload,distance)=>{
  const initial=selectCombatMovementMode(setup([payload]),'hero','jump');
  expect(reachableRoutes(initial,'hero',30).some(route=>route.destination.x===2&&route.destination.y===0)).toBe(true);
  const moved=moveActorAlongRoute({state:JSON.parse(JSON.stringify(initial)),actorId:'hero',destination:{x:2,y:0},rng:()=>.5});
  expect(moved.tokens.hero.position).toEqual({x:2,y:0});
  expect(moved.movementRemainingFt.hero).toBe(20);
  expect(moved.world.actors.hero.runtime.turnMovementFt).toBe(distance);
  expect(moved.recentStraightMovementByActor?.hero.interrupted).toBe(true);
  expect(()=>moveActorAlongRoute({state:selectCombatMovementMode(setup([]),'hero','jump'),actorId:'hero',destination:{x:2,y:0}})).toThrow();
 });
 it('requires a real straight ten-foot run-up in the same direction and rejects forged excessive direct jumps',()=>{
  const actor=setup([]).world.actors.hero,from={x:2,y:0},to={x:4,y:0};
  const runup={from:{x:0,y:0},to:from,direction:{x:1 as const,y:0 as const},distanceFt:10,round:1};
  expect(actorLongJumpFt(actor,from,to,runup,1)).toBe(10);
  expect(actorLongJumpFt(actor,from,{x:0,y:0},runup,1)).toBe(5);
  expect(actorLongJumpFt(actor,from,to,runup,2)).toBe(5);
  expect(()=>moveActor({state:selectCombatMovementMode(setup([]),'hero','jump'),actorId:'hero',destination:{x:3,y:0},maxFeet:100})).toThrow(/Прыжок/);
 });
 it.each([2,3])('uses the same ×%i difficult-terrain modifier in preview and execution',factor=>{
  const state=setup([{kind:'modifier',op:'multiply',value:factor,applies_to:{roll:'movement_cost',filter:{terrain:'difficult'}}}]);
  state.combatAreas={mud:{id:'mud',cells:[{x:0,y:0},{x:1,y:0}],difficultTerrain:true}} as unknown as SoloCombatState['combatAreas'];
  const route=reachableRoutes(state,'hero',100).find(r=>r.destination.x===1&&r.destination.y===0);
  expect(route?.costFt).toBe(10*factor);
  expect(movementCostThroughAreas(state,{x:0,y:0},{x:1,y:0},5,'hero')).toBe(10*factor);
 });
 it('forced movement cannot bypass protection through the direct board method',()=>{
  const state=setup([{kind:'movement_policy',forced_movement:'immune'}]);
  const after=moveActor({state,actorId:'hero',destination:{x:1,y:0},voluntary:false,maxFeet:5});
  expect(after.tokens).toEqual(state.tokens);expect(after.movementRemainingFt).toEqual(state.movementRemainingFt);
 });
});
