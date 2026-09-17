import {describe,expect,it,vi} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition} from '../rules-core/domain';
import {InMemoryRulesSession} from '../rules-core/session';
import {spatialFacts,type SoloCombatState} from './types';
import {creatureCoverObstacles} from './creatureCover';
import {projectileTrajectory} from './projectilePreview';
import {previewCombatAttackRoll} from './engine';
import {previewAttackCover,attackCoverLabel} from './attackCoverPreview';
import {combatApproachRoute} from './defaultInteraction';
import {planMonsterTurn} from './monsterAi';

const action:RuleActionDefinition={id:'test.shot',name:'Выстрел',kind:'nonSpell',sourceEntityIds:['test.shot'],
 targeting:{rangeFt:60,minTargets:1,maxTargets:1,requiresLineOfSight:true,allowedRelations:['enemy']},
 mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},effects:[{
  resolution:'attack_roll',vs:'ac',ability:'dex',attack_kind:'weapon_ranged',attack_bonus_override:4,
  on_hit:[{kind:'damage',type:'piercing',amount:'1'}]}]}};
function actor(id:string,size=2):ActorState{return {id,name:id,kind:id==='source'?'playerCharacter':'monster',controllerId:id,ac:15,
 capabilities:{actionIds:[action.id]},character:{baseSize:size,baseSpeed:30,abilityMods:{str:0,dex:3,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
 runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},inventory:[],equipment:{},activeEffects:[]}};}
function setup(size=2){
 const world=createWorld({id:'bodies',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors:[actor('source'),actor('target'),actor('body',size)]});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['source','target','body'],turnStarted:true};
 return {schemaVersion:1,characterId:'source',controlledCharacterIds:['source'],runtimeRevision:0,world,creatureCoverVersion:1,tacticalFootprints:'sized',
  tokens:{source:{actorId:'source',position:{x:0,y:3}},target:{actorId:'target',position:{x:8,y:3}},body:{actorId:'body',position:{x:4,y:3}}},
  sideByActorId:{source:'party',target:'enemy',body:'party'},combatAreas:{},boardRevision:0,
  catalogActions:[action],playerActionIds:[action.id],certifiedPlayerActionIds:[],movementRemainingFt:{source:30},log:[],outcome:'active',actionPresentation:{}} as unknown as SoloCombatState;
}
describe('creature cover shared by attack execution and presentation',()=>{
 it.each([0,1,2,3,4,5])('size %i grants the same cover in both directions',size=>{
  const state=setup(size),before=JSON.stringify(state);
  for(const [from,to] of [['source','target'],['target','source']]){
   const facts=spatialFacts(state,from,to,false);
   expect(facts.cover).toBe(size<2?'half':'total');
   expect(facts.canSeeTarget).toBe(true); // cover is not blindness
   const ray=projectileTrajectory(state,state.tokens[from].position,state.tokens[to].position,1,1,creatureCoverObstacles(state,from,to));
   expect(ray.blocked).toBe(size>=2);
   if(size<2)expect(ray.covered).toHaveLength(1);
  }
  expect(JSON.stringify(state)).toBe(before);
 });
 it('uses the actual large footprint, not only its anchor',()=>{
  const state=setup(4);state.tokens.body.position={x:4,y:1};
  expect(spatialFacts(state,'source','target',false).cover).toBe('total');
  state.world.actors.body.character.baseSize=2;
  expect(spatialFacts(state,'source','target',false).cover).toBe('none');
 });
 it('includes enemies and allies but not the endpoints, defeated actors or off-ray actors',()=>{
  const state=setup();state.sideByActorId!.body='enemy';
  expect(spatialFacts(state,'source','target',false).cover).toBe('total');
  state.tokens.body.position={x:4,y:8};expect(spatialFacts(state,'source','target',false).cover).toBe('none');
  state.tokens.body.position={x:4,y:3};state.world.actors.body.runtime.hp.current=0;
  expect(spatialFacts(state,'source','target',false).cover).toBe('none');
  expect(creatureCoverObstacles(state,'source','target')).toEqual([]);
 });
 it('does not stack two small bodies and respects stronger terrain cover',()=>{
  const state=setup(1);state.world.actors.other=actor('other',0);state.tokens.other={actorId:'other',position:{x:6,y:3},color:'#aaa'};
  expect(spatialFacts(state,'source','target',false).cover).toBe('half');
  state.battleMap={features:[{x:2,y:3,width:1,height:1,cover:'three_quarters'}]} as SoloCombatState['battleMap'];
  expect(spatialFacts(state,'source','target',false).cover).toBe('three_quarters');
 });
 it('preserves archived encounters without the capability',()=>{
  const state=setup();delete state.creatureCoverVersion;
  expect(spatialFacts(state,'source','target',false).cover).toBe('none');
  expect(creatureCoverObstacles(state,'source','target')).toEqual([]);
 });
 it('approaches a position with a clear shot rather than stopping behind a body',()=>{
  const state=setup(),route=combatApproachRoute(state,'source','target',60)!;
  expect(route.costFt).toBeGreaterThan(0);expect(route.available).toBe(true);
  state.tokens.source.position=route.destination;
  expect(spatialFacts(state,'source','target',false).cover).not.toBe('total');
 });
 it.each([0,1,2,4])('authoritative execution validates body size %i before cost/roll',size=>{
  const state=setup(size),rng=vi.fn(()=>.575);
  const session=new InMemoryRulesSession(state.world,{getAction:id=>id===action.id?action:undefined},{rng,clock:()=>1,nextId:()=>''});
  const result=session.dispatch({schemaVersion:1,type:'UseAction',commandId:'shot',expectedRevision:0,rulesetContentHash:'test',actorId:'source',actionId:action.id,targetIds:['target'],factsByTarget:{target:spatialFacts(state,'source','target',false)}});
  if(size>=2){expect(result.status).toBe('rejected');expect(rng).not.toHaveBeenCalled();expect(session.getState().actors.source.runtime.resources.action).toBe(1);}
  else{
   expect(result.status).toBe('accepted');
   if(result.status!=='accepted')throw Error(result.message);
   const roll=result.events.flatMap(e=>e.payload.type==='EngineEventRecorded'&&e.payload.event.type==='roll'?[e.payload.event.roll]:[])[0];
   expect(roll).toMatchObject({total:16,target:{value:17},outcome:'miss'});
  }
 });
 it('AI moves around full body cover; with no movement it does not attack through it',()=>{
  const state=setup();state.movementRemainingFt.target=0;
  state.world.actors.target.character.characterSpeed=0;
  expect(planMonsterTurn(state,state.world.actors.target,'source',60).attacks).toBe(false);
  state.world.actors.target.character.characterSpeed=30;state.movementRemainingFt.target=30;
  const plan=planMonsterTurn(state,state.world.actors.target,'source',60);
  expect(plan.attacks).toBe(true);expect(plan.firstMove.length).toBeGreaterThan(0);
  state.tokens.target.position=plan.firstMove.at(-1)!;
  expect(spatialFacts(state,'target','source',false).cover).not.toBe('total');
 });
 it('attack hover uses +2 from a small body, even on a board without terrain',()=>{
  const state=setup(1),input={state,actorId:'source',actionId:action.id,targetIds:['target']};
  const profile=previewCombatAttackRoll(input);
  expect(profile?.target?.value).toBe(17);
  const cover=previewAttackCover(input,profile);
  expect(cover).toMatchObject({cover:'half',ac:17,baseAc:15,bonus:2});
  expect(attackCoverLabel(cover)).toContain('+2 к КД: 15 → 17');
 });
});
