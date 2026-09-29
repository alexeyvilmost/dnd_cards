import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type GameCommand, type RuleActionDefinition } from './domain';
import { handleCommand } from './handler';
import { createSequentialIdFactory, createStrictRngTape } from './determinism';
import { migrateWorldState } from './worldMigration';
import { foldEvents } from './reducer';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'held-concentration',contentHash:'held-concentration',errataVersion:'2024'};
function setup(exhaustion:boolean){
  const action:RuleActionDefinition={id:'preserve',name:'Удержать концентрацию',kind:'nonSpell',sourceEntityIds:['item-source'],mechanics:{concentration_preservation:true,
    activation:{mode:'triggered',cost:[{resource:'preserve_charge',amount:1}]},effects:[{resolution:'auto',who:'self',result:exhaustion?[{kind:'condition',value:'exhaustion'}]:[{kind:'resource',op:'spend',id:'focus',amount:1}]}]}};
  const actor:ActorState={id:'owner',name:'Owner',kind:'playerCharacter',controllerId:'owner',ac:10,capabilities:{actionIds:[action.id]},
    character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2,resourceRecharge:{preserve_charge:'turn'}},
    runtime:{hp:{current:20,max:20,temp:0},resources:{preserve_charge:1,focus:2},maxResources:{preserve_charge:1,focus:2},inventory:[],equipment:{},activeEffects:[{id:'linked',name:'Spell',source:'Spell',mechanics:{},roundsLeft:10}]}};
  let world=createWorld({id:'held',ruleset,actors:[actor]});
  world.concentrations.owner={id:'concentration',sourceActorId:'owner',actionId:'spell',startedAtRevision:0,effectLinks:[{actorId:'owner',effectId:'linked'}]};
  world.pendingResolution={id:'save',type:'concentration_save',actorId:'owner',concentrationId:'concentration',damage:4,openedByCommandId:'damage',openedAtRevision:0,deadlineLogicalClock:10,
    request:{id:'save-request',type:'saving_throw',actorId:'owner',ability:'con',dc:10,avoidsConditions:[]}};
  const tape=createStrictRngTape([{label:'held-save',sides:20,value:2}]),env={rng:tape.rng,nextId:createSequentialIdFactory('conc'),clock:()=>1},catalog={getAction:(id:string)=>id===action.id?action:undefined};
  function dispatch(response:Record<string,unknown>){const pending=world.pendingResolution!;const command={schemaVersion:1,type:'ResolveDecision',commandId:`decision-${world.revision}`,actorId:'owner',expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,resolutionId:pending.id,requestId:pending.request.id,response} as GameCommand;
    const result=handleCommand(world,command,catalog,env);if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);expect(foldEvents(world,result.events)).toEqual(result.nextState);world=result.nextState;return command;}
  return {dispatch,get:()=>world,reload:()=>{world=migrateWorldState(JSON.parse(JSON.stringify(world)));},catalog,env,tape};
}
describe('preserved concentration after a held failed save',()=>{
  it.each([true,false])('keeps links until confirmation and pays its declared cost once (exhaustion=%s)',exhaustion=>{
    const s=setup(exhaustion);s.dispatch({kind:'roll',roll:{mode:'system'}});
    expect(s.get().pendingResolution).toMatchObject({type:'concentration_save',heldSave:{roll:{total:2,outcome:'fail'}},request:{type:'reaction'}});
    expect(s.get().concentrations.owner.id).toBe('concentration');expect(s.get().actors.owner.runtime.resources.preserve_charge).toBe(1);
    s.reload();const command=s.dispatch({kind:'reaction',actionId:'preserve'});
    expect(s.get().pendingResolution).toBeNull();expect(s.get().concentrations.owner.id).toBe('concentration');
    expect(s.get().actors.owner.runtime.activeEffects.some(effect=>effect.id==='linked')).toBe(true);expect(s.get().actors.owner.runtime.resources.preserve_charge).toBe(0);
    if(exhaustion)expect(s.get().actors.owner.runtime.activeEffects.filter(effect=>effect.mechanics.value==='exhaustion')).toHaveLength(1);
    else expect(s.get().actors.owner.runtime.resources.focus).toBe(1);
    const before=JSON.stringify(s.get());expect(handleCommand(s.get(),command,s.catalog,s.env).status).toBe('rejected');expect(JSON.stringify(s.get())).toBe(before);s.tape.assertExhausted();
  });
  it('declining after reload clears the linked effect and concentration without an additional die or charge',()=>{
    const s=setup(true);s.dispatch({kind:'roll',roll:{mode:'system'}});s.reload();s.dispatch({kind:'reaction',actionId:null});
    expect(s.get().concentrations.owner).toBeUndefined();expect(s.get().actors.owner.runtime.activeEffects).toEqual([]);expect(s.get().actors.owner.runtime.resources.preserve_charge).toBe(1);s.tape.assertExhausted();
  });
});
