import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition,type RulesCatalog,type SpatialFacts} from './domain';
import {handleCommand} from './handler';
import {createStrictRngTape,createSequentialIdFactory} from './determinism';
import {migrateWorldState} from './worldMigration';
import {foldEvents} from './reducer';
import type {Card} from '../types';
import {parseWeaponProfile} from './weaponProfile';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'item-event-test',contentHash:'sha256:item-event-test',errataVersion:'2024'};
const facts:SpatialFacts={factsSource:'scenario',boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy'};
function actor(id:string,actionIds:string[]):ActorState{return {id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds},
  character:{abilityMods:{str:3,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
  runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1,bonus_action:1},maxResources:{action:1,reaction:1,bonus_action:1},inventory:[],equipment:{},activeEffects:[]}};}
const strike:RuleActionDefinition={id:'strike',name:'Strike',kind:'nonSpell',sourceEntityIds:['weapon-source'],
  targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']},
  mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},effects:[{resolution:'attack_roll',ability:'str',attack_kind:'melee',on_hit:[{kind:'damage',amount:3,type:'bludgeoning'}]}]}};
function reaction(id:string,event:string,amount:number,critical=false):RuleActionDefinition{return {id,name:id,kind:'nonSpell',sourceEntityIds:[`${id}-item`],
  targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']},
  mechanics:{damage_source_kind:'item',activation:{mode:'reaction',cost:[{resource:'reaction',amount:1}],trigger:{event,timing:'after',subject:'self',
    ...(critical?{circumstances:[{kind:'event_data_equals',key:'critical',value:true}]}:{})}},
    effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount,type:'fire'}]}]}};}
function setup(actions:RuleActionDefinition[],attackDice:Array<number|{sides:number;value:number}>=[12],configure?:(actors:Record<string,ActorState>)=>void){
  const catalog:RulesCatalog={getAction:id=>[strike,...actions].find(action=>action.id===id)};
  let world=createWorld({id:'item-events',ruleset,actors:[actor('a',['strike',...actions.filter(row=>row.id.startsWith('source')).map(row=>row.id)]),actor('b',actions.filter(row=>!row.id.startsWith('source')).map(row=>row.id))]});
  configure?.(world.actors);
  world=createWorld({id:world.id,ruleset,actors:Object.values(world.actors)});
  const tape=createStrictRngTape(attackDice.map((die,index)=>({...typeof die==='number'?{value:die,sides:20}:die,label:`draw-${index}`}))),env={rng:tape.rng,nextId:createSequentialIdFactory('test'),clock:()=>1};
  const dispatch=(input:Record<string,unknown>)=>{
    const command={schemaVersion:1,commandId:`c${world.revision}`,expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,actorId:'a',...input} as GameCommand;
    const before=world,result=handleCommand(world,command,catalog,env);
    expect(result.status,JSON.stringify(result)).toBe('accepted');
    if(result.status!=='accepted')throw new Error('Rejected');
    expect(foldEvents(before,result.events)).toEqual(result.nextState);
    world=result.nextState;
    return {result,command};
  };
  const reload=()=>{world=migrateWorldState(JSON.parse(JSON.stringify(world)));};
  return {dispatch,reload,get:()=>world,catalog,env};
}

describe('item after-event reactions',()=>{
  it.each([
    {id:'source-board-rider',trigger:{requires_weapon_or_unarmed_hit:true}},
    {id:'source-renamed-rider',trigger:{requires_melee_hit:true}},
    {id:'source-unknown-predicate',trigger:{unimplemented_gate:true}},
  ])('does not execute an unowned predicate as an unconditional world event: $id', row => {
    const action = reaction(row.id,'hit',7);
    const activation = action.mechanics.activation as Record<string,unknown>;
    action.mechanics.activation = {...activation,mode:'triggered',trigger:{event:'hit',...row.trigger}};
    const session = setup([action]);
    session.dispatch({type:'UseAction',actionId:'strike',targetIds:['b'],factsByTarget:{b:facts}});
    expect(session.get().pendingResolution).toBeNull();
    expect(session.get().eventReactions ?? []).toEqual([]);
    expect(session.get().actors.b.runtime.hp.current).toBe(27);
    expect(session.get().actors.a.runtime.resources.reaction).toBe(1);
    session.reload();
    expect(session.get().pendingResolution).toBeNull();
  });

  it.each([1,.5])('echoes fraction %s only after the protected actor settles damage; the source gets its own defenses',fraction=>{
    const attack:RuleActionDefinition={...strike,id:'source-bond-strike',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:12,type:'fire'}]}]}};
    const guard:RuleActionDefinition={id:'guard',name:'Guard',kind:'nonSpell',sourceEntityIds:['guard-source'],mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'damage_taken',timing:'before'}},
      effects:[{resolution:'auto',who:'self',result:[{kind:'reduce_damage',amount:2}]}]}};
    const session=setup([attack,guard],[],actors=>{
      actors.c=actor('c',[]);actors.c.passives=[{kind:'resistance',damage_type:'fire',value:'resistance'}];
      actors.b.character.spatialObservations={boardRevision:1,nearby:[{actorId:'c',distanceFt:30,relation:'ally'}]};
      actors.c.character.spatialObservations={boardRevision:1,nearby:[{actorId:'b',distanceFt:30,relation:'ally'}]};
      actors.b.runtime.activeEffects=[{id:'bond-effect',source:'bond',sourceId:'c',name:'Bond',mechanics:{bond_policy:{group:'bond',max_source_distance_ft:60,end_on_source_zero_hp:true,exclusive_on_either:true},
        effects:[{resolution:'auto',result:[{kind:'resistance',damage_type:'fire',value:'resistance'},{kind:'damage_echo',recipient:'effect_source',fraction}]}]}}];
    });
    session.dispatch({type:'UseAction',actionId:attack.id,targetIds:['b'],factsByTarget:{b:facts}});
    const pending=session.get().pendingResolution!;expect(pending.type).toBe('damage_reaction');expect(pending.request.actorId).toBe('b');
    expect(session.get().actors.b.runtime.hp.current).toBe(30);expect(session.get().actors.c.runtime.hp.current).toBe(30);
    session.reload();const accepted=session.dispatch({type:'ResolveDecision',actorId:'b',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:'guard'}});
    expect(session.get().actors.b.runtime.hp.current).toBe(25);expect(session.get().actors.c.runtime.hp.current).toBe(30-Math.floor(Math.floor(5*fraction)/2));
    expect(session.get().pendingResolution).toBeNull();expect(session.get().areaConsequences??[]).toEqual([]);
    expect(handleCommand(session.get(),accepted.command,session.catalog,session.env).status).not.toBe('accepted');
  });
  it.each(['distance','zero-hp'])('ends every part of a bond before a subsequent action after %s',reason=>{
    const attack:RuleActionDefinition={...strike,id:'source-bond-end',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:12,type:'fire'}]}]}};
    const session=setup([attack],[],actors=>{
      actors.c=actor('c',[]);if(reason==='zero-hp')actors.c.runtime.hp.current=0;
      actors.c.character.spatialObservations={boardRevision:1,nearby:[{actorId:'b',distanceFt:reason==='distance'?65:5,relation:'ally'}]};
      actors.b.runtime.activeEffects=[{id:'bond-effect',source:'bond',sourceId:'c',name:'Bond',mechanics:{bond_policy:{group:'bond',max_source_distance_ft:60,end_on_source_zero_hp:true},
        effects:[{resolution:'auto',result:[{kind:'resistance',damage_type:'fire',value:'resistance'},{kind:'damage_echo',recipient:'effect_source',fraction:1}]}]}}];
    });
    session.reload();session.dispatch({type:'UseAction',actionId:attack.id,targetIds:['b'],factsByTarget:{b:facts}});
    expect(session.get().actors.b.runtime.hp.current).toBe(18);expect(session.get().actors.b.runtime.activeEffects).toEqual([]);
    expect(session.get().actors.c.runtime.hp.current).toBe(reason==='zero-hp'?0:30);
  });
  it('recasting a bond on either endpoint replaces the previous relationship atomically',()=>{
    const mechanics={activation:{mode:'passive'},bond_policy:{group:'bond',max_source_distance_ft:60,end_on_source_zero_hp:true,exclusive_on_either:true},
      effects:[{resolution:'auto',result:[{kind:'resistance',damage_type:'fire',value:'resistance'},{kind:'damage_echo',recipient:'effect_source',fraction:1}]}]};
    const cast:RuleActionDefinition={...strike,id:'source-bind',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'grant_effect',value:'bond',duration:{type:'hours',amount:1}}]}]}};
    const session=setup([cast],[],actors=>{
      actors.a.grantedEffects={bond:{id:'bond',name:'Bond',mechanics}};actors.c=actor('c',[]);
      actors.c.runtime.activeEffects=[{id:'old-bond',name:'Bond',source:'Bond',sourceId:'b',mechanics}];
    });
    session.dispatch({type:'UseAction',actionId:cast.id,targetIds:['b'],factsByTarget:{b:facts}});
    expect(session.get().actors.c.runtime.activeEffects).toEqual([]);
    expect(session.get().actors.b.runtime.activeEffects).toHaveLength(1);
    expect(session.get().actors.b.runtime.activeEffects[0]).toMatchObject({sourceId:'a',roundsLeft:600});
    session.reload();expect(session.get().actors.c.runtime.activeEffects).toEqual([]);
  });
  it.each([{face:1,tag:'goblin'},{face:2,tag:'construct'}])('redirects natural $face to the nearest data-tagged actor and keeps the hit through reload',spec=>{
    const bow={id:'redirect-bow',name:'Redirect bow',type:'weapon',mechanics:{weapon_profile:{weapon_type:'shortbow',proficiency_category:'simple',attack_ability:'dex',
      damage_lines:[{dice:'1d6',type:'piercing'}],default_attack_mode:'ranged',attack_modes:[{kind:'ranged',normal_ft:80,long_ft:320}],properties:['ammunition'],
      mastery_effect_id:'mastery:bow',ammo:{card_id:'arrow'},enchantment:{attack_bonus:0,damage_bonus:0,extra_damage_lines:[]},attunement:{required:false}}}} as unknown as Card;
    const arrow:RuleActionDefinition={...strike,id:'source-redirect',targeting:{...strike.targeting!,rangeFt:320},mechanics:{activation:{mode:'active',cost:[{resource:'action'},{resource:'item',card_id:'arrow',amount:1}]},
      effects:[{resolution:'attack_roll',ability:'auto',attack_kind:'weapon_ranged',on_hit:[{kind:'damage',amount:4,type:'piercing'}]}]}};
    const shield:RuleActionDefinition={id:'shield',name:'Defense',kind:'nonSpell',sourceEntityIds:['defense'],mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'hit_by_attack'}},
      effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',applies_to:{roll:'ac'},op:'add',value:5,duration:{unit:'round',amount:1}}]}]}};
    const session=setup([arrow,shield],[spec.face],actors=>{
      actors.a.character.knownCards=[bow];actors.a.character.equippedCards=[bow];actors.a.runtime.equipment={main_hand:bow.id};actors.a.runtime.inventory=[{cardId:'arrow',qty:2}];
      actors.a.passives=[{effects:[{resolution:'auto',result:[{kind:'attack_redirection',weapon_id:bow.id,natural_faces:[spec.face],target_tags:[spec.tag],nearest_to:'target',automatic_hit:true}]}]}];
      actors.c=actor('c',['shield']);actors.c.character.creatureTags=[spec.tag];actors.d=actor('d',[]);actors.d.character.creatureTags=[spec.tag];
      actors.b.character.spatialObservations={boardRevision:1,nearby:[{actorId:'c',distanceFt:5,relation:'ally'},{actorId:'d',distanceFt:10,relation:'ally'}]};
      actors.a.character.spatialObservations={boardRevision:1,nearby:[{actorId:'c',distanceFt:20,relation:'enemy'},{actorId:'d',distanceFt:25,relation:'enemy'}]};
    });
    session.dispatch({type:'UseAction',actionId:arrow.id,targetIds:['b'],factsByTarget:{b:{...facts,distanceFt:30}}});
    const pending=session.get().pendingResolution!;expect(pending.type).toBe('attack_reaction');expect(pending.request.actorId).toBe('c');
    expect(pending.type==='attack_reaction'&&pending.attackRoll.automaticHit?.sourceEntityIds).toEqual([bow.id]);
    session.reload();
    const accepted=session.dispatch({type:'ResolveDecision',actorId:'c',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:'shield'}});
    expect(session.get().actors.b.runtime.hp.current).toBe(30);expect(session.get().actors.d.runtime.hp.current).toBe(30);
    expect(session.get().actors.c.runtime.hp.current).toBe(26);expect(session.get().actors.c.runtime.resources.reaction).toBe(0);
    expect(session.get().actors.a.runtime.resources.action).toBe(0);expect(session.get().actors.a.runtime.inventory.find(row=>row.cardId==='arrow')?.qty).toBe(1);
    expect(handleCommand(session.get(),accepted.command,session.catalog,session.env).status).not.toBe('accepted');
  });
  it('allows damage reduction and exactly one concentration save after a reflected projectile',()=>{
    const arrow:RuleActionDefinition={...strike,id:'source-projectile',mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
      effects:[{resolution:'attack_roll',ability:'str',attack_kind:'ranged',projectile:true,on_hit:[{kind:'damage',amount:4,type:'piercing'}]}]}};
    const guard:RuleActionDefinition={id:'source-guard',name:'Guard',kind:'nonSpell',sourceEntityIds:['guard-source'],mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'damage_taken',timing:'before'}},
      effects:[{resolution:'auto',who:'self',result:[{kind:'reduce_damage',amount:2}]}]}};
    const session=setup([arrow,guard],[{sides:20,value:20},12,15],actors=>{
      actors.b.passives=[{effects:[{resolution:'auto',result:[{kind:'projectile_reflection',chance:{die:20,equals:[20]}}]}]}];
      actors.a.runtime.activeEffects.push({id:'marker',name:'Concentrating',source:'spell',mechanics:{kind:'concentration',effectIds:[]}});
    });
    session.get().concentrations.a={id:'concentration',sourceActorId:'a',actionId:'concentration-spell',startedAtRevision:0,effectLinks:[]};
    session.dispatch({type:'UseAction',actionId:arrow.id,targetIds:['b'],factsByTarget:{b:facts}});
    let pending=session.get().pendingResolution!;expect(pending.type).toBe('damage_reaction');
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'a',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:guard.id}});
    expect(session.get().actors.a.runtime.hp.current).toBe(28);expect(session.get().actors.b.runtime.hp.current).toBe(30);
    pending=session.get().pendingResolution!;expect(pending.type).toBe('concentration_save');
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'a',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'roll',roll:{mode:'system'}}});
    expect(session.get().pendingResolution).toBeNull();
    expect(session.get().actors.a.runtime.resources).toMatchObject({action:0,reaction:0});
    expect(session.get().concentrations.a?.id).toBe('concentration');
  });
  it.each([5,10])('executes an observer attack within its own %s ft range without spending a reaction',range=>{
    const counter:RuleActionDefinition={...strike,id:'observer',name:'Observer attack',targeting:{...strike.targeting!,rangeFt:range},mechanics:{
      activation:{mode:'triggered',optional:false,cost:[],trigger:{event:'attacked',timing:'after',observer_range_ft:range,observer_relations:['enemy'],exclude_self_target:true,target_event:'source'}},
      effects:[{resolution:'attack_roll',ability:'str',attack_kind:'melee',on_hit:[{kind:'damage',amount:2,type:'piercing'}]}]}};
    const session=setup([counter],[12,12],actors=>{
      actors.b.capabilities.actionIds=[];actors.c=actor('c',['observer']);actors.d=actor('d',['observer']);
      actors.c.character.spatialObservations={boardRevision:1,nearby:[{actorId:'a',relation:'enemy',distanceFt:range,lineOfSight:true,canSeeTarget:true}]};
      actors.d.character.spatialObservations={boardRevision:1,nearby:[{actorId:'a',relation:'enemy',distanceFt:range+5,lineOfSight:true}]};
    });
    session.dispatch({type:'UseAction',actionId:'strike',targetIds:['b'],factsByTarget:{b:facts}});
    expect(session.get().actors.a.runtime.hp.current).toBe(28);
    expect(session.get().actors.b.runtime.hp.current).toBe(27);
    expect(session.get().actors.c.runtime.resources.reaction).toBe(1);
    expect(session.get().actors.c.runtime.resources.action).toBe(1);
    expect(session.get().pendingResolution).toBeNull();
    session.reload();expect(session.get().actors.a.runtime.hp.current).toBe(28);
  });
  it.each([{die:20,defend:true},{die:10,defend:false}])('reflects a projectile on d$die into its source with a persisted defense window',spec=>{
    const arrow:RuleActionDefinition={...strike,id:'source-projectile',mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
      effects:[{resolution:'attack_roll',ability:'str',attack_kind:'ranged',projectile:true,on_hit:[{kind:'damage',amount:4,type:'piercing'}]}]}};
    const shield:RuleActionDefinition={id:'source-shield',name:'Defense',kind:'nonSpell',sourceEntityIds:['defense-source'],mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'hit_by_attack'}},
      effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',applies_to:{roll:'ac'},op:'add',value:5,duration:{unit:'round',amount:1}}]}]}};
    const session=setup([arrow,shield],[{sides:spec.die,value:spec.die},10],actors=>{
      actors.b.passives=[{effects:[{resolution:'auto',result:[{kind:'projectile_reflection',chance:{die:spec.die,equals:[spec.die]}}]}]}];
    });
    session.dispatch({type:'UseAction',actionId:arrow.id,targetIds:['b'],factsByTarget:{b:facts}});
    const pending=session.get().pendingResolution!;expect(pending.type).toBe('attack_reaction');
    expect(pending.request.actorId).toBe('a');
    expect(session.get().actors.a.runtime.resources.action).toBe(0);
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'a',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:spec.defend?shield.id:null}});
    expect(session.get().actors.b.runtime.hp.current).toBe(30);
    expect(session.get().actors.a.runtime.hp.current).toBe(spec.defend?30:26);
    expect(session.get().actors.a.runtime.resources.action).toBe(0);
    expect(session.get().actors.a.runtime.resources.reaction).toBe(spec.defend?0:1);
    expect(session.get().pendingResolution).toBeNull();
  });
  it.each([{fraction:1,range:10,linked:false},{fraction:.5,range:60,linked:true}])('transfers $fraction of actual damage, rechecking ownership and preserving both defenses after reload',spec=>{
    const attack:RuleActionDefinition={...strike,id:'source-flame',mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
      effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:12,type:'fire'}]}]}};
    const transfer:RuleActionDefinition={id:'transfer',name:'Take damage',kind:'nonSpell',sourceEntityIds:['protection-item'],mechanics:{
      damage_transfer:{fraction:spec.fraction,...spec.linked?{requires_link:'bond'}:{}},activation:{mode:spec.linked?'reaction':'triggered',optional:true,cost:spec.linked?[{resource:'reaction',amount:1}]:[],
        trigger:{event:'damage_taken',timing:'before',observer_range_ft:spec.range,observer_relations:['ally'],requires_visibility:false}},effects:[]}};
    const session=setup([attack,transfer],[],actors=>{
      actors.b.capabilities.actionIds=[];actors.c=actor('c',['transfer']);
      for(const id of ['b','c'])actors[id].passives=[{kind:'resistance',damage_type:'fire',value:'resistance'}];
      actors.c.character.spatialObservations={boardRevision:1,nearby:[{actorId:'b',relation:'ally',distanceFt:spec.range}]};
      if(spec.linked)actors.b.runtime.activeEffects.push({id:'bond',name:'Bond',source:'Bond',sourceId:'c',mechanics:{kind:'damage_transfer_link',key:'bond'}});
    });
    session.dispatch({type:'UseAction',actionId:attack.id,targetIds:['b'],factsByTarget:{b:facts}});
    const pending=session.get().pendingResolution!;expect(pending.type).toBe('damage_reaction');expect(pending.request.actorId).toBe('c');
    expect(session.get().actors.b.runtime.hp.current).toBe(30);expect(session.get().actors.c.runtime.hp.current).toBe(30);
    session.reload();
    const accepted=session.dispatch({type:'ResolveDecision',actorId:'c',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:transfer.id}});
    const moved=Math.floor(6*spec.fraction);
    expect(session.get().actors.b.runtime.hp.current).toBe(30-(6-moved));
    expect(session.get().actors.c.runtime.hp.current).toBe(30-Math.floor(moved/2));
    expect(session.get().actors.c.runtime.resources.reaction).toBe(spec.linked?0:1);
    expect(session.get().actors.a.runtime.resources.action).toBe(0);
    expect(session.get().pendingResolution).toBeNull();
    expect(handleCommand(session.get(),accepted.command,session.catalog,session.env).status).not.toBe('accepted');
  });
  it.each(['advantage','disadvantage'])('replaces %s with two separate arrows and preserves the extra shot after an interrupt',mode=>{
    const weaponId=`bow-${mode}`;
    const bow={id:weaponId,name:weaponId,type:'weapon',mechanics:{weapon_profile:{weapon_type:`bow_${mode}`,proficiency_category:'simple',attack_ability:'dex',
      damage_lines:[{dice:'1d6',type:'piercing'}],default_attack_mode:'ranged',attack_modes:[{kind:'ranged',normal_ft:80,long_ft:320}],properties:['ammunition'],
      mastery_effect_id:'mastery:bow',ammo:{card_id:'arrow'},enchantment:{attack_bonus:0,damage_bonus:0,extra_damage_lines:[]},attunement:{required:false}}}} as unknown as Card;
    expect(parseWeaponProfile(bow)).toMatchObject({valid:true});
    const effect={resolution:'attack_roll',ability:'auto',attack_kind:'weapon_ranged',vs:'ac',on_hit:[{kind:'damage',dice:'weapon',type:'weapon',ability:'auto'}]};
    const targeting={shape:'single',domain:'actor',range_ft:320,min_targets:1,max_targets:1,actor_targets:true,allowed_relations:['enemy'],requires_line_of_sight:true};
    const primary:RuleActionDefinition={...strike,id:'source-arrow',targeting:{...strike.targeting!,rangeFt:320},mechanics:{targeting,
      activation:{mode:'active',cost:[{resource:'action'},{resource:'item',card_id:'arrow',amount:1}]},effects:[effect]}};
    const follow:RuleActionDefinition={...primary,id:'source-extra-arrow',name:'Extra arrow',mechanics:{targeting,
      activation:{mode:'triggered',optional:true,cost:[{resource:'equipped_weapon_ammo',amount:1}],trigger:{event:'attack_dice_followup',subject:'self',
        circumstances:[{kind:'event_data_equals',key:'weaponId',value:weaponId}]}},effects:[{...effect,attack_dice_child:true}]}};
    const shield:RuleActionDefinition={id:'shield',name:'Defense',kind:'nonSpell',sourceEntityIds:['shield-source'],
      mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'hit_by_attack'}},effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',target:'ac',op:'add',value:5,duration:{unit:'round',amount:1}}]}]}};
    const session=setup([primary,follow,shield],[12,{sides:6,value:4},5],actors=>{
      actors.a.character.abilityMods.dex=3;actors.a.character.weaponProficiencies=['simple'];
      actors.a.character.knownCards=[bow];actors.a.character.equippedCards=[bow];actors.a.runtime.equipment.main_hand=weaponId;
      actors.a.runtime.inventory=[{cardId:weaponId,qty:1},{cardId:'arrow',qty:2}];
      actors.a.passives=[{id:'split-bow',effects:[{resolution:'auto',result:[{kind:'weapon_attack_policy',weapon_id:weaponId,separate_d20_modes:[mode]},
        {kind:'modifier',op:mode,applies_to:{roll:'attack'}}]}]}];
    });
    session.dispatch({type:'UseAction',actionId:primary.id,targetIds:['b'],factsByTarget:{b:{...facts,distanceFt:30}}});
    const first=session.get().pendingResolution!;expect(first.type).toBe('attack_reaction');
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'b',resolutionId:first.id,requestId:first.request.id,response:{kind:'reaction',actionId:null}});
    const second=session.get().pendingResolution!;expect(second.type).toBe('event_reaction');
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'a',resolutionId:second.id,requestId:second.request.id,response:{kind:'reaction',actionId:follow.id}});
    expect(session.get().actors.b.runtime.hp.current).toBe(23);
    expect(session.get().actors.a.runtime.inventory.find(row=>row.cardId==='arrow')?.qty??0).toBe(0);
    expect(session.get().actors.a.runtime.resources.action).toBe(0);
    expect(session.get().actors.a.runtime.resources.reaction).toBe(1);
    expect(session.get().pendingResolution).toBeNull();
  });
  it.each([5,10])('resolves a %s ft item burst through saved damage reactions then the remaining targets',radius=>{
    const shield:RuleActionDefinition={id:'guard',name:'Guard',kind:'nonSpell',sourceEntityIds:['guard-source'],
      mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'damage_taken',timing:'before'}},effects:[{resolution:'auto',who:'self',result:[{kind:'reduce_damage',amount:2}]}]}};
    const session=setup([shield],[12,{sides:6,value:6}],actors=>{
      actors.b.capabilities.actionIds=[];
      actors.c=actor('c',['guard']);actors.d=actor('d',[]);actors.e=actor('e',[]);
      actors.a.character.spatialObservations={boardRevision:1,nearby:[{actorId:'b',relation:'enemy',distanceFt:5},
        {actorId:'c',relation:'enemy',distanceFt:radius},{actorId:'d',relation:'ally',distanceFt:radius},{actorId:'e',relation:'enemy',distanceFt:radius+5}]};
      actors.a.passives=[{id:`burst-${radius}`,damage_source_kind:'item',effects:[{resolution:'auto',result:[{kind:'triggered_effect',event:'damage_dealt',
        circumstances:[{kind:'event_data_equals',key:'secondary_source',value:false}],effects:[{resolution:'auto',result:[{
          kind:'area_damage',amount:'1d6',type:'fire',radius_ft:radius,origin:'self',recipients:'all',include_center:false}]}]}]}]}];
    });
    session.dispatch({type:'UseAction',actionId:'strike',targetIds:['b'],factsByTarget:{b:facts}});
    const pending=session.get().pendingResolution!;expect(pending.type).toBe('damage_reaction');
    expect(pending.request.actorId).toBe('c');
    expect(session.get().actors.b.runtime.hp.current).toBe(21);
    expect(session.get().actors.c.runtime.hp.current).toBe(30);
    expect(session.get().actors.d.runtime.hp.current).toBe(30);
    expect(session.get().areaConsequences).toHaveLength(1);
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'c',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:'guard'}});
    expect(session.get().actors.c.runtime.hp.current).toBe(26);
    expect(session.get().actors.d.runtime.hp.current).toBe(24);
    expect(session.get().actors.e.runtime.hp.current).toBe(30);
    expect(session.get().areaConsequences).toEqual([]);
    expect(session.get().pendingResolution).toBeNull();
  });
  it('cancels the second bonus attack before RNG even when a hit reaction requires prepaid costs',()=>{
    const bonus:RuleActionDefinition={...strike,id:'source-bonus',mechanics:{...strike.mechanics,activation:{mode:'active',cost:[{resource:'bonus_action'}]}}};
    const shield:RuleActionDefinition={id:'shield',name:'Defense',kind:'nonSpell',sourceEntityIds:['shield-source'],
      mechanics:{activation:{mode:'reaction',cost:[{resource:'reaction'}],trigger:{event:'hit_by_attack'}},effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',target:'ac',op:'add',value:5,duration:{unit:'round',amount:1}}]}]}};
    const session=setup([bonus,shield],[12],actors=>{
      actors.a.runtime.resources.bonus_action=2;actors.a.runtime.maxResources.bonus_action=2;
      actors.a.passives=[{id:'every-second-bonus',effects:[{resolution:'auto',result:[{kind:'triggered_effect',event:'resource_spent',
        circumstances:[{kind:'event_data_equals',key:'resource',value:'bonus_action'}],occurrence:{every:2,per:'lifetime'},effects:[{resolution:'auto',result:[{kind:'cancel_execution'}]}]}]}]}];
    });
    session.dispatch({type:'UseAction',actionId:bonus.id,targetIds:['b'],factsByTarget:{b:facts}});
    const pending=session.get().pendingResolution!;expect(pending.type).toBe('attack_reaction');
    session.dispatch({type:'ResolveDecision',actorId:'b',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:null}});
    session.reload();
    const hp=session.get().actors.b.runtime.hp.current;
    const cancelled=session.dispatch({type:'UseAction',actionId:bonus.id,targetIds:['b'],factsByTarget:{b:facts}});
    expect(session.get().pendingResolution).toBeNull();
    expect(session.get().actors.b.runtime.hp.current).toBe(hp);
    expect(session.get().actors.a.runtime.resources.bonus_action).toBe(0);
    expect(cancelled.result.events.some(event=>event.payload.type==='EngineEventRecorded'&&event.payload.event.type==='execution_cancelled')).toBe(true);
  });
  it.each([{event:'attacked',amount:4,id:'defender-retaliate',reactor:'b',victim:'a'},
    {event:'damage_dealt',amount:2,id:'source-lightning',reactor:'a',victim:'b'}])('persists $event choice, spends once and resumes through canonical damage',row=>{
    const action=reaction(row.id,row.event,row.amount),session=setup([action]);
    session.dispatch({type:'UseAction',actionId:'strike',targetIds:['b'],factsByTarget:{b:facts}});
    expect(session.get().actors.b.runtime.hp.current).toBe(27);
    const pending=session.get().pendingResolution;
    expect(pending?.type).toBe('event_reaction');
    expect(pending?.request.actorId).toBe(row.reactor);
    session.reload();
    const before=session.get().actors[row.victim].runtime.hp.current;
    const accepted=session.dispatch({type:'ResolveDecision',actorId:row.reactor,resolutionId:pending!.id,requestId:pending!.request.id,response:{kind:'reaction',actionId:row.id}});
    expect(session.get().actors[row.victim].runtime.hp.current).toBe(before-row.amount);
    expect(session.get().actors[row.reactor].runtime.resources.reaction).toBe(0);
    expect(session.get().pendingResolution).toBeNull();
    expect(handleCommand(session.get(),accepted.command,session.catalog,session.env).status).toBe('rejected');
  });
  it('holds both owners in event order, validates critical filter and decline costs nothing',()=>{
    const session=setup([reaction('defender-retaliate','attacked',2,true),reaction('source-lightning','damage_dealt',3)],[20]);
    session.dispatch({type:'UseAction',actionId:'strike',targetIds:['b'],factsByTarget:{b:facts}});
    const first=session.get().pendingResolution!;
    expect(first.request.actorId).toBe('b');
    expect(session.get().eventReactions).toHaveLength(1);
    session.reload();
    session.dispatch({type:'ResolveDecision',actorId:'b',resolutionId:first.id,requestId:first.request.id,response:{kind:'reaction',actionId:null}});
    expect(session.get().actors.b.runtime.resources.reaction).toBe(1);
    const second=session.get().pendingResolution!;
    expect(second.request.actorId).toBe('a');
    session.dispatch({type:'ResolveDecision',actorId:'a',resolutionId:second.id,requestId:second.request.id,response:{kind:'reaction',actionId:null}});
    expect(session.get().pendingResolution).toBeNull();
    expect(session.get().eventReactions).toEqual([]);
  });
});
