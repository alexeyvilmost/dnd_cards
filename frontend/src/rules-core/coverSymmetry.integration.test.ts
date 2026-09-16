import {describe, expect, it} from 'vitest';
import {createWorld, type ActorState, type RuleActionDefinition, type CommandResult, type SpatialFacts} from './domain';
import {InMemoryRulesSession} from './session';
import {terrainSight, type BattleMapDefinition} from '../solo-combat/boardGeometry';
import {previewAttackDefense} from './handler';

const ruleset = {systemId:'dnd5e-2024' as const, releaseId:'cover-test', contentHash:'cover-test', errataVersion:'test'};
const bow: RuleActionDefinition = {id:'test.bow', name:'Лук', kind:'nonSpell', sourceEntityIds:['test.bow'],
  targeting:{rangeFt:320,minTargets:1,maxTargets:1,requiresLineOfSight:true,allowedRelations:['enemy']},
  mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]}, effects:[{
    resolution:'attack_roll',vs:'ac',ability:'dex',attack_kind:'weapon_ranged',attack_bonus_override:4,
    on_hit:[{kind:'damage',type:'piercing',amount:'1'}]}]}};
const defense: RuleActionDefinition = {id:'test.defense',name:'Защита',kind:'nonSpell',sourceEntityIds:['test.defense'],
  mechanics:{activation:{mode:'reaction',trigger:{event:'hit_by_attack'},cost:[{resource:'reaction',amount:1}]},
    effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',op:'add',value:'+5',applies_to:{roll:'ac'},duration:{type:'until_start_of_next_turn'}}]}]}};
const catalog = {getAction:(id:string)=>[bow,defense].find(a=>a.id===id)};
function actor(id:string, kind:ActorState['kind'], reaction=false):ActorState {
  return {id,name:id,kind,controllerId:id,ac:15,capabilities:{actionIds:[bow.id,...(reaction?[defense.id]:[])]},
    character:{abilityMods:{str:0,dex:3,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
    runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,reaction:1},maxResources:{action:1,reaction:1},inventory:[],equipment:{},activeEffects:[]}};
}
function accepted(result:CommandResult){if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);return result;}
function rolls(result:CommandResult){return accepted(result).events.flatMap(e=>e.payload.type==='EngineEventRecorded'
  && e.payload.event.type==='roll' && e.payload.event.roll.target?.type==='ac'?[e.payload.event.roll]:[]);}
function setup(cover:SpatialFacts['cover'], reverse=false, reaction=false, natural=12){
  const source=actor('source',reverse?'playerCharacter':'monster'),target=actor('target',reverse?'monster':'playerCharacter',reaction);
  const world=createWorld({id:'cover',ruleset,actors:[source,target]});
  world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['source','target'],turnStarted:true};
  const env={rng:()=>(natural-.5)/20,clock:()=>1,nextId:()=>''};
  const session=new InMemoryRulesSession(world,catalog,env);
  const command={schemaVersion:1 as const,type:'UseAction' as const,commandId:'attack',expectedRevision:0,
    rulesetContentHash:ruleset.contentHash,actorId:'source',actionId:bow.id,targetIds:['target'],
    factsByTarget:{target:{factsSource:'board' as const,boardRevision:1,distanceFt:55,lineOfSight:cover!=='total',cover,relation:'enemy' as const}}};
  return {session,command,env};
}
describe('cover across stat-block and player attack pipelines',()=>{
  it('reproduces the saved crypt geometry: sarcophagus grants half cover both ways',()=>{
    const battleMap={id:'crypt',width:16,height:12,features:[{id:'sarcophagus',name:'Низкий саркофаг',x:7,y:5,width:2,height:1,sprite:'stone',cover:'half',blocksMovement:true}]} as BattleMapDefinition;
    for(const [from,to] of [[{x:8,y:0},{x:8,y:11}],[{x:8,y:11},{x:8,y:0}]])
      expect(terrainSight({battleMap},from,to)).toEqual({blocked:false,cover:'half'});
  });
  it.each([['none',15],['half',17],['three_quarters',20]] as const)('%s applies equally to either controller, with or without a reaction', (cover,ac)=>{
    for(const reverse of [false,true])for(const reaction of [false,true]){
      const {session,command}=setup(cover,reverse,reaction);
      expect(rolls(session.dispatch(command))[0]).toMatchObject({total:16,target:{value:ac},outcome:ac>16?'miss':'hit'});
      expect(session.getState().actors.target.ac).toBe(15);
      expect(session.getState().actors.source.runtime.resources.action).toBe(0);
    }
  });
  it.each([null,defense.id])('keeps cover across serialized reaction %s, without reroll or duplicate cost',actionId=>{
    const {session,command,env}=setup('half',false,true,17);
    const initial=rolls(session.dispatch(command))[0];
    expect(initial).toMatchObject({total:21,target:{value:17},outcome:'hit'});
    const saved=JSON.parse(JSON.stringify(session.getState()));
    const pending=saved.pendingResolution;
    expect(pending.type).toBe('attack_reaction');expect(pending.request.trigger.originalAc).toBe(17);
    expect(previewAttackDefense(saved.actors.target,defense,initial)).toEqual({ac:22,changesOutcome:true});
    const restored=new InMemoryRulesSession(saved,catalog,{...env,rng:()=>{throw Error('Unexpected reroll');}});
    const decision={schemaVersion:1 as const,type:'ResolveDecision' as const,commandId:'decision',expectedRevision:saved.revision,
      rulesetContentHash:ruleset.contentHash,actorId:'target',resolutionId:pending.id,requestId:pending.request.id,
      response:{kind:'reaction' as const,actionId}};
    const final=rolls(restored.dispatch(decision))[0];
    expect(final).toMatchObject({dice:initial.dice,total:21,target:{value:actionId?22:17},outcome:actionId?'miss':'hit'});
    expect(restored.getState().actors.target.ac).toBe(15);
    expect(restored.dispatch(decision)).toMatchObject({status:'rejected',code:'DuplicateCommand'});
  });
  it('rejects total cover before spending or rolling',()=>{
    const {session,command}=setup('total');
    expect(session.dispatch(command).status).toBe('rejected');
    expect(session.getState().actors.source.runtime.resources.action).toBe(1);
  });
  it('a second declarative attack uses the same cover rule',()=>{
    const {session,command,env}=setup('three_quarters');
    const second={...bow,id:'test.sling',name:'Праща',mechanics:{...bow.mechanics,effects:[{resolution:'attack_roll',vs:'ac',ability:'dex',attack_kind:'weapon_ranged',attack_bonus_override:7,on_hit:[]}]}} as RuleActionDefinition;
    const world=JSON.parse(JSON.stringify(session.getState()));world.actors.source.capabilities.actionIds=[second.id];
    const other=new InMemoryRulesSession(world,{getAction:id=>id===second.id?second:catalog.getAction(id)},env);
    expect(rolls(other.dispatch({...command,actionId:second.id}))[0]).toMatchObject({total:19,target:{value:20},outcome:'miss'});
  });
});
