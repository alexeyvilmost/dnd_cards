import {createHash} from 'node:crypto';
import {goJSONMapWireValue} from './replay.mjs';

// The recognized projectors read only these persisted character fields. A
// changed turn-state byte, runtime revision, member or order changes the key.
export function projectionInputs(character,characters) {
  const select=row=>row?{id:row.id,runtime_revision:row.runtime_revision,turn_state:row.turn_state}:undefined;
  return goJSONMapWireValue({character:select(character),characters:characters?.map(select)});
}
export function projectionKey(input) {
  return 'sha256:'+createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
export function nextProjectionInputs(projected,character,characters) {
  const rows=characters?.length>1?characters:[character];
  if(!rows?.every(row=>row?.id))return undefined;
  const next=rows.map(row=>{const patch=projected.patches?.[row.id]??(row.id===projected.envelope.state.characterId?projected.patch:undefined);if(!patch)return undefined;const turn={...patch.turn_state};delete turn.solo_combat_v1;return {id:row.id,runtime_revision:patch.runtime_revision,turn_state:turn};});
  if(next.some(row=>!row))return undefined;
  return projectionInputs(next.find(row=>row.id===projected.envelope.state.characterId),characters?.length>1?next:characters?.length===0?[]:undefined);
}

// Private, immutable worker inputs. Cache misses are detected before execution
// so the API can resend the full frame without rolling dice twice.
export function createCombatFrameCache({maxFrames=16,maxBytes=64*1024*1024}={}) {
  const entries=new Map();let bytes=0;
  return {
    get(key,artifactHash){const row=entries.get(key);if(!row||row.artifactHash!==artifactHash)return undefined;entries.delete(key);entries.set(key,row);return row.envelope;},
    set(key,envelope){const size=Buffer.byteLength(JSON.stringify(envelope));if(size>maxBytes)return;
      const previous=entries.get(key);if(previous){bytes-=previous.size;entries.delete(key);}
      entries.set(key,{envelope:goJSONMapWireValue(envelope),artifactHash:envelope.artifactHash,size});bytes+=size;
      while(entries.size>maxFrames||bytes>maxBytes){const oldest=entries.keys().next().value;bytes-=entries.get(oldest).size;entries.delete(oldest);}
    },
    clear(){entries.clear();bytes=0;},
  };
}

// These exact projectors replace the dedicated combat snapshot and use the
// authoritative envelope. Unknown archived versions require full sheet inputs.
export function acceptsCompactProjection(artifact) {
  const digest=fn=>typeof fn==='function'?createHash('sha256').update(fn.toString()).digest('hex'):'';
  return digest(artifact.projectRoguelikePartyCombatPatch)==='74117cc9c758c7b2d0cc0df5e789ddc63e764bff79a5dc9c948496622e427692'
    &&digest(artifact.projectRoguelikeCombatPatch)==='1289fa75409e1a17a99c866a516c49c48239574ef52ae2064724a969bf77c76a';
}
