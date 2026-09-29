import {describe,expect,it} from 'vitest';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import {projectRuleAction} from '../canon/ruleActionProjection';
import type {Action} from '../types';
import {createWorld,type ActorState,type GameCommand} from './domain';
import {createSequentialIdFactory} from './determinism';
import {handleCommand} from './handler';
import {migrateWorldState} from './worldMigration';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'chain',contentHash:'chain',errataVersion:'2024'};
const chain=cards.find(card=>card.card_number==='CARD-0829')!;
const effect=related.entities.find(row=>row.card_number==='EFFECT-item-completion-high-829-chained')!;
const bind=projectRuleAction(related.entities.find(row=>row.card_number==='ACT-item-completion-high-829-bind')!.patch as unknown as Action);
const escape=projectRuleAction(related.entities.find(row=>row.card_number==='ACT-item-completion-high-829-escape')!.patch as unknown as Action);
const catalog={getAction:(id:string)=>[bind,escape].find(action=>action.id===id)};
const env={rng:()=>0.99,nextId:createSequentialIdFactory('chain'),clock:()=>1};
function actor(id:string):ActorState{return {id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:id==='owner'?[bind.id]:[]},
  character:{level:1,profBonus:2,knownCards:[chain as never],abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
  grantedEffects:id==='owner'?{[effect.card_number]:effect.patch as never}:{},
  runtime:{hp:{current:20,max:20,temp:0},resources:{action:1},maxResources:{action:1},inventory:id==='owner'?[{cardId:chain.id,qty:1}]:[],equipment:{},activeEffects:[]}};}

describe('physical chains and target-owned escape',()=>{
  it('uses the same target-condition requirement for an unrelated prone-only action',()=>{
    const mechanics={activation:{mode:'active',cost:[]},targeting:{domain:'actor',shape:'single',actor_targets:true,range_ft:5,min_targets:1,max_targets:1,allowed_relations:['enemy'],requires_line_of_sight:true,requires_target_conditions_any:['prone']},effects:[{resolution:'auto',who:'target',result:[]}]} as const;
    const action=projectRuleAction({id:'unrelated-prone-action',card_number:'ACT-unrelated-prone',name:'Follow-up',mechanics} as unknown as Action);
    const owner=actor('owner'),target=actor('target');owner.capabilities.actionIds=[action.id];
    const world=createWorld({id:'prone',ruleset,actors:[owner,target]});
    const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'follow-up',expectedRevision:0,rulesetContentHash:'chain',actorId:'owner',actionId:action.id,targetIds:['target'],factsByTarget:{target:{factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy'}}};
    expect(handleCommand(world,command,{getAction:()=>action},env)).toMatchObject({status:'rejected',code:'InvalidTargets'});
    world.actors.target.runtime.activeEffects.push({id:'prone',name:'Prone',source:'test',mechanics:{kind:'condition',value:'prone'}});
    expect(handleCommand(world,command,{getAction:()=>action},env).status).toBe('accepted');
  });
  it('requires a constrained target, deploys one chain, and releases it after Athletics DC 18',()=>{
    const owner=actor('owner'),target=actor('target');
    let world=createWorld({id:'chain',ruleset,actors:[owner,target]});
    const bindCommand:GameCommand={schemaVersion:1,type:'UseAction',commandId:'bind',expectedRevision:0,rulesetContentHash:'chain',actorId:'owner',actionId:bind.id,targetIds:['target'],factsByTarget:{target:{factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true,cover:'none',relation:'enemy'}}};
    expect(handleCommand(world,bindCommand,catalog,env)).toMatchObject({status:'rejected',code:'InvalidTargets'});
    world.actors.target.runtime.activeEffects.push({id:'held',name:'Held',source:'test',mechanics:{kind:'condition',value:'grappled'}});
    const applied=handleCommand(world,bindCommand,catalog,env);if(applied.status==='rejected')throw Error(`${applied.code}: ${applied.message}`);
    expect(applied.nextState.actors.owner.runtime.inventory).toEqual([]);
    const deployed=Object.values(applied.nextState.objects).find(object=>object.itemCardId===chain.id);
    expect(deployed).toMatchObject({deployedToActorId:'target',ownerActorId:'owner'});
    expect(applied.nextState.actors.target.runtime.activeEffects.some(entry=>entry.entityRef?.cardNumber===effect.card_number)).toBe(true);
    const restored=migrateWorldState(JSON.parse(JSON.stringify(applied.nextState)));
    expect(handleCommand(restored,bindCommand,catalog,env).status).toBe('rejected');
    const release:GameCommand={schemaVersion:1,type:'UseAction',commandId:'escape',expectedRevision:restored.revision,rulesetContentHash:'chain',actorId:'target',actionId:escape.id,targetIds:[]};
    const failed=handleCommand(restored,{...release,commandId:'escape-fail'},catalog,{...env,rng:()=>0});
    if(failed.status==='rejected')throw Error(`${failed.code}: ${failed.message}`);
    expect(failed.nextState.objects[deployed!.id].deployedToActorId).toBe('target');
    expect(failed.nextState.actors.target.runtime.activeEffects.some(entry=>entry.entityRef?.cardNumber===effect.card_number)).toBe(true);
    const freed=handleCommand(restored,release,catalog,env);if(freed.status==='rejected')throw Error(`${freed.code}: ${freed.message}`);
    expect(freed.nextState.actors.target.runtime.activeEffects.some(entry=>entry.entityRef?.cardNumber===effect.card_number)).toBe(false);
    expect(freed.nextState.objects[deployed!.id]).toMatchObject({itemCardId:chain.id,unattended:true});
    expect(freed.nextState.objects[deployed!.id].deployedToActorId).toBeUndefined();
    expect(handleCommand(freed.nextState,release,catalog,env).status).toBe('rejected');
  });
});
