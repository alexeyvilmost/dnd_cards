import {describe,it,expect,vi} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {prepareCombatDeathSave,resolveCombatDeathSave,autoResolveSystemDecisions,advanceTurn,combatRollInfluences,executeCombatAction,finalizeCombatOutcome} from './engine';
import {projectRoguelikePartyCombatPatch} from '../roguelike/combatInitialization';
import type {ForgeCharacter} from '../character/types';
import {emptyDeathSaves} from '../engine/deathSaves';
import {type SoloCombatState} from './types';
import {stepRoguelikeCombat} from '../roguelike/combatWorker';
import {shouldShowSoloCombatOutcome} from './outcomeVisibility';

function setup():SoloCombatState {
 const actors=['hero','ally','enemy'].map((id):ActorState=>({id,name:id,kind:id==='enemy'?'monster':'playerCharacter',controllerId:id,ac:12,
  capabilities:{actionIds:[]},character:{baseSpeed:30,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
  runtime:{hp:{current:id==='hero'?0:10,max:10,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},inventory:[],equipment:{},activeEffects:[],deathSaves:emptyDeathSaves(),firedThisTurn:['system:death-save-due']}}));
 const world=createWorld({id:'death-test',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['hero','ally','enemy'],turnStarted:true};
 return {schemaVersion:1,deathSavesVersion:1,characterId:'hero',controlledCharacterIds:['hero','ally'],runtimeRevision:0,world,
  tokens:{hero:{actorId:'hero',position:{x:0,y:0}},ally:{actorId:'ally',position:{x:2,y:0}},enemy:{actorId:'enemy',position:{x:5,y:0}}},
  sideByActorId:{hero:'party',ally:'party',enemy:'enemy'},combatAreas:{},boardRevision:0,catalogActions:[],playerActionIds:[],certifiedPlayerActionIds:[],movementRemainingFt:{hero:30,ally:30},log:[],outcome:'active',actionPresentation:{}} as unknown as SoloCombatState;
}
const rng=(natural:number)=>()=> (natural-.5)/20;
const active=(s:SoloCombatState)=>s.world.scene.mode==='encounter'?s.world.scene.initiative[s.world.scene.activeIndex]:'';
describe('persisted combat death-save lifecycle',()=>{
 it.each([['hero',1,0,2],['hero',9,0,1],['ally',10,1,0],['ally',19,1,0]] as const)('%s rolls %i once, with counters persisted', (id,natural,successes,failures)=>{
  const state=setup();state.world.actors[id].runtime.hp.current=0;
  if(state.world.scene.mode==='encounter')state.world.scene.activeIndex=id==='hero'?0:1;
  const random=vi.fn(rng(natural)),before=JSON.stringify(state);
  const pending=prepareCombatDeathSave(state,random);
  expect(random).toHaveBeenCalledTimes(1);expect(pending.pendingDeathSave?.phase).toBe('rolled');
  expect(pending.world.actors[id].runtime.deathSaves).toEqual(emptyDeathSaves());
  expect(prepareCombatDeathSave(structuredClone(pending),random)).toEqual(pending);expect(random).toHaveBeenCalledTimes(1);
  const resolved=resolveCombatDeathSave(structuredClone(pending),undefined,()=>{throw Error('must replay')});
  expect(resolved.world.actors[id].runtime.deathSaves).toMatchObject({successes,failures});
  expect(resolved.pendingDeathSave?.phase).toBe('resolved');
  expect(JSON.stringify(state)).toBe(before);
 });
 it('natural 20 grants 1 HP, resets counters, and preserves the current turn and action',()=>{
  const state=setup();state.world.actors.hero.runtime.deathSaves={...emptyDeathSaves(),successes:1,failures:2};
  const held=prepareCombatDeathSave(state,rng(20));const result=resolveCombatDeathSave(held);
  expect(result.world.actors.hero.runtime.hp.current).toBe(1);expect(result.world.actors.hero.runtime.deathSaves).toEqual(emptyDeathSaves());
  const closed=resolveCombatDeathSave(result);expect(active(closed)).toBe('hero');expect(closed.world.actors.hero.runtime.resources.action).toBe(1);
 });
 it.each(['stable','dead'] as const)('third result sets %s and passes the turn after acknowledgement',kind=>{
  const state=setup();state.world.actors.hero.runtime.deathSaves={...emptyDeathSaves(),successes:kind==='stable'?2:0,failures:kind==='dead'?2:0};
  const held=prepareCombatDeathSave(state,rng(kind==='stable'?12:1));const result=resolveCombatDeathSave(held);
  expect(result.world.actors.hero.runtime.deathSaves?.[kind]).toBe(true);
  const closed=resolveCombatDeathSave(result);expect(active(closed)).toBe(kind==='dead'?'hero':'ally');expect(closed.pendingDeathSave).toBeUndefined();
  expect(closed.outcome).toBe(kind==='dead'?'defeat':'active');
 });
 it('stable and dead participants skip the turn without RNG',()=>{
  for(const key of ['stable','dead'] as const){const state=setup();state.world.actors.hero.runtime.deathSaves![key]=true;
   const roll=vi.fn(()=>.5);expect(active(prepareCombatDeathSave(state,roll))).toBe('ally');expect(roll).not.toHaveBeenCalled();}
 });
 it('offers data-driven inspiration, spends once, and confirms the replacement in the same pending dialog',()=>{
  const state=setup();state.world.actors.hero.runtime.resources.heroic_inspiration=1;
  const held=prepareCombatDeathSave(state,rng(1));const options=combatRollInfluences(held,'hero','save',held.pendingDeathSave!.roll);
  expect(options.length).toBeGreaterThan(0);
  const result=resolveCombatDeathSave(held,options[0].id,rng(20));
  expect(result.world.actors.hero.runtime.hp.current).toBe(1);expect(result.world.actors.hero.runtime.resources.heroic_inspiration).toBe(0);
  expect(()=>resolveCombatDeathSave(result,options[0].id,rng(1))).toThrow('подтверждён');
 });
 it('does not resolve counters from UI input and rejects a duplicate phase before RNG',()=>{
  const state=prepareCombatDeathSave(setup(),rng(1)),hash=`sha256:${'a'.repeat(64)}`;
  const envelope={schemaVersion:1 as const,artifactHash:hash,entropy:{seed:'test',cursor:1},state};
  const intent={type:'death_save' as const,actorId:'hero',phase:'rolled' as const};
  const first=stepRoguelikeCombat(envelope,intent,hash);expect(first.randomValues).toEqual([]);
  expect(()=>stepRoguelikeCombat(first.envelope,intent,hash)).toThrow('изменилось');
  expect(()=>stepRoguelikeCombat(envelope,{type:'end_turn',actorId:'hero'},hash)).toThrow();
 });
 it('automatically opens the death save after StartTurn instead of giving ordinary controls',()=>{
  const state=setup();state.world.scene={mode:'encounter',round:1,activeIndex:2,initiative:['hero','ally','enemy'],turnStarted:true};
  const next=advanceTurn(state,rng(10));expect(next.pendingDeathSave?.actorId).toBe('hero');
  expect(next.pendingDeathSave?.round).toBe(2);expect(active(next)).toBe('hero');
 });
 it('does not roll a death save when the character falls during their own turn',()=>{
  const state=setup();state.world.actors.hero.runtime.firedThisTurn=[];
  const random=vi.fn(rng(1));const next=prepareCombatDeathSave(state,random);
  expect(active(next)).toBe('ally');expect(next.pendingDeathSave).toBeUndefined();expect(random).not.toHaveBeenCalled();
 });
 it('does not announce defeat over an unresolved last-party death save',()=>{
  const state=setup();state.world.actors.ally.runtime.hp.current=0;
  const held=autoResolveSystemDecisions(state,rng(10));expect(held.outcome).toBe('active');expect(held.pendingDeathSave).toBeDefined();
  expect(shouldShowSoloCombatOutcome({...held,outcome:'defeat'})).toBe(false);
 });
 it.each(['healing-herb','restorative-rune'])('healing from %s clears old counters and stability',id=>{
  const state=setup();state.world.scene={mode:'encounter',round:1,activeIndex:1,initiative:['hero','ally','enemy'],turnStarted:true};
  state.world.actors.hero.runtime.deathSaves={...emptyDeathSaves(),stable:true,successes:3,failures:1};
  state.world.actors.ally.capabilities.actionIds=[id];
  state.catalogActions=[{id,name:id,kind:'nonSpell',sourceEntityIds:[id],targeting:{rangeFt:30,minTargets:1,maxTargets:1,allowedRelations:['ally'],requiresLineOfSight:true},
    mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'healing',amount:2}]}]}}];
  const result=executeCombatAction({state,actorId:'ally',actionId:id,targetIds:['hero'],rng:rng(10)});
  expect(result.world.actors.hero.runtime.hp.current).toBe(2);expect(result.world.actors.hero.runtime.deathSaves).toEqual(emptyDeathSaves());
 });
});

describe('party combat conclusion',()=>{
 it.each(['hero','ally'])('death of %s defeats the whole party, despite living allies',id=>{
  const state=setup();state.world.actors[id].runtime.hp.current=0;
  state.world.actors[id].runtime.deathSaves={...emptyDeathSaves(),failures:3,dead:true};
  const before=JSON.stringify(state),next=finalizeCombatOutcome(state);
  expect(next.outcome).toBe('defeat');expect(next.outcomeFinalized).toBe(true);
  expect(next.world.actors[id].runtime.hp.current).toBe(0);
  expect(next.world.actors[id==='hero'?'ally':'hero'].runtime.hp.current).toBeGreaterThan(0);
  expect(JSON.stringify(state)).toBe(before);expect(finalizeCombatOutcome(next)).toBe(next);
 });
 it.each([false,true])('victory restores an unconscious survivor (stable=%s) and resets saves',stable=>{
  const state=setup();state.world.actors.enemy.runtime.hp.current=0;
  state.world.actors.hero.runtime.deathSaves={successes:stable?3:1,failures:2,stable,dead:false};
  const next=finalizeCombatOutcome(state);
  expect(next.outcome).toBe('victory');expect(next.world.actors.hero.runtime.hp.current).toBe(1);
  expect(next.world.actors.hero.runtime.deathSaves).toEqual(emptyDeathSaves());
  expect(next.world.actors.ally.runtime.hp.current).toBe(10);expect(next.world.actors.enemy.runtime.hp.current).toBe(0);
  expect(next.log.at(-1)?.records?.[0]).toMatchObject({actorId:'hero',event:{type:'healing',amount:1}});
  expect(finalizeCombatOutcome(structuredClone(next))).toEqual(next);
 });
 it('death wins over the last enemy dying; no resurrection even with an inconsistent dead flag',()=>{
  const state=setup();state.world.actors.enemy.runtime.hp.current=0;
  state.world.actors.hero.runtime.deathSaves={...emptyDeathSaves(),failures:3};
  const next=finalizeCombatOutcome(state);expect(next.outcome).toBe('defeat');expect(next.world.actors.hero.runtime.hp.current).toBe(0);
 });
 it('no premature recovery while unconscious in an active encounter',()=>{
  const state=setup();expect(finalizeCombatOutcome(state)).toEqual(state);
 });
 it('all stabilized survivors recover when the last enemy is gone',()=>{
  const state=setup();state.world.actors.enemy.runtime.hp.current=0;
  for(const id of ['hero','ally']) {state.world.actors[id].runtime.hp.current=0;state.world.actors[id].runtime.deathSaves={...emptyDeathSaves(),stable:true};}
  const next=finalizeCombatOutcome(state);expect(next.outcome).toBe('victory');
  expect(['hero','ally'].map(id=>next.world.actors[id].runtime.hp.current)).toEqual([1,1]);
 });
 it('held fatal save does not finish the encounter until confirmed, then recovers the surviving ally after acknowledgement',()=>{
  const state=setup();state.world.actors.hero.runtime.deathSaves={...emptyDeathSaves(),failures:2};
  state.world.actors.ally.runtime.hp.current=0;
  const pending=prepareCombatDeathSave(state,rng(1));
  expect(finalizeCombatOutcome(pending).outcome).toBe('active');
  const confirmed=resolveCombatDeathSave(pending);expect(confirmed.outcome).toBe('defeat');
  expect(finalizeCombatOutcome(confirmed).world.actors.ally.runtime.hp.current).toBe(0);
  expect(confirmed.outcomeFinalized).toBeUndefined();
  const done=resolveCombatDeathSave(confirmed);expect(done.outcomeFinalized).toBe(true);
  expect(done.world.actors.ally.runtime.hp.current).toBe(1);expect(done.world.actors.hero.runtime.hp.current).toBe(0);
 });
 it('the worker commits recovery and mirrors it into every personal sheet',()=>{
  const state=setup();state.world.actors.enemy.runtime.hp.current=0;
  const hash=`sha256:${'b'.repeat(64)}`;
  const result=stepRoguelikeCombat({schemaVersion:1,artifactHash:hash,entropy:{seed:'recovery',cursor:0},state},{type:'resume'},hash);
  expect(result.randomValues).toEqual([]);expect(result.envelope.state.outcome).toBe('victory');
  const chars=['hero','ally'].map(id=>({id,runtime_revision:0,turn_state:{}} as ForgeCharacter));
  const projection=projectRoguelikePartyCombatPatch(result.envelope,chars);
  expect(projection.patches.hero.current_hp).toBe(1);expect(projection.patches.ally.current_hp).toBe(10);
 });
});
