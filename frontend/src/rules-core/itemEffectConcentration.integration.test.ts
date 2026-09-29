import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type GameCommand } from './domain';
import { handleCommand } from './handler';
import { createSequentialIdFactory } from './determinism';
import { migrateWorldState } from './worldMigration';
import { foldEvents } from './reducer';
import { deniedCapabilities } from '../engine/modifiers';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'termination',contentHash:'termination',errataVersion:'2024'};
function actor(id:string):ActorState { return {id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:[]},
  character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2},
  runtime:{hp:{current:5,max:20,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[]}}; }

describe('concentration termination executes owner consequences atomically',()=>{
  it.each(['healing','lethargy'] as const)('ends %s on a foreign recipient after reload without repeating on retry',kind=>{
    const caster=actor('caster'),recipient=actor('recipient');
    recipient.runtime.activeEffects=[{id:'linked-instance',name:kind,source:'Caster',ownerId:recipient.id,sourceId:caster.id,
      actionContext:{sourceId:caster.id,character:{...caster.character,profBonus:3}},
      mechanics:{on_end:{effects:[{resolution:'auto',who:'self',result:kind==='healing'
        ? [{kind:'healing',amount:'prof_bonus'}]
        : [{kind:'condition',op:'apply',value:'incapacitated',duration:{type:'until_end_of_source_next_turn'}}]}]}}}];
    let world=createWorld({id:'termination',ruleset,actors:[caster,recipient]});
    world.concentrations.caster={id:'concentration',sourceActorId:'caster',actionId:'spell',startedAtRevision:0,effectLinks:[{actorId:'recipient',effectId:'linked-instance'}]};
    world.pendingResolution={id:'save',type:'concentration_save',actorId:'caster',concentrationId:'concentration',damage:4,openedByCommandId:'damage',openedAtRevision:0,deadlineLogicalClock:10,
      request:{id:'save-request',type:'saving_throw',actorId:'caster',ability:'con',dc:10,avoidsConditions:[]}};
    world=migrateWorldState(JSON.parse(JSON.stringify(world)));
    const command:GameCommand={schemaVersion:1,type:'ResolveDecision',commandId:'failed-save',actorId:'caster',expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,
      resolutionId:'save',requestId:'save-request',response:{kind:'roll',roll:{mode:'manual',dice:[{sides:20,value:1}]}}};
    const env={rng:()=>{throw Error('No RNG expected');},nextId:createSequentialIdFactory('end'),clock:()=>1},catalog={getAction:()=>undefined};
    const result=handleCommand(world,command,catalog,env);
    if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
    expect(foldEvents(world,result.events)).toEqual(result.nextState);
    expect(result.nextState.concentrations.caster).toBeUndefined();
    expect(result.nextState.actors.caster.runtime.hp.current).toBe(5);
    const after=result.nextState.actors.recipient.runtime;
    expect(after.activeEffects.some(effect=>effect.id==='linked-instance')).toBe(false);
    if(kind==='healing')expect(after.hp.current).toBe(8);
    else expect(deniedCapabilities(after).has('action')).toBe(true);
    const reloaded=migrateWorldState(JSON.parse(JSON.stringify(result.nextState)));
    expect(handleCommand(reloaded,command,catalog,env).status).toBe('rejected');
    expect(reloaded.actors.recipient.runtime).toEqual(after);
  });
});
