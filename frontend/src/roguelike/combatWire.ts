import type {RoguelikeRun} from './api';

type CommandReply={run:RoguelikeRun;events?:import('../character/api').CharacterEventRow[]};
export function expandCombatReply(raw:CommandReply & {wire_schema?:string;leader_index?:number;snapshot?:Record<string,unknown>;snapshot_mirrors?:string[]}):CommandReply {
  if(raw.wire_schema===undefined)return raw;
  if(raw.wire_schema!=='combat-frame-v1'||!raw.run||!Array.isArray(raw.snapshot_mirrors)||raw.snapshot_mirrors.length>128)throw Error('Invalid combat frame');
  const run={...raw.run};
  if(raw.leader_index!==undefined){
    const index=raw.leader_index;
    if(!Number.isInteger(index)||index<0||!run.characters?.[index]||run.character||run.characters[index].id!==run.character_id)throw Error('Invalid combat leader reference');
    run.characters=[...run.characters];run.characters[index]={...run.characters[index]};run.character=run.characters[index];
  }else if(run.character){run.character={...run.character};}
  if(raw.snapshot!==undefined&&raw.snapshot!==null){
    if(!run.character||!run.combat_state||run.character.turn_state?.solo_combat_v1||typeof raw.snapshot!=='object'||raw.snapshot===null)throw Error('Invalid combat snapshot');
    const snapshot={...raw.snapshot},seen=new Set<string>(),state=run.combat_state as unknown as Record<string,unknown>;
    for(const key of raw.snapshot_mirrors){if(typeof key!=='string'||key==='__proto__'||key==='constructor'||key==='prototype'||seen.has(key)||Object.hasOwn(snapshot,key)||!Object.hasOwn(state,key))throw Error('Invalid combat mirror');seen.add(key);Object.defineProperty(snapshot,key,{value:state[key],enumerable:true,writable:true,configurable:true});}
    run.character.turn_state={...run.character.turn_state,solo_combat_v1:snapshot};
  }else if(raw.snapshot_mirrors.length){throw Error('Missing combat snapshot');}
  return {run,...(raw.events?{events:raw.events}:{})};
}
