import {describe,expect,it} from 'vitest';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition,type RulesCatalog} from './domain';
import {compileMechanicsTargeting} from './actionTargeting';
import {handleCommand} from './handler';
import {createSequentialIdFactory} from './determinism';
import type {Card} from '../types';

const key={...cards.find(row=>row.card_number==='CARD-0869')!,mechanics:completion['CARD-0869'].mechanics} as unknown as Card;
const action=(suffix:string):RuleActionDefinition=>{
 const patch=related.entities.find(row=>row.card_number===`ACT-item-completion-high-869-${suffix}`)?.patch;
 if(!patch?.mechanics)throw Error(`Missing key action ${suffix}`);
 return {id:patch.card_number,name:patch.name,kind:'nonSpell',sourceEntityIds:[key.id],mechanics:patch.mechanics,
  targeting:compileMechanicsTargeting(patch.mechanics)};
};
const bind=action('bind-door'),open=action('open-bound-door');
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'wanderer-key',contentHash:'wanderer-key',errataVersion:'2024'};
const actor:ActorState={id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',ac:10,
 capabilities:{actionIds:[bind.id,open.id]},character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},knownCards:[key]},
 runtime:{hp:{current:10,max:10,temp:0},resources:{action:1},maxResources:{action:1},inventory:[{cardId:key.id,qty:1}],equipment:{},activeEffects:[]}};
const catalog:RulesCatalog={getAction:id=>[bind,open].find(row=>row.id===id),getCard:id=>id===key.id?key:undefined};
const env={rng:()=>{throw Error('Key has no die');},clock:()=>1,nextId:createSequentialIdFactory('key')};
function command(world:ReturnType<typeof createWorld>,id:string,door:string,commandId:string):GameCommand{
 return {schemaVersion:1,type:'UseAction',commandId,actorId:'hero',expectedRevision:world.revision,
  rulesetContentHash:ruleset.contentHash,actionId:id,targetIds:[],worldInput:{type:'item_tool',objectId:door,description:'chosen door',
   facts:{factsSource:'scenario',boardRevision:0,distanceFt:id===bind.id?100:5,lineOfSight:id!==bind.id}}};
}
describe('one-use key bound to a declared door',()=>{
 it('cannot change the remembered door and consumes the key only when that door opens',()=>{
  let world=createWorld({id:'key-world',ruleset,actors:[actor]});
  world.objects.first={id:'first',name:'First door',kind:'environment',size:'medium',toolState:{locked:true}};
  world.objects.second={id:'second',name:'Second door',kind:'environment',size:'medium',toolState:{locked:true}};
  const bound=handleCommand(world,command(world,bind.id,'first','remember'),catalog,env);
  expect(bound.status,JSON.stringify(bound)).toBe('accepted');
  if(bound.status!=='accepted')return;
  world=bound.nextState;
  expect(world.objects.first.toolState?.keyBinding).toMatchObject({itemCardId:key.id,ownerActorId:'hero',used:false});
  expect(handleCommand(world,command(world,bind.id,'second','change-thought'),catalog,env).status).toBe('rejected');
  expect(handleCommand(world,command(world,open.id,'second','wrong-door'),catalog,env).status).toBe('rejected');
  expect(world.actors.hero.runtime.inventory).toMatchObject([{cardId:key.id,qty:1}]);
  const saved=JSON.parse(JSON.stringify(world)) as typeof world;
  const unlocked=handleCommand(saved,command(saved,open.id,'first','unlock'),catalog,env);
  expect(unlocked.status,JSON.stringify(unlocked)).toBe('accepted');
  if(unlocked.status!=='accepted')return;
  expect(unlocked.nextState.objects.first.toolState).toMatchObject({locked:false,keyBinding:{used:true}});
  expect(unlocked.nextState.actors.hero.runtime.inventory).toEqual([]);
  expect(handleCommand(unlocked.nextState,command(unlocked.nextState,open.id,'first','repeat'),catalog,env).status).toBe('rejected');
 });
});
