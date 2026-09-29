import {describe,expect,it} from 'vitest';
import {longRest,shortRest} from './turn';
import {parseFreeuse,collectFreeuseRecovery} from './freeuse';
import {resolveActionUsesRecovery} from './actionUses';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import {InMemoryRulesSession} from '../rules-core/session';
import {createWorld,type ActorState,type GameCommand} from '../rules-core/domain';
import {createLogicalClock,createSequentialIdFactory} from '../rules-core/determinism';
import {createStrictRngTape} from '../rules-core/determinism';

const recovery={short_rest:{mode:'none' as const},long_rest:{mode:'dice' as const,dice:'1d6'}};
describe('bounded item charge recovery',()=>{
  it.each(['freeuse-misty_step','uses_item-dodge'])('restores a rolled amount to %s and preserves the dice as saved evidence',key=>{
    const state=equippedFighterState();state.resources[key]=1;state.maxResources[key]=6;
    const tape=createStrictRngTape([{label:'recharge',sides:6,value:3}]);
    const context={...FIGHTER_CTX_EQUIPPED,resourceRecovery:{[key]:recovery},rng:tape.rng};
    expect(shortRest(state,context).state.resources[key]).toBe(1);
    const result=longRest(state,context);
    expect(result.state.resources[key]).toBe(4);tape.assertExhausted();
    expect(result.events).toContainEqual(expect.objectContaining({type:'roll',roll:expect.objectContaining({dice:[{sides:6,result:3}]})}));
    expect(JSON.parse(JSON.stringify(result.state)).resources[key]).toBe(4);
    expect(state.resources[key]).toBe(1);
  });
  it('caps recharge at capacity and does not draw dice for a full pool or regenerate finite uses',()=>{
    const state=equippedFighterState();state.resources.charge=5;state.maxResources.charge=6;
    state.resources.finite=1;state.maxResources.finite=5;
    const tape=createStrictRngTape([{label:'bounded recovery',sides:6,value:6}]);
    const context={...FIGHTER_CTX_EQUIPPED,resourceRecovery:{charge:recovery},resourceRecharge:{finite:'never'},rng:tape.rng};
    const result=longRest(state,context);expect(result.state.resources).toMatchObject({charge:6,finite:1});tape.assertExhausted();
    expect(longRest(result.state,context).state.resources.charge).toBe(6);
  });
  it('carries the policy through both grant and action decoders, failing closed for malformed dice',()=>{
    const spec=parseFreeuse({count:6,recharge:'day',recovery});
    expect(collectFreeuseRecovery([{spell:'misty_step',...spec!}])).toEqual({'freeuse-misty_step':recovery});
    expect(resolveActionUsesRecovery({uses:{count:6,recovery}})).toEqual({status:'configured',recovery});
    const bad={...recovery,long_rest:{mode:'dice',dice:'100000d100000'}};
    expect(parseFreeuse({count:6,recovery:bad})?.recovery).toBeNull();
    expect(resolveActionUsesRecovery({uses:{count:6,recovery:bad}}).status).toBe('invalid');
  });
  it('persists a canonical rest roll and rejects replay without rolling or recovering again',()=>{
    const runtime=equippedFighterState();runtime.resources.charge=0;runtime.maxResources.charge=6;
    const ruleset={systemId:'dnd5e-2024' as const,releaseId:'recharge',contentHash:'recharge',errataVersion:'2024'};
    const actor:ActorState={id:'owner',name:'owner',kind:'playerCharacter',controllerId:'player',ac:10,capabilities:{actionIds:[]},runtime,character:{...FIGHTER_CTX_EQUIPPED,resourceRecovery:{charge:recovery}}};
    const tape=createStrictRngTape([{label:'recharge',sides:6,value:2}]);
    const env={rng:tape.rng,clock:createLogicalClock(),nextId:createSequentialIdFactory()};
    const catalog={getAction:()=>undefined};
    const session=new InMemoryRulesSession(createWorld({id:'rest',ruleset,actors:[actor]}),catalog,env);
    const command:GameCommand={type:'TakeLongRest',schemaVersion:1,commandId:'rest-once',expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'owner'};
    const result=session.dispatch(command);if(result.status==='rejected')throw Error(result.message);
    expect(result.nextState.actors.owner.runtime.resources.charge).toBe(2);tape.assertExhausted();
    const restored=new InMemoryRulesSession(JSON.parse(JSON.stringify(result.nextState)),catalog,env);
    expect(restored.dispatch(command).status).toBe('rejected');expect(restored.getState().actors.owner.runtime.resources.charge).toBe(2);
  });

});
