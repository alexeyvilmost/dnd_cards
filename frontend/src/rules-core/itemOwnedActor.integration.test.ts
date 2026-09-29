import {describe,expect,it} from 'vitest';
import {CARD_DAGGER,CARD_LONGSWORD} from '../mvp/fixtures';
import lowItems from '../../../scripts/content/data/item-completion-low-20260929.json';
import lowRelated from '../../../scripts/content/data/item-completion-low-related-20260929.json';
import compiledFixture from '../pages/rulesLabFixture.generated.json';
import type {SheetCanonicalRuntime} from '../character/sheetCanonicalWorld';
import type {SheetCombatParticipantSeed} from '../character/sheetCombatSession';
import type {ForgeCharacter} from '../character/types';
import type {Monster} from '../monsters/types';
import {createSoloCombatState,executeCombatAction,selectedTargetsForAction} from '../solo-combat/engine';
import {materializeItemOwnedActors,itemOwnedActorId} from '../solo-combat/itemOwnedActors';
import {spatialFacts,type SoloCombatState} from '../solo-combat/types';
import type {Action,Card} from '../types';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition,type RulesetReference} from './domain';
import {InMemoryRulesSession} from './session';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'item-turn-test',contentHash:'item-turn-test',errataVersion:'2024'};
const facts={factsSource:'scenario' as const,boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none' as const,relation:'enemy' as const};

function fixture(weapon:Card,sourceAction?:Action,sourcePassive?:Record<string,unknown>){
  const actionCard=sourceAction??{id:`action:${weapon.id}`,card_number:`ACTION-${weapon.id}`,name:`${weapon.name}: самостоятельная атака`,
    image_url:'',description:'Одна атака в собственный ход.',mechanics:{
      activation:{mode:'active',cost:[{resource:'action',amount:1}]},
      requires_held_item:weapon.id,weapon_source_id:weapon.id,
      targeting:{domain:'actor',actor_targets:true,shape:'single',min_targets:1,max_targets:1,range_ft:5,requires_line_of_sight:true,allowed_relations:['enemy']},
      effects:[{resolution:'attack_roll',ability:'auto',attack_kind:'weapon_melee',on_hit:[{kind:'damage',dice:'weapon',type:'weapon',ability:'auto'}]}],
    }} as unknown as Action;
  const owner:ActorState={id:'owner',name:'Владелец',kind:'playerCharacter',controllerId:'player',ac:12,
    capabilities:{actionIds:[]},character:{level:5,profBonus:3,abilityScores:{str:16,dex:18,con:10,int:10,wis:10,cha:10},
      abilityMods:{str:3,dex:4,con:0,int:0,wis:0,cha:0},
      weaponProficiencies:['longsword','dagger','greatsword'],knownCards:[weapon],equippedCards:[weapon]},
    runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,bonus_action:1,reaction:1},
      maxResources:{action:1,bonus_action:1,reaction:1},equipment:{main_hand:weapon.id},
      inventory:[{cardId:weapon.id,qty:1}],activeEffects:[]},
    passives:[sourcePassive??{kind:'item_owned_actor',item_card_id:weapon.id,action_ref:actionCard.card_number,
      initiative:'independent',attacks_per_turn:1}]};
  const target:ActorState={id:'target',name:'Цель',kind:'monster',controllerId:'gm',ac:10,
    capabilities:{actionIds:[]},character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
    runtime:{hp:{current:30,max:30,temp:0},resources:{action:1},maxResources:{action:1},equipment:{},inventory:[],activeEffects:[]}};
  const world=createWorld({id:'item-turn',ruleset,actors:[owner,target]});
  const state=materializeItemOwnedActors({characterId:owner.id,controlledCharacterIds:[owner.id],world,
    tokens:{owner:{actorId:'owner',position:{x:2,y:2},color:'#fff'},target:{actorId:'target',position:{x:3,y:2},color:'#f00'}},
    sideByActorId:{owner:'party',target:'enemy'},actorPresentation:{},playerActionIdsByActor:{owner:[]},
    certifiedPlayerActionIdsByActor:{owner:[]},movementRemainingFt:{owner:30,target:30},
    initiativeBonuses:{owner:4,target:0},catalogActions:[],actionPresentation:{},
  } as unknown as SoloCombatState,[actionCard]);
  const turnId=itemOwnedActorId(owner.id,weapon.id);
  const action=state.catalogActions.find(row=>row.id===actionCard.id)!;
  return {state,turnId,action,actionCard};
}

function accepted(session:InMemoryRulesSession,command:GameCommand){
  const result=session.dispatch(command);
  if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);
  return result;
}

describe('generic item-owned initiative actor',()=>{
  it('executes the catalog declaration for Меч-мимик +1 with its own 2d6+1 weapon profile',()=>{
    const row=lowItems['CARD-0185'];
    const related=lowRelated.entities.find(entry=>entry.card_number==='ACT-item-completion-low-0185-strike')!;
    const weapon={...CARD_LONGSWORD,id:row.id,name:row.name,card_number:'CARD-0185',
      mechanics:row.mechanics} as Card;
    const actionCard={...related.patch,created_at:'',updated_at:''} as unknown as Action;
    const {state,turnId,action}=fixture(weapon,actionCard,row.mechanics);
    const world=state.world;
    world.scene={mode:'encounter',round:1,activeIndex:0,initiative:[turnId,'owner','target'],turnStarted:true};
    const session=new InMemoryRulesSession(world,{getAction:id=>id===action.id?action:undefined},
      {rng:()=>0.55,clock:()=>1,nextId:()=>''});
    const result=accepted(session,{schemaVersion:1,type:'UseAction',commandId:'mimic-catalog',expectedRevision:0,
      rulesetContentHash:ruleset.contentHash,actorId:turnId,actionId:action.id,targetIds:['target'],factsByTarget:{target:facts}});
    const damages=result.events.flatMap(row=>row.payload.type==='EngineEventRecorded'&&row.payload.event.type==='damage'
      ?[row.payload.event.amount]:[]);
    expect(damages).toEqual([12]);
    expect(session.getState().actors.owner.runtime.resources.action).toBe(1);
    expect(session.getState().actors[turnId].runtime.resources.action).toBe(0);
  });
  it('enters solo combat as an independent participant but stays attached to its owner on the board',async()=>{
    const sample=fixture(CARD_LONGSWORD);
    const lab=compiledFixture as unknown as {source:{ruleset:RulesetReference};roots:{magicInitiateFighter:{actor:ActorState;actions:RuleActionDefinition[]}}};
    const owner=JSON.parse(JSON.stringify(lab.roots.magicInitiateFighter.actor)) as ActorState;
    owner.passives=[...(owner.passives??[]),...sample.state.world.actors.owner.passives??[]];
    owner.character={...owner.character,knownCards:[CARD_LONGSWORD],equippedCards:[CARD_LONGSWORD]};
    owner.runtime.equipment={...owner.runtime.equipment,main_hand:CARD_LONGSWORD.id};
    owner.runtime.inventory=[...owner.runtime.inventory,{cardId:CARD_LONGSWORD.id,qty:1}];
    const actions=lab.roots.magicInitiateFighter.actions;
    const catalog={getAction:(id:string)=>actions.find(row=>row.id===id),listActions:()=>actions};
    const canonical:SheetCanonicalRuntime={actorId:owner.id,
      world:createWorld({id:'item-initiative',ruleset:lab.source.ruleset,actors:[owner]}),actions,catalog,cards:[],
      resourceBindings:{},actionFor:()=>{throw Error('No sheet action needed');}};
    const character={id:owner.id,name:owner.name,user_id:'test',access_mode:'owner',system_id:'dnd5e-2024',
      ruleset_version:'2024',runtime_revision:0,current_hp:owner.runtime.hp.current,max_hp:owner.runtime.hp.max,
      resources:owner.runtime.resources,max_resources:owner.runtime.maxResources,
      active_effects:owner.runtime.activeEffects,turn_state:{},initiative_bonus:4,speed:30} as unknown as ForgeCharacter;
    const participant:SheetCombatParticipantSeed={character,canonical};
    const monsterAction={id:'monster-item-turn-test',name:'Удар противника',description:'',rarity:'common',
      card_number:'MONSTER-ACTION-ITEM-TURN-TEST',resource:'action',action_type:'base_action',type:'monster',
      created_at:'',updated_at:'',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},
        targeting:{domain:'actor',actor_targets:true,shape:'single',min_targets:1,max_targets:1,range_ft:5,requires_line_of_sight:true,allowed_relations:['enemy']},
        effects:[{resolution:'attack_roll',ability:'str',attack_kind:'weapon_melee',on_hit:[{kind:'damage',dice:'1d4',type:'slashing'}]}]}} as Action;
    const monster={id:'monster-item-turn-test',slug:'monster-item-turn-test',name:'Противник',description:'',size:'medium',
      creature_type:'humanoid',alignment:'',challenge_rating:'1',armor_class:10,max_hp:30,speed:30,initiative_bonus:0,
      proficiency_bonus:2,abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[monsterAction.id],effect_ids:[],
      ai:{strategy:'melee_chase'},token_url:'',source:'test',created_at:'',updated_at:''} as Monster;
    let draws=0;
    const combat=await createSoloCombatState({character,participant,selected:[{monster,quantity:1}],
      actions:[monsterAction,sample.actionCard],effects:[],rng:()=>{draws++;return 0.5;}});
    const turnId=itemOwnedActorId(owner.id,CARD_LONGSWORD.id);
    expect(combat.initiative.map(row=>row.actorId)).toContain(turnId);
    expect(combat.initiative.find(row=>row.actorId===turnId)?.roll?.dice).toContainEqual(expect.objectContaining({sides:20}));
    expect(draws).toBeGreaterThanOrEqual(3);
    expect(combat.tokens[turnId]).toMatchObject({attachedToActorId:owner.id,position:combat.tokens[owner.id].position});
    expect(()=>selectedTargetsForAction({state:combat,actorId:owner.id,actionId:sample.action.id,
      clickedActorId:turnId,clickedPosition:combat.tokens[owner.id].position})).toThrow('не является отдельной целью');
    const monsterId=Object.values(combat.world.actors).find(row=>row.kind==='monster')!.id;
    const nearby={x:combat.tokens[owner.id].position.x,y:combat.tokens[owner.id].position.y-1};
    const activeIndex=combat.world.scene.mode==='encounter'?combat.world.scene.initiative.indexOf(turnId):-1;
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    const prepared={...combat,boardRevision:combat.boardRevision+1,
      tokens:{...combat.tokens,[monsterId]:{...combat.tokens[monsterId],position:nearby}},
      world:{...combat.world,scene:{...combat.world.scene,activeIndex,turnStarted:true}}} as typeof combat;
    expect(spatialFacts(prepared,turnId,monsterId).nearbyEligibleAllyToTarget).toBe(false);
    expect(spatialFacts(prepared,turnId,monsterId).damageObservers?.some(row=>row.actorId===turnId)).toBe(false);
    const resolved=executeCombatAction({state:prepared,actorId:turnId,actionId:sample.action.id,
      targetIds:[monsterId],rng:()=>0.55});
    expect(resolved.world.actors[monsterId].runtime.hp.current).toBeLessThan(30);
    expect(resolved.world.actors[owner.id].runtime.resources.action).toBe(1);
    expect(resolved.world.actors[turnId].runtime.resources.action).toBe(0);
  });
  it.each([CARD_LONGSWORD,CARD_DAGGER])('uses the live wielder with %s, one item Action and a durable command',weapon=>{
    const {state,turnId,action}=fixture(weapon);
    expect(state.world.actors[turnId].itemTurn).toEqual({ownerActorId:'owner',itemCardId:weapon.id,actionId:action.id});
    expect(state.tokens[turnId]).toMatchObject({attachedToActorId:'owner',position:{x:2,y:2}});
    expect(state.initiativeBonuses[turnId]).toBe(4);
    const world=state.world;
    let draws=0;
    const catalog={getAction:(id:string):RuleActionDefinition|undefined=>id===action.id?action:undefined};
    const env={rng:()=>{draws++;return 0.55;},clock:()=>1,nextId:()=>`item:${draws}`};
    const session=new InMemoryRulesSession(world,catalog,env);
    accepted(session,{schemaVersion:1,type:'StartEncounter',commandId:'encounter',expectedRevision:0,
      rulesetContentHash:ruleset.contentHash,actorId:'owner',initiative:[turnId,'owner','target']});
    accepted(session,{schemaVersion:1,type:'StartTurn',commandId:'item-turn',expectedRevision:session.getState().revision,
      rulesetContentHash:ruleset.contentHash,actorId:turnId});
    const attack={schemaVersion:1 as const,type:'UseAction' as const,commandId:`attack:${weapon.id}`,
      expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,
      actorId:turnId,actionId:action.id,targetIds:['target'],factsByTarget:{target:facts}};
    const result=accepted(session,attack);
    const damage=result.events.flatMap(row=>row.payload.type==='EngineEventRecorded'&&row.payload.event.type==='damage'
      ?[row.payload.event.amount]:[]);
    expect(damage).toEqual([weapon.id===CARD_LONGSWORD.id?8:7]);
    expect(session.getState().actors.target.runtime.hp.current).toBe(30-damage[0]);
    expect(session.getState().actors.owner.runtime.resources.action).toBe(1);
    expect(session.getState().actors[turnId].runtime.resources.action).toBe(0);
    const saved=JSON.parse(JSON.stringify(session.getState()));
    const restored=new InMemoryRulesSession(saved,catalog,{...env,rng:()=>{throw Error('A replay must not reroll');}});
    expect(restored.dispatch(attack)).toMatchObject({status:'rejected',code:'DuplicateCommand'});
    expect(restored.getState().actors.target.runtime.hp.current).toBe(30-damage[0]);
    expect(draws).toBeGreaterThan(0);
  });
  it('rejects a removed weapon before spending the item turn',()=>{
    const {state,turnId,action}=fixture(CARD_LONGSWORD);
    state.world.actors.owner.runtime.equipment.main_hand=null;
    const session=new InMemoryRulesSession(state.world,{getAction:id=>id===action.id?action:undefined},
      {rng:()=>{throw Error('Invalid attack rolled');},clock:()=>1,nextId:()=>''});
    accepted(session,{schemaVersion:1,type:'StartEncounter',commandId:'encounter',expectedRevision:0,
      rulesetContentHash:ruleset.contentHash,actorId:'owner',initiative:[turnId,'owner','target']});
    accepted(session,{schemaVersion:1,type:'StartTurn',commandId:'item-turn',expectedRevision:session.getState().revision,
      rulesetContentHash:ruleset.contentHash,actorId:turnId});
    const result=session.dispatch({schemaVersion:1,type:'UseAction',commandId:'unequipped',expectedRevision:session.getState().revision,
      rulesetContentHash:ruleset.contentHash,actorId:turnId,actionId:action.id,targetIds:['target'],factsByTarget:{target:facts}});
    expect(result).toMatchObject({status:'rejected',code:'InvalidEquipmentState'});
    expect(session.getState().actors[turnId].runtime.resources.action).toBe(1);
  });
});
