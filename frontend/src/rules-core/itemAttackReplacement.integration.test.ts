import {describe, expect, it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-high-20260929.json';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import {projectRuleAction} from '../canon/ruleActionProjection';
import {bindSelfItemCost} from '../engine/cost';
import type {Action} from '../types';
import {createLogicalClock, createSequentialIdFactory, createStrictRngTape} from './determinism';
import {createWorld, defaultAttackProfile, type ActorState, type GameCommand} from './domain';
import {InMemoryRulesSession} from './session';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'alchemical-fire',contentHash:'alchemical-fire',errataVersion:'2024'};
const source=cards.find(card=>card.card_number==='CARD-0714')!;
const changed=items['CARD-0714'].patch.mechanics!;
const mechanics=bindSelfItemCost({...changed,requires_item_source:source.id},source.id);
const action=projectRuleAction({...source,mechanics} as unknown as Action);
const catalog={getAction:(id:string)=>id===action.id?action:undefined};

function actor(id:string, attacksPerAction:number):ActorState{
  const hero:ActorState={id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:id==='owner'?[action.id]:[]},
    character:{level:5,profBonus:3,knownCards:[source as never],abilityMods:{str:0,dex:2,con:0,int:0,wis:0,cha:0}},
    runtime:{hp:{current:20,max:20,temp:0},resources:{action:1},maxResources:{action:1},inventory:id==='owner'?[{cardId:source.id,qty:1}]:[],equipment:{},activeEffects:[]}};
  hero.attackProfile={...defaultAttackProfile(hero),attacksPerAction};
  return hero;
}

describe('item-owned Attack replacements',()=>{
  it.each([1,2])('replaces one of %i attacks, consumes one flask, and survives a save checkpoint',attacks=>{
    const tape=createStrictRngTape([{sides:4,value:2,label:'fire'}]);
    const env={rng:tape.rng,clock:createLogicalClock(1),nextId:createSequentialIdFactory('fire')};
    const session=new InMemoryRulesSession(createWorld({id:'fire',ruleset,actors:[actor('owner',attacks),actor('target',1)]}),catalog,env);
    const send=(input:Record<string,unknown>)=>session.dispatch({schemaVersion:1,commandId:`fire:${session.getState().revision}`,expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'owner',...input} as GameCommand);
    const start=send({type:'StartEncounter',initiative:['owner','target']});
    expect(start.status).toBe('accepted');
    expect(send({type:'StartTurn'}).status).toBe('accepted');
    const before=session.getState();
    const command={schemaVersion:1 as const,type:'UseAttackReplacement' as const,commandId:`fire:replace:${attacks}`,expectedRevision:before.revision,rulesetContentHash:ruleset.contentHash,actorId:'owner',actionId:action.id,targetIds:['target'],factsByTarget:{target:{factsSource:'scenario' as const,boardRevision:before.revision,distanceFt:20,lineOfSight:true,cover:'none' as const,relation:'enemy' as const}}};
    expect(session.dispatch({...command,commandId:'fire:unseen',factsByTarget:{target:{...command.factsByTarget.target,canSeeTarget:false}}})).toMatchObject({status:'rejected',code:'CapabilityDenied'});
    const direct=session.dispatch({...command,type:'UseAction',commandId:'fire:direct'} as GameCommand);
    expect(direct).toMatchObject({status:'rejected',code:'InvalidActionTiming'});
    const declared=session.dispatch(command);
    if(declared.status==='rejected')throw Error(`${declared.code}: ${declared.message}`);
    const pending=declared.nextState.pendingResolution;
    expect(pending?.type).toBe('target_save');
    if(!pending||pending.type!=='target_save')throw Error('Expected target save');
    expect(pending.request).toMatchObject({actorId:'target',ability:'dex',dc:13});
    expect(declared.nextState.actors.owner.runtime.resources.action).toBe(0);
    expect(declared.nextState.actors.owner.runtime.inventory.find(row=>row.cardId===source.id)?.qty??0).toBe(0);
    expect(declared.nextState.attackActions[pending.attackActionId!].sequence).toMatchObject({totalAttacks:attacks,attacksRemaining:attacks-1});
    const reloaded=new InMemoryRulesSession(JSON.parse(JSON.stringify(declared.nextState)),catalog,env);
    expect(reloaded.dispatch(command).status).toBe('rejected');
    const response={schemaVersion:1 as const,type:'ResolveDecision' as const,commandId:'fire:resolve',expectedRevision:reloaded.getState().revision,rulesetContentHash:ruleset.contentHash,actorId:'target',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'roll' as const,roll:{mode:'manual' as const,dice:[{sides:20,value:1}]}}};
    const resolved=reloaded.dispatch(response);
    if(resolved.status==='rejected')throw Error(`${resolved.code}: ${resolved.message}`);
    expect(resolved.nextState.actors.owner.runtime.inventory.find(row=>row.cardId===source.id)?.qty??0).toBe(0);
    expect(resolved.nextState.actors.target.runtime.hp.current).toBe(18);
    expect(reloaded.dispatch(response).status).toBe('rejected');
    tape.assertExhausted();
  });
});
