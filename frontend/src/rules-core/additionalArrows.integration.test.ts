import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition,type GameCommand} from './domain';
import {InMemoryRulesSession} from './session';
import {createStrictRngTape,createSequentialIdFactory} from './determinism';
import type {Card} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'additional-arrow',contentHash:'additional-arrow',errataVersion:'2024'};
describe('conditional additional arrows',()=>{
 it.each([1,2])('pays ammunition and retains advantage on %s additional attacks through defense reloads',additional=>{
  const bow={id:'bow',name:'Bow',type:'weapon',mechanics:{weapon_profile:{weapon_type:'longbow',proficiency_category:'martial',attack_ability:'dex',damage_lines:[{dice:'1d6',type:'piercing'}],default_attack_mode:'ranged',attack_modes:[{kind:'ranged',normal_ft:150,long_ft:600}],properties:['ammunition'],mastery_effect_id:'mastery:bow',ammo:{card_id:'arrow'},enchantment:{attack_bonus:0,damage_bonus:0,extra_damage_lines:[]},attunement:{required:false}}}} as unknown as Card;
  const effect={resolution:'attack_roll',ability:'auto',attack_kind:'weapon_ranged',on_hit:[{kind:'damage',dice:'weapon',type:'weapon'}]};
  const target={minTargets:1,maxTargets:1,rangeFt:600,requiresLineOfSight:true,allowedRelations:['enemy'] as ('enemy')[]};
  const declaredTargeting={shape:'single',domain:'actor',range_ft:600,min_targets:1,max_targets:1,actor_targets:true,allowed_relations:['enemy'],requires_line_of_sight:true};
  const primary:RuleActionDefinition={id:'shoot',name:'Shoot',kind:'nonSpell',sourceEntityIds:['bow'],targeting:target,mechanics:{targeting:declaredTargeting,activation:{mode:'active',cost:[{resource:'action'},{resource:'item',card_id:'arrow',amount:1}]},effects:[effect]}};
  const follow:RuleActionDefinition={...primary,id:'follow',name:'Follow',mechanics:{targeting:declaredTargeting,activation:{mode:'triggered',optional:false,cost:[{resource:'equipped_weapon_ammo',amount:1}],trigger:{event:'attack_dice_followup',subject:'self',circumstances:[{kind:'event_data_equals',key:'mode',value:'additional'}]}},effects:[{...effect,additional_attack_child:true}]}};
  const shield:RuleActionDefinition={id:'shield',name:'Shield',kind:'nonSpell',sourceEntityIds:['shield'],mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'hit_by_attack'}},effects:[{resolution:'auto',result:[{kind:'modifier',op:'add',value:5,applies_to:{roll:'ac'},duration:{type:'until_start_of_next_turn'}}]}]}};
  const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds:id==='a'?['shoot','follow']:['shield']},character:{abilityMods:{str:0,dex:3,con:0,int:0,wis:0,cha:0},level:1,profBonus:2,knownCards:[bow],equippedCards:[bow],weaponProficiencies:['martial'],illumination:{level:'dark',daylight:false,magicalDarkness:false,boardRevision:1}},runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},equipment:id==='a'?{main_hand:'bow'}:{},inventory:id==='a'?[{cardId:'bow',qty:1},{cardId:'arrow',qty:additional+1}]:[],activeEffects:[]},passives:id==='a'?[{kind:'weapon_attack_policy',weapon_id:'bow',additional_attacks:additional,when:[{kind:'in_darkness'}]},{kind:'modifier',op:'advantage',applies_to:{roll:'attack'}}]:[]});
  const tape=createStrictRngTape(Array.from({length:additional+1},(_,i)=>[{label:'arrow low '+i,sides:20,value:2},{label:'arrow high '+i,sides:20,value:12},{label:'arrow damage '+i,sides:6,value:3}]).flat()),env={rng:tape.rng,nextId:createSequentialIdFactory(),clock:()=>1},catalog={getAction:(id:string)=>[primary,follow,shield].find(a=>a.id===id)};
  let session=new InMemoryRulesSession(createWorld({id:'arrows',ruleset,actors:[actor('a'),actor('b')]}),catalog,env);
  const dispatch=(input:Record<string,unknown>)=>{const result=session.dispatch({schemaVersion:1,expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,commandId:'c'+session.getState().revision,actorId:'a',...input} as GameCommand);if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);};
  dispatch({type:'UseAction',actionId:'shoot',targetIds:['b'],factsByTarget:{b:{factsSource:'scenario',boardRevision:1,distanceFt:30,lineOfSight:true,cover:'none',relation:'enemy'}}});
  for(let guard=0;session.getState().pendingResolution&&guard<10;guard++){
   session=new InMemoryRulesSession(JSON.parse(JSON.stringify(session.getState())),catalog,env);const pending=session.getState().pendingResolution!;
   if(pending.type!=='attack_reaction')throw Error('Unexpected '+pending.type);
   dispatch({type:'ResolveDecision',actorId:'b',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:null}});
  }
  expect(session.getState().pendingResolution).toBeNull();expect(session.getState().actors.b.runtime.hp.current).toBe(30-6*(additional+1));expect(session.getState().actors.a.runtime.inventory.find(r=>r.cardId==='arrow')?.qty??0).toBe(0);expect(session.getState().actors.a.runtime.resources).toMatchObject({action:0,reaction:1});tape.assertExhausted();
 });
});
