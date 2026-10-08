import {expect,it} from 'vitest';
import {expandCombatReply,createCombatReplyCache,MissingCombatBaseError} from './combatWire';
import type {RoguelikeRun} from './api';

const run=()=>({character_id:'hero',characters:[{id:'ally'},{id:'hero',turn_state:{other:2}}],combat_state:{world:{actors:{hero:{hp:3}}}}}) as unknown as RoguelikeRun;
it('restores the party leader and exact same-frame data without losing presentation differences',()=>{
 const input={wire_schema:'combat-frame-v1',run:run(),leader_index:1,snapshot:{actionPresentation:{image:'sheet'}},snapshot_mirrors:['world']};
 const reply=expandCombatReply(input);
 expect(reply.run.character).toBe(reply.run.characters![1]);
 expect(reply.run.character!.turn_state).toEqual({other:2,solo_combat_v1:{actionPresentation:{image:'sheet'},world:input.run.combat_state!.world}});
 expect(input.run.characters![1].turn_state).toEqual({other:2});
});
it('restores an empty snapshot and rejects overwrites, duplicates, foreign leaders and missing references',()=>{
 const input={wire_schema:'combat-frame-v1',run:run(),leader_index:1,snapshot:{},snapshot_mirrors:['world']};
 expect(expandCombatReply(input).run.character!.turn_state?.solo_combat_v1).toEqual({world:input.run.combat_state!.world});
 for(const changes of [{leader_index:0},{snapshot_mirrors:['world','world']},{snapshot_mirrors:['__proto__']},{snapshot_mirrors:['absent']},{snapshot:{world:1}},{snapshot:undefined}])expect(()=>expandCombatReply({...input,...changes})).toThrow();
});
it('keeps legacy replies compatible',()=>{const input={run:run()};expect(expandCombatReply(input)).toBe(input);});

const deltaRun=()=>({id:'run',user_id:'owner',revision:2,character_id:'hero',characters:[{id:'ally'},{id:'hero',turn_state:{other:2}}],combat_state:{world:{actors:{hero:{hp:3,inventory:[1,2,3,4]},ally:{hp:5}},scene:{round:1}},log:[{id:1},{id:2}],actionPresentation:{image:'original'}}}) as unknown as RoguelikeRun;
const baseWire=()=>({wire_schema:'combat-frame-v2',run:deltaRun(),leader_index:1,snapshot:{actionPresentation:{image:'sheet'}},snapshot_mirrors:['world','log']});
const deltaWire=()=>({wire_schema:'combat-frame-v2',run:{...deltaRun(),revision:3,combat_state:{world:{actors:{hero:{hp:2},ally:{hp:6}},scene:{round:2}},log:[{id:3}]} as unknown as RoguelikeRun['combat_state']},leader_index:1,snapshot:{actionPresentation:{image:'sheet'}},snapshot_mirrors:['world','log'],state_delta:{base_command_id:'first',references:[['world','actors','hero','inventory'],['actionPresentation']],array_prefixes:[{path:['log'],length:2,offset:0}]}});
it('restores exact previous data, appended history and two changed participants before canonical snapshot mirrors',()=>{
 const cache=createCombatReplyCache(),first=cache.expand(baseWire(),'first');
 (first.run.combat_state!.world.actors.hero as unknown as {hp:number}).hp=999;
 const raw=deltaWire(),reply=cache.expand(raw,'second');
 const state=reply.run.combat_state as unknown as Record<string,unknown>;
 expect(state.log).toEqual([{id:1},{id:2},{id:3}]);
 expect(state.world).toEqual({actors:{hero:{hp:2,inventory:[1,2,3,4]},ally:{hp:6}},scene:{round:2}});
 expect(reply.run.character!.turn_state!.solo_combat_v1).toEqual({actionPresentation:{image:'sheet'},world:state.world,log:state.log});
 expect(raw.run.combat_state!.world.actors.hero).toEqual({hp:2});
 expect(cache.headers('run')['X-Combat-Base']).toBe('second');
 // A concurrent reply can still reference the preceding frame.
 expect(cache.expand(deltaWire(),'third').run.combat_state).toEqual(reply.run.combat_state);
});
it('missing bases require full exact retry, and malformed paths or foreign owners never expand',()=>{
 const cache=createCombatReplyCache(1);cache.expand(baseWire(),'first');
 for(const changes of [{base_command_id:'absent'}, {references:[['__proto__']]}, {references:[['missing']]}, {references:[['world']]}, {references:[['actionPresentation'],['actionPresentation']]}, {array_prefixes:[{path:['log'],length:-1}]}, {array_prefixes:[{path:['log'],length:1000}]}])expect(()=>cache.expand({...deltaWire(),state_delta:{...deltaWire().state_delta,...changes}},'bad')).toThrow();
 expect(()=>cache.expand({...deltaWire(),run:{...deltaWire().run,user_id:'foreign'}},'bad')).toThrow(MissingCombatBaseError);
 cache.expand(deltaWire(),'second');expect(()=>cache.expand(deltaWire(),'third')).toThrow(MissingCombatBaseError);
 cache.clear('run');expect(cache.headers('run')['X-Combat-Base']).toBeUndefined();
});
it('sliding history references retain the exact window and reject an out-of-range offset',()=>{
 const cache=createCombatReplyCache(),first=baseWire();
 first.run.combat_state={...first.run.combat_state,log:[{id:1},{id:2},{id:3}]} as unknown as RoguelikeRun['combat_state'];cache.expand(first,'first');
 const next=deltaWire();next.state_delta.array_prefixes=[{path:['log'],length:2,offset:1}] as typeof next.state_delta.array_prefixes;next.run.combat_state={...next.run.combat_state,log:[{id:4}]} as unknown as RoguelikeRun['combat_state'];
 expect((cache.expand(next,'second').run.combat_state as unknown as {log:unknown[]}).log).toEqual([{id:2},{id:3},{id:4}]);
 expect(()=>cache.expand({...next,state_delta:{...next.state_delta,array_prefixes:[{path:['log'],length:2,offset:2}]}},'bad')).toThrow();
});
