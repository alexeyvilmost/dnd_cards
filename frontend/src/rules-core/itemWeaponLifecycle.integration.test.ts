import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition,type GameCommand} from './domain';
import {handleCommand} from './handler';
import {createStrictRngTape,createSequentialIdFactory} from './determinism';
import {migrateWorldState} from './worldMigration';
import {foldEvents} from './reducer';
import type {Card} from '../types';
import {weaponBondRecallChoices} from '../solo-combat/actionChoices';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'weapon-return',contentHash:'weapon-return',errataVersion:'2024'};
function fixture(returning:boolean,inherent=false,die=4){
 const card={id:'weapon',name:'Thrown weapon',type:'weapon',slot:'one_hand',mechanics:{...(inherent?{weapon_bond:{inherent:true,recall_action_ref:'recall'}}:{}),weapon_profile:{weapon_type:'dagger',proficiency_category:'simple',attack_ability:'finesse',damage_lines:[{dice:`1d${die}`,type:'piercing'}],default_attack_mode:'melee',attack_modes:[{kind:'melee',reach_ft:5},{kind:'ranged',normal_ft:20,long_ft:60}],properties:['finesse','light','thrown'],mastery_effect_id:'test-mastery',ammo:null,enchantment:{attack_bonus:0,damage_bonus:0,extra_damage_lines:[]},attunement:{required:false}}}} as unknown as Card;
 const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:id==='a'?['throw','recall']:[]},character:{knownCards:[card],equippedCards:id==='a'?[card]:[],abilityMods:{str:2,dex:2,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},passives:returning&&id==='a'?[{kind:'weapon_return',weapon_id:card.id,after_throw:true}]:[],runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,bonus_action:1,reaction:1},maxResources:{action:1,bonus_action:1,reaction:1},activeEffects:[],inventory:[],equipment:id==='a'?{main_hand:card.id}:{}}});
 const attack:RuleActionDefinition={id:'throw',name:'Throw',kind:'nonSpell',sourceEntityIds:['weapon'],targeting:{minTargets:1,maxTargets:1,rangeFt:20,requiresLineOfSight:true,allowedRelations:['enemy']},mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'attack_roll',attack_kind:'weapon_ranged',ability:'auto',on_hit:[{kind:'damage',dice:'weapon',type:'weapon',ability:'auto'}]}]}};
 const recall:RuleActionDefinition={id:'recall',name:'Recall',kind:'nonSpell',sourceEntityIds:['weapon'],mechanics:{activation:{mode:'active',weapon_bond_recall:true,cost:[{resource:'bonus_action'}]},effects:[]}};
 const catalog={getAction:(id:string)=>[attack,recall].find(a=>a.id===id)};
 let world=createWorld({id:'weapons',ruleset,actors:[actor('a'),actor('b')]});
 const tape=createStrictRngTape([{sides:20,value:12,label:'hit'},{sides:die,value:2,label:'damage'}]),env={rng:tape.rng,nextId:createSequentialIdFactory('weapon'),clock:()=>1};
 const run=(input:Record<string,unknown>)=>{const command={schemaVersion:1,commandId:`c${world.revision}`,expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,actorId:'a',...input} as GameCommand;
  const result=handleCommand(world,command,catalog,env);expect(result.status,JSON.stringify(result)).toBe('accepted');if(result.status!=='accepted')throw Error('rejected');expect(foldEvents(world,result.events)).toEqual(result.nextState);world=result.nextState;return command;};
 return {run,recall,catalog,env,get:()=>world,reload:()=>{world=migrateWorldState(JSON.parse(JSON.stringify(world)));}};
}
describe('physical returning and inherently bound weapons',()=>{
 it.each([4,6])('returns a different 1d%s weapon through a worn universal provider',die=>{
  const f=fixture(false,false,die);f.get().actors.a.passives=[{kind:'weapon_return',after_throw:true,any_thrown_weapon:true}];
  f.run({type:'UseAction',actionId:'throw',targetIds:['b'],factsByTarget:{b:{factsSource:'scenario',boardRevision:0,distanceFt:15,lineOfSight:true,cover:'none',relation:'enemy'}}});
  expect(f.get().actors.a.runtime.equipment.main_hand).toBe('weapon');expect(Object.values(f.get().objects)[0].heldByActorId).toBe('a');
 });
 it.each([4,6])('returns the same 1d%s thrown weapon and never duplicates on reload/replay',die=>{
  const f=fixture(true,false,die);const command=f.run({type:'UseAction',actionId:'throw',targetIds:['b'],factsByTarget:{b:{factsSource:'scenario',boardRevision:0,distanceFt:15,lineOfSight:true,cover:'none',relation:'enemy'}}});
  expect(f.get().actors.a.runtime.equipment.main_hand).toBe('weapon');expect(Object.values(f.get().objects)).toHaveLength(1);expect(Object.values(f.get().objects)[0].heldByActorId).toBe('a');f.reload();expect(handleCommand(f.get(),command,f.catalog,f.env).status).toBe('rejected');expect(Object.values(f.get().objects)).toHaveLength(1);
 });
 it('drops an ordinary thrown instance, then recalls an inherent bond from its saved location exactly once',()=>{
  const f=fixture(false,true);expect(Object.values(f.get().objects)).toHaveLength(1);
  f.run({type:'UseAction',actionId:'throw',targetIds:['b'],factsByTarget:{b:{factsSource:'scenario',boardRevision:0,distanceFt:15,lineOfSight:true,cover:'none',relation:'enemy'}}});
  expect(f.get().actors.a.runtime.equipment.main_hand).toBeNull();f.reload();const object=Object.values(f.get().objects)[0];expect(object.weaponBondActorId).toBe('a');expect(object.carriedByActorId).toBeUndefined();
  expect(weaponBondRecallChoices(f.get().actors.a,f.recall,f.get()).map(choice=>choice.id)).toEqual(['weapon_bond_object','weapon_bond_hand']);
  const command=f.run({type:'UseAction',actionId:'recall',targetIds:['a'],factsByTarget:{a:{factsSource:'scenario',boardRevision:0,distanceFt:0,lineOfSight:true,cover:'none',relation:'self'}},choices:{weapon_bond_object:[object.id],weapon_bond_hand:['main_hand']}});
  expect(f.get().actors.a.runtime.equipment.main_hand).toBe('weapon');expect(f.get().actors.a.runtime.resources.bonus_action).toBe(0);f.reload();expect(handleCommand(f.get(),command,f.catalog,f.env).status).toBe('rejected');expect(Object.values(f.get().objects)).toHaveLength(1);
 });
});
