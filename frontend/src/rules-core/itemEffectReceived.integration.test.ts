import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition,type RulesCatalog,type SpatialFacts} from './domain';
import {handleCommand} from './handler';
import {createStrictRngTape,createSequentialIdFactory} from './determinism';
import {migrateWorldState} from './worldMigration';
import {foldEvents} from './reducer';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'item-event-test',contentHash:'sha256:item-event-test',errataVersion:'2024'};
const facts:SpatialFacts={factsSource:'scenario',boardRevision:1,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy'};
function actor(id:string,actionIds:string[]):ActorState{return {id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds},
  character:{abilityMods:{str:3,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
  runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1,bonus_action:1},maxResources:{action:1,reaction:1,bonus_action:1},inventory:[],equipment:{},activeEffects:[]}};}
const strike:RuleActionDefinition={id:'strike',name:'Strike',kind:'nonSpell',sourceEntityIds:['weapon-source'],
  targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']},
  mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},effects:[{resolution:'attack_roll',ability:'str',attack_kind:'melee',on_hit:[{kind:'damage',amount:3,type:'bludgeoning'}]}]}};
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


describe('new negative effect instance reactions',()=>{
 it.each(['incapacitated','poisoned'])('can reject the new %s instance using pre-application reaction capacity',condition=>{
  const apply:RuleActionDefinition={...strike,id:'source-condition',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'condition',value:condition}]}]}};
  const remove:RuleActionDefinition={id:'remove',name:'Отвергнуть эффект',kind:'nonSpell',sourceEntityIds:['item-reject'],targeting:{minTargets:0,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']},
    mechanics:{activation:{mode:'reaction',trigger:{event:'effect_received',timing:'after',circumstances:[{kind:'event_data_equals',key:'negative',value:true}]},cost:[{resource:'reaction'},{resource:'removal_charge'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'remove_effect',event_effect:true}]}]}};
  const s=setup([apply,remove],[],actors=>{actors.b.runtime.resources.removal_charge=1;actors.b.runtime.maxResources.removal_charge=1;actors.b.runtime.activeEffects=[{id:'preexisting',name:'Existing',source:'other',mechanics:{kind:'condition',value:'deafened'}}];});
  s.dispatch({type:'UseAction',actionId:apply.id,targetIds:['b'],factsByTarget:{b:facts}});
  const pending=s.get().pendingResolution;expect(pending?.type).toBe('event_reaction');if(pending?.type!=='event_reaction')throw Error('Missing effect choice');
  const appliedId=pending.opportunity.event.data?.effectId;
  expect(s.get().actors.b.runtime.activeEffects.some(effect=>effect.id===appliedId)).toBe(true);expect(s.get().actors.b.runtime.resources.reaction).toBe(1);
  s.reload();const response={type:'ResolveDecision',actorId:'b',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:remove.id}};
  const {command}=s.dispatch(response);
  expect(s.get().actors.b.runtime.activeEffects.map(effect=>effect.id)).toEqual(['preexisting']);expect(s.get().actors.b.runtime.resources.reaction).toBe(0);expect(s.get().actors.b.runtime.resources.removal_charge).toBe(0);
  const before=JSON.stringify(s.get());expect(handleCommand(s.get(),command,s.catalog,s.env).status).toBe('rejected');expect(JSON.stringify(s.get())).toBe(before);
 });
 it.each(['beneficial','already-incapacitated'])('does not invent an opportunity for %s effects',scenario=>{
  const apply:RuleActionDefinition={...strike,id:'source-condition',mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'target',result:[{kind:'condition',value:scenario==='beneficial'?'invisible':'poisoned'}]}]}};
  const remove:RuleActionDefinition={id:'remove',name:'Remove',kind:'nonSpell',sourceEntityIds:['item'],mechanics:{activation:{mode:'reaction',trigger:{event:'effect_received'},cost:[{resource:'reaction'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'remove_effect',event_effect:true}]}]}};
  const s=setup([apply,remove],[],actors=>{if(scenario==='already-incapacitated')actors.b.runtime.activeEffects=[{id:'old',name:'Old',source:'old',mechanics:{kind:'condition',value:'incapacitated'}}];});
  s.dispatch({type:'UseAction',actionId:apply.id,targetIds:['b'],factsByTarget:{b:facts}});expect(s.get().pendingResolution).toBeNull();expect(s.get().actors.b.runtime.resources.reaction).toBe(1);
 });
});
