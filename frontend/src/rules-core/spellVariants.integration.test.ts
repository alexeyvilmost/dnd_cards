import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {createSequentialIdFactory,createStrictRngTape} from './determinism';
import {handleCommand} from './handler';
import {foldEvents} from './reducer';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'variants',contentHash:'variants',errataVersion:'2024'};
const targeting={minTargets:0,maxTargets:0,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self'] as const};
const base={activation:{mode:'active',cost:[{resource:'action',amount:1},{resource:'spell_slot_1',amount:1}]},targeting:{domain:'actor',shape:'self',actor_targets:false,range_ft:0,min_targets:0,max_targets:0,allowed_relations:['self'],requires_line_of_sight:false}};
const parent:RuleActionDefinition={id:'parent-spell',name:'Parent',kind:'spell',sourceEntityIds:['parent-spell'],spell:{level:1},targeting:{...targeting,allowedRelations:['self']},mechanics:{...base,spell_variant_ids:['spell-strength','spell-wisdom'],effects:[]}};
function variant(id:string,amount:number):RuleActionDefinition{return {id,name:id,kind:'spell',sourceEntityIds:[id],spell:{level:1},targeting:{...targeting,allowedRelations:['self']},mechanics:{...base,variant_of_spell_id:parent.id,effects:[{resolution:'auto',who:'self',result:[{kind:'healing',amount}]}]}};}
const strength=variant('spell-strength',2),wisdom=variant('spell-wisdom',4);
const catalog={getAction:(id:string)=>[parent,strength,wisdom].find(action=>action.id===id)};
function hero():ActorState{return {id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',ac:10,capabilities:{actionIds:[parent.id]},character:{level:3,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
  runtime:{hp:{current:5,max:10,temp:0},resources:{action:1,spell_slot_1:1,spell_slot_2:1},maxResources:{action:1,spell_slot_1:1,spell_slot_2:1},inventory:[],equipment:{},activeEffects:[]},
  spellcastingAccess:{grants:[{grantId:'parent-grant',actionId:parent.id,sourceId:'class:wizard',access:'known',level:1,slotResource:'spell_slot_1'}],preparedSources:{}}};}
function use(id:string,castLevel:number):GameCommand{return {schemaVersion:1,type:'UseAction',commandId:`cast:${id}:${castLevel}`,actorId:'hero',expectedRevision:0,rulesetContentHash:ruleset.contentHash,actionId:id,targetIds:[],spell:{baseLevel:1,castLevel,grantId:'parent-grant',mode:'normal'}};}
describe('spell variants are cast through the parent grant',()=>{
  it.each([[strength,2,1],[wisdom,4,2]] as const)('executes %s only through parent ownership and pays the chosen slot', (variantAction,healing,castLevel)=>{
    const world=createWorld({id:`world:${variantAction.id}`,ruleset,actors:[hero()]});
    const tape=createStrictRngTape([]),env={rng:tape.rng,nextId:createSequentialIdFactory('variant'),clock:()=>1};
    expect(handleCommand(world,use(parent.id,1),catalog,env).status).toBe('rejected');
    const result=handleCommand(world,use(variantAction.id,castLevel),catalog,env);
    if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
    expect(foldEvents(world,result.events)).toEqual(result.nextState);
    expect(result.nextState.actors.hero.runtime.hp.current).toBe(5+healing);
    expect(result.nextState.actors.hero.runtime.resources[`spell_slot_${castLevel}`]).toBe(0);
    expect(result.nextState.actors.hero.runtime.resources[`spell_slot_${castLevel===1?2:1}`]).toBe(1);
    expect(handleCommand(result.nextState,use(variantAction.id,castLevel),catalog,env).status).toBe('rejected');
    tape.assertExhausted();
  });
  it('does not accept an unlisted child or a missing parent grant',()=>{
    const foreign=variant('spell-foreign',3),world=createWorld({id:'foreign',ruleset,actors:[hero()]});
    const env={rng:()=>{throw Error('No RNG');},nextId:createSequentialIdFactory('foreign'),clock:()=>1};
    expect(handleCommand(world,use(foreign.id,1),{getAction:(id:string)=>id===foreign.id?foreign:catalog.getAction(id)},env)).toMatchObject({status:'rejected',code:'InvalidActionDefinition'});
    world.actors.hero.capabilities.actionIds=[];
    expect(handleCommand(world,use(strength.id,1),catalog,env)).toMatchObject({status:'rejected',code:'ActionNotGranted'});
    world.actors.hero.capabilities.actionIds=[strength.id];
    expect(handleCommand(world,use(strength.id,1),catalog,env)).toMatchObject({status:'rejected',code:'ActionNotGranted'});
  });
});
