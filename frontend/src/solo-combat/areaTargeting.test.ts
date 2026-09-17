import {describe,it,expect,vi} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition} from '../rules-core/domain';
import {executeCombatAction,selectedTargetsForAction,autoResolveSystemDecisions} from './engine';
import {spatialFacts,type SoloCombatState} from './types';
import {stepRoguelikeCombat} from '../roguelike/combatWorker';

function actor(id:string,size=1):ActorState{return {id,name:id,kind:id==='caster'?'playerCharacter':'monster',controllerId:id,ac:12,
 capabilities:{actionIds:['area']},character:{baseSize:size,baseSpeed:30,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
 runtime:{hp:{current:20,max:20,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},inventory:[],equipment:{},activeEffects:[]}};}
function setup(kind='sphere',damage='acid'){
 const action:RuleActionDefinition={id:'area',name:`Test ${kind} ${damage}`,kind:'nonSpell',sourceEntityIds:['test'],
  targeting:{rangeFt:60,minTargets:1,maxTargets:8,requiresLineOfSight:true,allowedRelations:['enemy']},
  mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
   targeting:{domain:'actor',shape:'area',actor_targets:true,area:{kind,radius_ft:5}},
   effects:[{resolution:'save',who:'target',ability:'dex',dc:12,on_fail:[{kind:'damage',type:damage,amount:'3'}],on_success:[]}]}};
 const world=createWorld({id:'area-regression',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors:[actor('caster',2),actor('ally',2),actor('two'),actor('three')]});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['caster','two','three','ally'],turnStarted:true};
 const state={schemaVersion:1,characterId:'caster',controlledCharacterIds:['caster'],runtimeRevision:0,world,creatureCoverVersion:1,tacticalFootprints:'sized',
 tokens:Object.fromEntries(Object.entries({caster:{x:5,y:8},ally:{x:5,y:5},two:{x:5,y:4},three:{x:4,y:4}}).map(([id,position])=>[id,{actorId:id,position}])),
 sideByActorId:{caster:'party',ally:'party',two:'enemy',three:'enemy'},combatAreas:{},boardRevision:0,
 catalogActions:[action],playerActionIds:[action.id],certifiedPlayerActionIds:[],movementRemainingFt:{caster:30},log:[],outcome:'active',actionPresentation:{}} as unknown as SoloCombatState;
 return {state,action};
}
function cast(state:SoloCombatState,position={x:4,y:4},targetIds=['three']){
 return autoResolveSystemDecisions(executeCombatAction({state,actorId:'caster',actionId:'area',targetIds,worldPosition:position,rng:()=>.1}),()=>.1);
}
describe('area delivery and propagation are distinct authoritative checks',()=>{
 it.each([['sphere','acid'],['cylinder','cold']])('%s / %s affects both enemies despite caster-to-secondary cover', (kind,damage)=>{
  const {state}=setup(kind,damage),before=JSON.stringify(state);
  expect(spatialFacts(state,'caster','two',false).cover).toBe('total');
  expect(spatialFacts(state,'caster','three',false).cover).toBe('none');
  expect(selectedTargetsForAction({state,actorId:'caster',actionId:'area',clickedActorId:'three',clickedPosition:{x:4,y:4}})).toEqual(['two','three']);
  const after=cast(state);
  expect(after.world.actors.two.runtime.hp.current).toBe(17);
  expect(after.world.actors.three.runtime.hp.current).toBe(17);
  expect(after.world.actors.caster.runtime.resources.action).toBe(0);
  expect(JSON.stringify(state)).toBe(before);
 });
 it('rejects an obstructed origin before any roll or cost',()=>{
  const {state}=setup(),before=JSON.stringify(state),rng=vi.fn(()=>.1);
  expect(()=>executeCombatAction({state,actorId:'caster',actionId:'area',targetIds:['two'],worldPosition:{x:5,y:4},rng})).toThrow('Центр области закрыт');
  expect(rng).not.toHaveBeenCalled();expect(JSON.stringify(state)).toBe(before);
 });
 it('excludes a secondary target behind a wall without cancelling the visible target',()=>{
  const {state}=setup();state.tokens.two.position={x:6,y:4};
  (state.catalogActions[0].mechanics.targeting as any).area.radius_ft=10;
  state.battleMap={width:12,height:10,features:[{id:'wall',x:5,y:4,width:1,height:1,blocksSight:true}]} as SoloCombatState['battleMap'];
  const after=cast(state, {x:4,y:4},['two','three']);
  expect(after.world.actors.two.runtime.hp.current).toBe(20);expect(after.world.actors.three.runtime.hp.current).toBe(17);
 });
 it('uses range to the origin, allowing the sphere edge beyond casting range',()=>{
  const {state}=setup();state.catalogActions[0].targeting!.rangeFt=20;
  state.tokens.two.position={x:4,y:3};
  const after=cast(state);
  expect(after.world.actors.two.runtime.hp.current).toBe(17);
  expect(()=>cast(state,{x:4,y:2})).toThrow('вне дальности');
 });
 it('never trusts an omitted or injected target list supplied to the worker',()=>{
  const {state}=setup(),hash=`sha256:${'a'.repeat(64)}`;
  const envelope={schemaVersion:1 as const,artifactHash:hash,state,entropy:{seed:'area',cursor:0}};
  const result=stepRoguelikeCombat(envelope,{type:'action',actorId:'caster',actionId:'area',targetIds:['ally'],worldPosition:{x:4,y:4}},hash);
  expect(result.envelope.state.world.actors.ally.runtime.hp.current).toBe(20);
  expect(result.envelope.state.world.actors.caster.runtime.resources.action).toBe(0);
  expect(result.envelope.state.log.some(e=>e.actorId==='two')).toBe(true);
  expect(result.envelope.state.log.some(e=>e.actorId==='three')).toBe(true);
 });
});
