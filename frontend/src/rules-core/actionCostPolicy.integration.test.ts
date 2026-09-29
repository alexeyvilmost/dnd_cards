import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {createLogicalClock,createSequentialIdFactory,createStrictRngTape} from './determinism';
import {InMemoryRulesSession} from './session';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'policy-test',contentHash:'policy-test',errataVersion:'2024'};
const action:RuleActionDefinition={id:'recover',name:'Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ',kind:'nonSpell',sourceEntityIds:['recover'],
  mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
    effects:[{resolution:'auto',who:'self',result:[{kind:'healing',amount:'1d4'}]}]}};
function actor():ActorState{return {
  id:'owner',name:'owner',kind:'playerCharacter',controllerId:'owner-controller',ac:10,
  capabilities:{actionIds:[action.id]},character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2},
  runtime:{hp:{current:1,max:10,temp:0},resources:{action:1,bonus_action:1,reaction:1,quick:2,swift:1},
    maxResources:{action:1,bonus_action:1,reaction:1,quick:2,swift:1},equipment:{},inventory:[],activeEffects:[],firedThisTurn:[]},
  passives:[{kind:'action_cost_policy',id:'quick',match:{action_refs:['recover']},optional:true,
    replace:{action:'bonus_action'},additional_cost:[{resource:'quick',amount:1}]},
    {kind:'action_cost_policy',id:'swift',match:{action_refs:['recover']},optional:true,
      replace:{action:'free_action'},additional_cost:[{resource:'swift',amount:1}]}],
};}
type Input=GameCommand extends infer C?C extends GameCommand?Omit<C,'schemaVersion'|'expectedRevision'|'rulesetContentHash'|'actorId'>:never:never;
const command=(session:InMemoryRulesSession,input:Input):GameCommand=>({schemaVersion:1,expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'owner',...input} as GameCommand);
function accepted(session:InMemoryRulesSession,input:Input){const result=session.dispatch(command(session,input));if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);return result;}

describe('persisted canonical action cost choice',()=>{
  it.each(['quick','swift',null])('resumes %s after reload and never spends or rolls twice',policyId=>{
    const tape=createStrictRngTape([{label:'healing only after choice',sides:4,value:3}]);
    const env={rng:tape.rng,clock:createLogicalClock(1000),nextId:createSequentialIdFactory('policy')};
    const catalog={getAction:(id:string)=>id===action.id?action:undefined};
    let session=new InMemoryRulesSession(createWorld({id:'policy',ruleset,actors:[actor(),{...actor(),id:"other"}]}),catalog,env);
    accepted(session,{type:'StartEncounter',commandId:'start',initiative:['owner','other']});
    accepted(session,{type:'StartTurn',commandId:'turn'});
    const before=JSON.parse(JSON.stringify(session.getState().actors.owner.runtime));
    accepted(session,{type:'UseAction',commandId:'open',actionId:action.id,targetIds:[]});
    expect(tape.consumed()).toBe(0);
    expect(session.getState().actors.owner.runtime).toEqual(before);
    session=new InMemoryRulesSession(JSON.parse(JSON.stringify(session.snapshot().world)),catalog,env);
    const pending=session.getState().pendingResolution;
    if(pending?.type!=='action_cost_policy')throw Error('Missing saved choice');
    expect(pending.request.options.map(option=>option.policyId)).toEqual(['quick','swift']);
    const response=command(session,{type:'ResolveDecision',commandId:'choose',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'action_cost_policy',policyId}});
    const result=session.dispatch(response);
    if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);
    expect(session.getState().pendingResolution).toBeNull();
    expect(session.getState().actors.owner.runtime.hp.current).toBe(4);
    expect(session.getState().actors.owner.runtime.resources).toMatchObject({action:policyId===null?0:1,
      bonus_action:policyId==='quick'?0:1,quick:policyId==='quick'?1:2,swift:policyId==='swift'?0:1});
    tape.assertExhausted();
    const after=JSON.stringify(session.getState());
    expect(session.dispatch(response).status).toBe('rejected');
    expect(JSON.stringify(session.getState())).toBe(after);
    expect(tape.consumed()).toBe(1);
  });
  it('rejects an option from another actor without paying or consuming RNG',()=>{
    const tape=createStrictRngTape([]);
    const session=new InMemoryRulesSession(createWorld({id:'forged',ruleset,actors:[actor(),{...actor(),id:"other"}]}),{getAction:()=>action},
      {rng:tape.rng,clock:createLogicalClock(),nextId:createSequentialIdFactory()});
    accepted(session,{type:'StartEncounter',commandId:'start',initiative:['owner','other']});
    accepted(session,{type:'StartTurn',commandId:'turn'});
    accepted(session,{type:'UseAction',commandId:'open',actionId:action.id,targetIds:[]});
    const pending=session.getState().pendingResolution;if(pending?.type!=='action_cost_policy')throw Error('Missing choice');
    const before=JSON.stringify(session.getState());
    const rejected=session.dispatch(command(session,{type:'ResolveDecision',commandId:'forged',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'action_cost_policy',policyId:'another-owner'}}));
    expect(rejected.status).toBe('rejected');expect(JSON.stringify(session.getState())).toBe(before);tape.assertExhausted();
  });
});
