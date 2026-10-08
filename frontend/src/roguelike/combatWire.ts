import type {RoguelikeRun} from './api';

type CommandReply={run:RoguelikeRun;events?:import('../character/api').CharacterEventRow[]};
type StateDelta={base_command_id:string;references:string[][];array_prefixes:Array<{path:string[];length:number;offset?:number}>};
type CombatWireReply=CommandReply & {wire_schema?:string;leader_index?:number;snapshot?:Record<string,unknown>;snapshot_mirrors?:string[];state_delta?:StateDelta};
export class MissingCombatBaseError extends Error {}

function expandStateDelta(raw:CombatWireReply,base?:{commandId:string;run:RoguelikeRun}) {
 const delta=raw.state_delta;
 if(!delta)return raw.run.combat_state;
 if(raw.wire_schema!=='combat-frame-v2'||!Array.isArray(delta.references)||delta.references.length>1024||!Array.isArray(delta.array_prefixes)||delta.array_prefixes.length>128)throw Error('Invalid combat delta');
 if(!base||base.commandId!==delta.base_command_id||base.run.id!==raw.run.id||base.run.user_id!==raw.run.user_id)throw new MissingCombatBaseError('Missing exact combat base');
 if(!raw.run.combat_state||!base.run.combat_state)throw Error('Missing combat state');
 const source=structuredClone(base.run.combat_state) as unknown as Record<string,unknown>,target=structuredClone(raw.run.combat_state) as unknown as Record<string,unknown>,seen:string[][]=[];
 const parent=(root:Record<string,unknown>,path:string[])=>{
  if(!Array.isArray(path)||!path.length||path.length>8||path.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))throw Error('Invalid delta path');
  let object=root;
  for(const key of path.slice(0,-1)){if(!Object.hasOwn(object,key)||!object[key]||typeof object[key]!=='object'||Array.isArray(object[key]))throw Error('Missing delta parent');object=object[key] as Record<string,unknown>;}
  return {object,key:path[path.length-1]};
 };
 const claim=(path:string[])=>{for(const previous of seen){const length=Math.min(previous.length,path.length);if(previous.slice(0,length).every((key,i)=>key===path[i]))throw Error('Overlapping delta path');}seen.push(path);};
 for(const path of delta.references){const from=parent(source,path),to=parent(target,path);claim(path);if(!Object.hasOwn(from.object,from.key)||Object.hasOwn(to.object,to.key))throw Error('Invalid delta reference');Object.defineProperty(to.object,to.key,{value:from.object[from.key],enumerable:true,writable:true,configurable:true});}
 for(const prefix of delta.array_prefixes){const from=parent(source,prefix.path),to=parent(target,prefix.path);claim(prefix.path);const old=from.object[from.key],tail=to.object[to.key],offset=prefix.offset??0;if(!Array.isArray(old)||!Array.isArray(tail)||!Number.isInteger(offset)||offset<0||!Number.isInteger(prefix.length)||prefix.length<0||offset+prefix.length>old.length||prefix.length+tail.length>100000)throw Error('Invalid delta prefix');to.object[to.key]=[...old.slice(offset,offset+prefix.length),...tail];}
 return target as unknown as RoguelikeRun['combat_state'];
}

export function expandCombatReply(raw:CombatWireReply,base?:{commandId:string;run:RoguelikeRun}):CommandReply {
  if(raw.wire_schema===undefined)return raw;
  if(!['combat-frame-v1','combat-frame-v2'].includes(raw.wire_schema)||!raw.run||!Array.isArray(raw.snapshot_mirrors)||raw.snapshot_mirrors.length>128)throw Error('Invalid combat frame');
  const run={...raw.run};
  if(raw.state_delta)run.combat_state=expandStateDelta(raw,base);
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

// Private copies prevent UI edits from corrupting the bases of concurrent
// replies. A missing/evicted base retries the same command in full wire format.
export function createCombatReplyCache(maxFrames=4) {
 if(!Number.isSafeInteger(maxFrames)||maxFrames<1||maxFrames>16)throw Error('Invalid combat reply cache limit');
 const frames=new Map<string,{commandId:string;run:RoguelikeRun}>();
 const latest=(id:string)=>[...frames.values()].filter(row=>row.run.id===id).sort((a,b)=>b.run.revision-a.run.revision)[0];
 return {
  headers(id:string){const frame=latest(id);return {'X-Combat-Wire':'combat-frame-v2',...(frame?{'X-Combat-Base':frame.commandId}:{})};},
  expand(raw:CombatWireReply,commandId:string){const reply=expandCombatReply(raw,raw.state_delta?frames.get(raw.state_delta.base_command_id):undefined);if(raw.wire_schema){frames.delete(commandId);frames.set(commandId,{commandId,run:structuredClone(reply.run)});while(frames.size>maxFrames)frames.delete(frames.keys().next().value!);}return reply;},
  clear(id:string){for(const [key,row]of frames)if(row.run.id===id)frames.delete(key);},
 };
}
