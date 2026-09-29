import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {createLogicalClock,createSequentialIdFactory,createStrictRngTape} from './determinism';
import {InMemoryRulesSession} from './session';
import {foldEvents} from './reducer';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'save-damage',contentHash:'save-damage',errataVersion:'2024'};
function actor(id:string,actions:string[]):ActorState{return {id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:actions},
  character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:3},
  runtime:{hp:{current:20,max:20,temp:0},resources:{action:1,reaction:1,evade:6},maxResources:{action:1,reaction:1,evade:6},inventory:[],equipment:{},activeEffects:[]}};}
const blast:RuleActionDefinition={id:'blast',name:'Blast',kind:'nonSpell',sourceEntityIds:['blast'],targeting:{minTargets:1,maxTargets:2,rangeFt:30,requiresLineOfSight:true,allowedRelations:['enemy']},
  mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'save',ability:'dex',dc:12,who:'target',
    on_fail:[{kind:'damage',dice:'1d6',type:'fire'}],on_success:[{kind:'damage',dice:'1d6',type:'fire',on_success:'half'}]}]}};
const evade=(id:string,outcome:'success'|'failure'):RuleActionDefinition=>({id,name:id,kind:'nonSpell',sourceEntityIds:[id],
  targeting:{minTargets:0,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']},
  mechanics:{activation:{mode:'reaction',trigger:{event:'damage_taken',timing:'before',circumstances:[
    {kind:'event_data_equals',key:'saveAbility',value:'dex'},{kind:'event_data_equals',key:'saveDamage',value:'half'},{kind:'event_data_equals',key:'saveOutcome',value:outcome},
  ]},cost:[{resource:'evade'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'reduce_damage',amount:outcome==='success'?'incoming_damage':'ceil(incoming_damage/2)'}]}]}});
const facts={factsSource:'scenario' as const,boardRevision:1,distanceFt:10,lineOfSight:true,cover:'none' as const,relation:'enemy' as const};
type Input=GameCommand extends infer C?C extends GameCommand?Omit<C,'schemaVersion'|'expectedRevision'|'rulesetContentHash'>:never:never;
function command(s:InMemoryRulesSession,input:Input):GameCommand{return {schemaVersion:1,expectedRevision:s.getState().revision,rulesetContentHash:ruleset.contentHash,...input} as GameCommand;}
function accept(s:InMemoryRulesSession,input:Input){const r=s.dispatch(command(s,input));if(r.status==='rejected')throw Error(`${r.code}: ${r.message}`);return r;}
describe('saving throw damage reaction continuation',()=>{
  it.each([['cloak','failure',3,18],['charm','success',15,20]] as const)('persists %s charge choice, resumes area saves and never rerolls shared damage', (id,outcome,die,hp)=>{
    const defense=evade(id,outcome),catalog={getAction:(ref:string)=>ref==='blast'?blast:ref===id?defense:undefined};
    const initial=createWorld({id,ruleset,actors:[actor('source',['blast']),actor('target',[id]),actor('other',[])]});
    const tape=createStrictRngTape([{label:'first save',sides:20,value:die},{label:'shared damage',sides:6,value:5},{label:'second save',sides:20,value:2}]);
    const env={rng:tape.rng,clock:createLogicalClock(),nextId:createSequentialIdFactory(id)};
    let s=new InMemoryRulesSession(initial,catalog,env);
    accept(s,{actorId:'source',type:'StartEncounter',commandId:'start',initiative:['source','target','other']});
    accept(s,{actorId:'source',type:'StartTurn',commandId:'turn'});
    accept(s,{actorId:'source',type:'UseAction',commandId:'cast',actionId:'blast',targetIds:['target','other'],factsByTarget:{target:facts,other:facts}});
    let p=s.getState().pendingResolution;if(p?.type!=='target_save')throw Error('Expected target save');
    accept(s,{actorId:'target',type:'ResolveDecision',commandId:'save',resolutionId:p.id,requestId:p.request.id,response:{kind:'roll',roll:{mode:'system'}}});
    p=s.getState().pendingResolution;if(p?.type!=='damage_reaction')throw Error(`Expected damage reaction, got ${p?.type}`);
    expect(s.getState().actors.target.runtime.hp.current).toBe(20);expect(s.getState().actors.target.runtime.resources.evade).toBe(6);
    const prefix=[...s.getEvents()];s=new InMemoryRulesSession(JSON.parse(JSON.stringify(s.snapshot().world)),catalog,env);
    const choose=command(s,{actorId:'target',type:'ResolveDecision',commandId:'evade',resolutionId:p.id,requestId:p.request.id,response:{kind:'reaction',actionId:id}});
    const result=s.dispatch(choose);if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);
    expect(s.getState().actors.target.runtime.hp.current).toBe(hp);expect(s.getState().actors.target.runtime.resources).toMatchObject({evade:5,reaction:1});
    const after=JSON.stringify(s.getState());expect(s.dispatch(choose).status).toBe('rejected');expect(JSON.stringify(s.getState())).toBe(after);
    p=s.getState().pendingResolution;if(p?.type!=='target_save'||p.targetActorId!=='other')throw Error('Lost next area target');
    accept(s,{actorId:'other',type:'ResolveDecision',commandId:'second-save',resolutionId:p.id,requestId:p.request.id,response:{kind:'roll',roll:{mode:'system'}}});
    expect(s.getState().actors.other.runtime.hp.current).toBe(15);expect(s.getState().pendingResolution).toBeNull();tape.assertExhausted();
    expect(foldEvents(initial,[...prefix,...s.getEvents()])).toEqual(s.getState());
  });
});
