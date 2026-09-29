import {describe,expect,it} from 'vitest';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition,type RulesCatalog,type SpatialFacts} from './domain';
import {compileMechanicsTargeting} from './actionTargeting';
import {handleCommand} from './handler';
import {createSequentialIdFactory} from './determinism';
import type {Card} from '../types';

const staff={...cards.find(row=>row.card_number==='CARD-0937')!,mechanics:completion['CARD-0937'].mechanics} as unknown as Card;
const action=(suffix:string):RuleActionDefinition=>{
 const patch=related.entities.find(row=>row.card_number===`ACT-item-completion-high-937-${suffix}`)?.patch;
 if(!patch?.mechanics)throw Error(`Missing Caduceus action ${suffix}`);
 return {id:patch.card_number,name:patch.name,kind:'nonSpell',sourceEntityIds:[staff.id],mechanics:patch.mechanics,
  targeting:compileMechanicsTargeting(patch.mechanics)};
};
const bless=action('bless-six'),resurrect=action('break-resurrect');
const fx=related.entities.find(row=>row.card_number==='EFFECT-item-completion-high-937-vitality')?.patch;
if(!fx?.mechanics)throw Error('Caduceus vitality effect missing');
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'caduceus',contentHash:'caduceus',errataVersion:'2024'};
const facts=(relation:'ally'|'self'='ally'):SpatialFacts=>({factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true,cover:'none',relation});
const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:10,
 capabilities:{actionIds:id==='owner'?[bless.id,resurrect.id]:[]},
 character:{level:5,profBonus:3,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},
  ...(id==='owner'?{knownCards:[staff],equippedCards:[staff],attunedIds:[staff.id]}:{})},
 ...(id==='owner'?{grantedEffects:{[fx.card_number]:{id:fx.id,card_number:fx.card_number,name:fx.name,mechanics:fx.mechanics}}}:{}),
 runtime:{hp:{current:20,max:20,temp:0},resources:{action:1},maxResources:{action:1},
  inventory:[],equipment:id==='owner'?{main_hand:staff.id}:{},activeEffects:[]}});
const catalog:RulesCatalog={getAction:id=>[bless,resurrect].find(row=>row.id===id),getCard:id=>id===staff.id?staff:undefined};
const env={rng:()=>{throw Error('No die');},clock:()=>1,nextId:createSequentialIdFactory('caduceus')};
function command(world:ReturnType<typeof createWorld>,id:string,targetIds:string[],commandId:string,factsByTarget?:Record<string,SpatialFacts>):GameCommand{
 return {schemaVersion:1,type:'UseAction',commandId,expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,
  actorId:'owner',actionId:id,targetIds,factsByTarget:factsByTarget??Object.fromEntries(targetIds.map(id=>[id,facts()]))};
}

describe('Caduceus beneficiary and resurrection rules',()=>{
 it('grants ten maximum HP to six chosen actors and removes it when the source loses attunement',()=>{
  let world=createWorld({id:'six',ruleset,actors:[actor('owner'),...Array.from({length:7},(_,i)=>actor(`target-${i}`))]});
  const targets=Array.from({length:6},(_,i)=>`target-${i}`);
  const granted=handleCommand(world,command(world,bless.id,targets,'grant'),catalog,env);
  expect(granted.status,JSON.stringify(granted)).toBe('accepted');
  if(granted.status!=='accepted')return;
  world=granted.nextState;
  for(const id of targets){expect(world.actors[id].runtime.hp.max).toBe(30);expect(world.actors[id].runtime.activeEffects).toHaveLength(1);}
  expect(handleCommand(world,command(world,bless.id,['target-6'],'seventh'),catalog,env).status).toBe('rejected');
  world.actors.owner.character.attunedIds=[];
  const noop:RuleActionDefinition={id:'noop',name:'Noop',kind:'nonSpell',sourceEntityIds:['noop'],
   targeting:{minTargets:0,maxTargets:0,rangeFt:0,requiresLineOfSight:false,allowedRelations:[]},
   mechanics:{activation:{mode:'active',cost:[]},effects:[]}};
  world.actors.owner.capabilities.actionIds.push('noop');
  const after=handleCommand(world,command(world,'noop',[],'after-loss'),{...catalog,getAction:id=>id==='noop'?noop:catalog.getAction(id)},env);
  expect(after.status,JSON.stringify(after)).toBe('accepted');
  if(after.status!=='accepted')return;
  for(const id of targets){expect(after.nextState.actors[id].runtime.hp.max).toBe(20);expect(after.nextState.actors[id].runtime.activeEffects).toEqual([]);}
 });
 it('validates death and soul facts before consuming the staff, then revives with full HP once',()=>{
  let world=createWorld({id:'revive',ruleset,actors:[actor('owner'),actor('dead')]});
  world.actors.dead.lifecycle={status:'dead',adjudication:{type:'ActorDeathAdjudicated',actorId:'dead',provenance:'canonical_actor_lifecycle',
   factId:'test-death',adjudicatedBy:'gm',observedAtWorldRevision:0,rulesetContentHash:ruleset.contentHash}};
  world.actors.dead.runtime.hp.current=0;
  world.actors.dead.runtime.deathSaves={successes:0,failures:3,dead:true,stable:false};
  const valid={...facts(),deadForDays:200,deathByOldAge:false,targetIsUndead:false,soulFree:true,soulWilling:true};
  expect(handleCommand(world,command(world,resurrect.id,['dead'],'refused',{dead:{...valid,soulWilling:false}}),catalog,env).status).toBe('rejected');
  expect(world.actors.owner.runtime.equipment.main_hand).toBe(staff.id);
  const done=handleCommand(world,command(world,resurrect.id,['dead'],'restore',{dead:valid}),catalog,env);
  expect(done.status,JSON.stringify(done)).toBe('accepted');
  if(done.status!=='accepted')return;
  world=done.nextState;
  expect(world.actors.dead.lifecycle?.status).toBe('alive');
  expect(world.actors.dead.runtime.hp).toMatchObject({current:20,max:20});
  expect(world.actors.dead.runtime.deathSaves?.dead).toBe(false);
  expect(world.actors.owner.runtime.equipment.main_hand).toBeNull();
  expect(handleCommand(world,command(world,resurrect.id,['dead'],'again',{dead:valid}),catalog,env).status).toBe('rejected');
 });
});
