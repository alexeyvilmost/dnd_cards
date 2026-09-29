import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {createLogicalClock,createSequentialIdFactory,createStrictRngTape} from './determinism';
import {InMemoryRulesSession} from './session';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'recovery',contentHash:'recovery',errataVersion:'2024'};
function action(resource:string,classId:string):RuleActionDefinition{return {
  id:`recover-${resource}`,name:'Восстановление ячеек',kind:'nonSpell',sourceEntityIds:[resource],
  mechanics:{activation:{mode:'active',cost:[{resource:'bonus_action',amount:1}]},effects:[],active_slot_recovery:{
    charge_resource:resource,kind:'slot_recovery',decision_type:resource,rest:'short_rest',capability_id:resource,
    level_source:{kind:'class_level',class_id:classId,minimum:1,maximum:20},budget:{mode:'ceil_divide_level',divisor:2},
    slot_resource:{prefix:'spell_slot_',minimum_level:1,maximum_level:5,restore_amount:1},maximum_per_rest:1,
  }},
};}
function actor(a:RuleActionDefinition,resource:string,classId:string):ActorState{return {
  id:'owner',name:'owner',kind:'playerCharacter',controllerId:'owner-controller',ac:10,capabilities:{actionIds:[a.id]},
  character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:5,profBonus:3,classLevels:{[classId]:5}},
  runtime:{hp:{current:10,max:10,temp:0},resources:{action:1,bonus_action:1,reaction:1,[resource]:3,spell_slot_1:1,spell_slot_2:0},
    maxResources:{action:1,bonus_action:1,reaction:1,[resource]:3,spell_slot_1:4,spell_slot_2:2},equipment:{},inventory:[],activeEffects:[],firedThisTurn:[]},passives:[],
};}
type Input=GameCommand extends infer C?C extends GameCommand?Omit<C,'schemaVersion'|'expectedRevision'|'rulesetContentHash'|'actorId'>:never:never;
const command=(s:InMemoryRulesSession,input:Input):GameCommand=>({schemaVersion:1,expectedRevision:s.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'owner',...input} as GameCommand);
function accepted(s:InMemoryRulesSession,input:Input){const r=s.dispatch(command(s,input));if(r.status==='rejected')throw Error(`${r.code}: ${r.message}`);return r;}
function setup(resource='magic_recovery_charge',classId='wizard'){
  const a=action(resource,classId),tape=createStrictRngTape([]),env={rng:tape.rng,clock:createLogicalClock(),nextId:createSequentialIdFactory('recover')};
  const catalog={getAction:(id:string)=>id===a.id?a:undefined};
  const owner=actor(a,resource,classId);
  const s=new InMemoryRulesSession(createWorld({id:'recovery',ruleset,actors:[owner,{...owner,id:'other'}]}),catalog,env);
  accepted(s,{type:'StartEncounter',commandId:'start',initiative:['owner','other']});accepted(s,{type:'StartTurn',commandId:'turn'});
  return {s,a,tape,catalog,env};
}
describe('canonical active slot recovery',()=>{
  it.each([['magic_recovery_charge','wizard'],['natural_recovery','druid']])('persists %s choice and spends exactly once', (resource,classId)=>{
    const {s,a,tape,catalog,env}=setup(resource,classId);
    const before=JSON.stringify(s.getState().actors.owner.runtime);
    accepted(s,{type:'UseAction',commandId:'open',actionId:a.id,targetIds:[]});
    expect(JSON.stringify(s.getState().actors.owner.runtime)).toBe(before);
    const reloaded=new InMemoryRulesSession(JSON.parse(JSON.stringify(s.snapshot().world)),catalog,env);
    const pending=reloaded.getState().pendingResolution;if(pending?.type!=='slot_recovery')throw Error('Missing saved choice');
    expect(pending.request.budget).toBe(3);expect(pending.request.recoverableByLevel).toEqual({1:3,2:2});
    const response=command(reloaded,{type:'ResolveDecision',commandId:'resolve',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'slot_recovery',slotLevels:[1,2]}});
    const result=reloaded.dispatch(response);if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);
    expect(reloaded.getState().actors.owner.runtime.resources).toMatchObject({[resource]:0,spell_slot_1:2,spell_slot_2:1,bonus_action:0});
    expect(reloaded.getState().pendingResolution).toBeNull();
    const after=JSON.stringify(reloaded.getState());expect(reloaded.dispatch(response).status).toBe('rejected');expect(JSON.stringify(reloaded.getState())).toBe(after);tape.assertExhausted();
  });
  it('rechecks current slots and leaves an invalid saved choice and costs intact',()=>{
    const {s,a,catalog,env}=setup();accepted(s,{type:'UseAction',commandId:'open',actionId:a.id,targetIds:[]});
    const world=JSON.parse(JSON.stringify(s.snapshot().world));world.actors.owner.runtime.resources.spell_slot_2=2;
    const changed=new InMemoryRulesSession(world,catalog,env),p=changed.getState().pendingResolution;if(p?.type!=='slot_recovery')throw Error('Missing choice');
    const before=JSON.stringify(changed.getState());const r=changed.dispatch(command(changed,{type:'ResolveDecision',commandId:'resolve',resolutionId:p.id,requestId:p.request.id,response:{kind:'slot_recovery',slotLevels:[2]}}));
    expect(r.status).toBe('rejected');expect(JSON.stringify(changed.getState())).toBe(before);
  });
  it('allows cancellation without a resource or action cost',()=>{
    const {s,a}=setup();const before=JSON.stringify(s.getState().actors.owner.runtime);
    accepted(s,{type:'UseAction',commandId:'open',actionId:a.id,targetIds:[]});const p=s.getState().pendingResolution;if(p?.type!=='slot_recovery')throw Error('Missing choice');
    accepted(s,{type:'ResolveDecision',commandId:'cancel',resolutionId:p.id,requestId:p.request.id,response:{kind:'slot_recovery',slotLevels:null}});
    expect(s.getState().pendingResolution).toBeNull();expect(JSON.stringify(s.getState().actors.owner.runtime)).toBe(before);
  });
});
