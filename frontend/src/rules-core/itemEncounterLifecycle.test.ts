import {describe,expect,it} from 'vitest';
import patches from '../../../scripts/content/data/item-triggers-20260929.json';
import {createWorld,type ActorState,type GameCommand,type WorldState} from './domain';
import {InMemoryRulesSession} from './session';
import {foldEvents} from './reducer';
import {createLogicalClock,createSequentialIdFactory} from './determinism';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';

const RULESET={systemId:'dnd5e-2024' as const,releaseId:'item-encounter@1',contentHash:'item-encounter-tests',errataVersion:'2024'};
type Dict=Record<string,unknown>;
const item=(n:'CARD-0770'|'CARD-0897'):Dict=>({id:n,name:n,activation:{mode:'passive'},effects:[{resolution:'auto',result:patches[n].append_payloads}]});
function actor(id:string,current=21,passives:Dict[]=[]):ActorState {
  return {id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:[]},
    character:{...FIGHTER_CTX_EQUIPPED,resourceRecharge:{encounter_pool:'encounter',long_pool:'long_rest'}},passives,
    runtime:{...equippedFighterState(),hp:{current,max:50,temp:7},resources:{action:1,bonus_action:1,reaction:1,encounter_pool:0,long_pool:0},
      maxResources:{action:1,bonus_action:1,reaction:1,encounter_pool:2,long_pool:4},firedByPeriod:{encounter:['old-use'],short_rest:['kept-use']}},
    lifecycle:{status:'alive'},attackProfile:{attacksPerAction:1,size:2,reachFt:5,graspingParts:['main_hand'],sourceEntityIds:['test:attack-profile']},
  };
}
function session(actors:ActorState[]){
  const initial=createWorld({id:'test-encounter',ruleset:RULESET,actors});
  const runtime=new InMemoryRulesSession(initial,{getAction:()=>undefined},{rng:()=>{throw new Error('Lifecycle must not reroll');},clock:createLogicalClock(1),nextId:createSequentialIdFactory('encounter')});
  return {initial,runtime};
}
function command(s:InMemoryRulesSession,actorId:string,type:'StartEncounter'|'StartTurn'|'EndTurn',id:string){
  return {schemaVersion:1,expectedRevision:s.getState().revision,rulesetContentHash:RULESET.contentHash,actorId,type,commandId:id,...(type==='StartEncounter'?{initiative:['a','b']}:{})} as GameCommand;
}
function accepted(s:InMemoryRulesSession,c:GameCommand){
  const result=s.dispatch(c);if(result.status==='rejected')throw new Error(`${result.code}: ${result.message}`);return result;
}
const boosted=(w:WorldState,id:string)=>w.actors[id].runtime.activeEffects.some(e=>(e.mechanics as Dict).applies_to&&((e.mechanics as Dict).applies_to as Dict).roll==='speed');

describe('authoritative encounter lifecycle for declarative items and pools',()=>{
  it('applies owner-specific loss and recharge atomically, rejects restart, and replays without another application',()=>{
    const {initial,runtime}=session([actor('a',21,[item('CARD-0897')]),actor('b',38)]);
    const begin=command(runtime,'a','StartEncounter','start');accepted(runtime,begin);
    const started=runtime.getState();
    expect(started.actors.a.runtime.hp).toEqual({current:11,max:50,temp:7});
    expect(started.actors.b.runtime.hp.current).toBe(38);
    for(const a of Object.values(started.actors)){
      expect(a.runtime.resources).toMatchObject({encounter_pool:2,long_pool:0});
      expect(a.runtime.firedByPeriod).toEqual({encounter:[],short_rest:['kept-use']});
    }
    expect(runtime.dispatch(begin)).toMatchObject({status:'rejected',code:'DuplicateCommand'});
    expect(runtime.dispatch(command(runtime,'b','StartEncounter','start-again'))).toMatchObject({status:'rejected',code:'InvalidActionTiming'});
    expect(runtime.getState()).toEqual(started);
    expect(foldEvents(initial,[...runtime.getEvents()])).toEqual(started);
    expect(JSON.parse(JSON.stringify(runtime.snapshot())).world).toEqual(started);
  });
  it('keeps the first-round speed through both first turns and expires it globally at round two',()=>{
    const {initial,runtime}=session([actor('a',30,[item('CARD-0770')]),actor('b',30,[item('CARD-0770')])]);
    accepted(runtime,command(runtime,'a','StartEncounter','start'));
    expect(boosted(runtime.getState(),'a')).toBe(true);expect(boosted(runtime.getState(),'b')).toBe(true);
    accepted(runtime,command(runtime,'a','StartTurn','a-start'));accepted(runtime,command(runtime,'a','EndTurn','a-end'));
    expect(boosted(runtime.getState(),'a')).toBe(true);expect(boosted(runtime.getState(),'b')).toBe(true);
    accepted(runtime,command(runtime,'b','StartTurn','b-start'));accepted(runtime,command(runtime,'b','EndTurn','b-end'));
    expect(runtime.getState().scene).toMatchObject({round:2});
    expect(boosted(runtime.getState(),'a')).toBe(false);expect(boosted(runtime.getState(),'b')).toBe(false);
    expect(foldEvents(initial,[...runtime.getEvents()])).toEqual(runtime.getState());
  });
  it('supports another entity with a different declarative ratio and ignores optional encounter reactions',()=>{
    const other={id:'independent-ratio',activation:{mode:'triggered',trigger:{event:'encounter_start',subject:'self'}},effects:[{resolution:'auto',result:[{kind:'set_value',target:'hp',formula:'ceil(current_hp * 3 / 4)'}]}]};
    const optional={activation:{mode:'reaction',trigger:{event:'encounter_start'}},effects:[{resolution:'auto',result:[{kind:'temp_hp',amount:99}]}]};
    const {runtime}=session([actor('a',20,[other,optional]),actor('b',31,[item('CARD-0897')])]);
    accepted(runtime,command(runtime,'a','StartEncounter','start'));
    expect(runtime.getState().actors.a.runtime.hp).toEqual({current:15,max:50,temp:7});
    expect(runtime.getState().actors.b.runtime.hp.current).toBe(16);
    expect(runtime.getState().pendingResolution).toBeNull();
  });
  it('start-of-turn stabilization suppresses the death-save marker after automatic effects resolve',()=>{
    const necklace={id:'CARD-0661',activation:{mode:'passive'},effects:[{resolution:'auto',result:patches['CARD-0661'].append_payloads}]};
    const a=actor('a',0,[necklace]);a.runtime.deathSaves={successes:0,failures:1,stable:false,dead:false};
    const {runtime}=session([a,actor('b')]);
    accepted(runtime,command(runtime,'a','StartEncounter','start'));
    accepted(runtime,command(runtime,'a','StartTurn','a-start'));
    expect(runtime.getState().actors.a.runtime.deathSaves?.stable).toBe(true);
    expect(runtime.getState().actors.a.runtime.firedThisTurn).not.toContain('system:death-save-due');
  });
});
