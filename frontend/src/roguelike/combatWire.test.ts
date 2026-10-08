import {expect,it} from 'vitest';
import {expandCombatReply} from './combatWire';
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
