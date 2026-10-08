import {createHash} from 'node:crypto';

export const MIRROR_WIRE='mirrors-v2';
const fields=['world','catalogActions','actionPresentation','actorPresentation','log','battleMap','tokens','combatAreas','resourceBindings','resourceBindingsByActor'];
const hash=raw=>`sha256:${createHash('sha256').update(raw).digest('hex')}`;

/** Frame-local exact mirrors only. No shared cache, inferred immutable content,
 * historical-state migration, or reference to a previous client revision. */
export function compactWorkerMirrors(result){
  const state=result.envelope?.state,originalPatch=result.patch,snapshot=originalPatch?.turn_state?.solo_combat_v1;
  if(!state||!snapshot)return result;
  const value={...result,patch:{...originalPatch,turn_state:{...originalPatch.turn_state,solo_combat_v1:{...snapshot}}}};
  const mirrors={state:[]};
  for(const field of fields){
    const source=JSON.stringify(state[field]);
    if(source===undefined||source.length<256||(state[field]!==snapshot[field]&&source!==JSON.stringify(snapshot[field])))continue;
    mirrors.state.push({field,sha256:hash(source)});delete value.patch.turn_state.solo_combat_v1[field];
  }
  const id=state.characterId;
  if(typeof id==='string'&&result.patches?.[id]&&(originalPatch===result.patches[id]||JSON.stringify(originalPatch)===JSON.stringify(result.patches[id]))){
    value.patches={...result.patches};delete value.patches[id];
    mirrors.leader={id,sha256:hash(JSON.stringify(value.patch))};
  }
  return mirrors.state.length||mirrors.leader?{wireSchema:2,value,mirrors}:result;
}

/** Reference reader for protocol tests/measurement; production Go independently
 * validates hashes and restores JSON before existing result validators. */
export function expandWorkerMirrors(wire){
  if(wire.wireSchema===undefined)return wire;
  if(wire.wireSchema!==2||!wire.value||!wire.mirrors||Object.keys(wire).some(key=>!['wireSchema','value','mirrors'].includes(key)))throw Error('Invalid worker mirror frame');
  const value=structuredClone(wire.value),{state,leader}=wire.mirrors;
  if(!Array.isArray(state)||state.length>fields.length||Object.keys(wire.mirrors).some(key=>!['state','leader'].includes(key)))throw Error('Invalid mirror metadata');
  if(leader&&(typeof leader.id!=='string'||leader.id!==value.envelope?.state?.characterId||Object.hasOwn(value.patches??{},leader.id)||hash(JSON.stringify(value.patch))!==leader.sha256))throw Error('Invalid leader mirror');
  const seen=new Set();
  for(const row of state){
    const target=value.patch?.turn_state?.solo_combat_v1,source=value.envelope?.state?.[row.field];
    if(!fields.includes(row.field)||seen.has(row.field)||!target||Object.hasOwn(target,row.field)||source===undefined||hash(JSON.stringify(source))!==row.sha256)throw Error('Invalid state mirror');
    seen.add(row.field);target[row.field]=structuredClone(source);
  }
  if(leader)value.patches[leader.id]=structuredClone(value.patch);
  if(Buffer.byteLength(JSON.stringify(value))>16*1024*1024)throw Error('Expanded mirror frame too large');
  return value;
}
