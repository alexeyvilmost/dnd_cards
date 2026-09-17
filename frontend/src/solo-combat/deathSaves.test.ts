import {describe,it,expect,vi} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {prepareCombatDeathSave,resolveCombatDeathSave,autoResolveSystemDecisions,advanceTurn,combatRollInfluences,executeCombatAction} from './engine';
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
  const closed=resolveCombatDeathSave(result);expect(active(closed)).toBe('ally');expect(closed.pendingDeathSave).toBeUndefined();
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
