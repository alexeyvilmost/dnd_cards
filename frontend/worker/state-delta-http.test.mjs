import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';
import {withContainerCatalog} from './fixtures/container-catalog.mjs';
import {compileNativeHashArtifact} from './native-hash.mjs';
import {goJSONMapWireValue} from './replay.mjs';
import {expandWorkerMirrors} from './mirrors.mjs';
import {nextProjectionInputs} from './combat-frames.mjs';
import {createRulesWorker,snapshotHash} from './server.mjs';
import {expandState} from './state-delta.mjs';
const file=fileURLToPath(new URL('artifact.cjs',workerTestBuild())),bytes=fs.readFileSync(file),artifact=compileNativeHashArtifact(file,bytes),hash='sha256:'+createHash('sha256').update(bytes).digest('hex');
function inputFor(size){
 const input=withContainerCatalog(JSON.parse(fs.readFileSync('frontend/src/roguelike/pinnedFighter.fixture.json')),JSON.parse(fs.readFileSync('officials/canon/prod-snapshot/cards.json')));
 input.seed='delta-http-'+size;input.character.initiative_bonus=100;
 if(size>1)input.characters=Array.from({length:size},(_,i)=>({...structuredClone(input.character),id:i?'qa:delta-'+i:input.character.id,initiative_bonus:100-i}));
 input.roster=[{monster_id:'delta-enemy',quantity:1}];
 input.monsters={version:1,effects:[],actions:[],monsters:[{id:'delta-enemy',slug:'delta-enemy',name:'Synthetic enemy',size:'medium',creature_type:'humanoid',armor_class:10,max_hp:20,speed:30,initiative_bonus:-100,proficiency_bonus:2,abilities:{str:14,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[],effect_ids:[],ai:{strategy:'tactical'}}]};return input;
}
function expand(frame,base){
 assert.equal(frame.wireSchema,3);const value=structuredClone(frame.value);
 value.envelope.state=expandState(value.envelope.state,base.state,frame.stateDelta,snapshotHash(base));
 assert.equal(snapshotHash(value.envelope),value.trace.afterHash);
 const state=value.envelope.state,snapshot=value.patch.turn_state.solo_combat_v1;
 for(const field of frame.mirrors.state)snapshot[field]=structuredClone(state[field]);
 for(const row of frame.mirrors.partial)snapshot[row.field]=expandState(snapshot[row.field],state[row.field],row.delta,value.trace.afterHash);
 if(frame.mirrors.leader)value.patches[frame.mirrors.leader]=structuredClone(value.patch);
 return value;
}
for(const size of [1,2,6])test('delta HTTP preserves complete canonical result, fallback and private frame for party '+size,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'worker-delta-http-')),token='synthetic-delta-http-only-worker-token';let server;
 try{
  await writeFile(path.join(dir,hash.slice(7)+'.cjs'),bytes);server=await createRulesWorker({artifactFile:file,artifactsDirectory:dir,token,performanceEnabled:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=async(route,body,wire='mirrors-v3')=>{
   const response=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-performance-trace':'1','x-rules-wire':wire},body:JSON.stringify(goJSONMapWireValue(body))});return {status:response.status,body:await response.json(),metrics:JSON.parse(response.headers.get('x-rules-performance'))};
  };
  const input=inputFor(size),initial=await call('/initialize',{artifactHash:hash,input});assert.equal(initial.status,200);assert.equal(initial.body.wireSchema,2);
  const fullInitial=expandWorkerMirrors(initial.body),base=goJSONMapWireValue(fullInitial.envelope),selected=nextProjectionInputs(fullInitial,input.character,input.characters),intent={type:'end_turn',actorId:base.state.world.scene.initiative[base.state.world.scene.activeIndex]};
  const body={artifactHash:hash,frameKey:snapshotHash(base),intent,...selected,projectionInputVersion:1},rawBase=JSON.stringify(base);
  const stepped=artifact.stepRoguelikeCombat(base,intent,hash),projected=size>1?artifact.projectRoguelikePartyCombatPatch(stepped.envelope,selected.characters):artifact.projectRoguelikeCombatPatch(stepped.envelope,selected.character);
  const expected=JSON.parse(JSON.stringify({...stepped,...projected,trace:{beforeHash:snapshotHash(base),afterHash:snapshotHash(projected.envelope),runtimeRevision:projected.patch.runtime_revision}}));
  const actual=await call('/transition',body);assert.equal(actual.status,200);assert.equal(actual.metrics.worker_state_delta_hit,1);assert.deepEqual(expand(actual.body,base),expected);
  const retry=await call('/transition',body);assert.deepEqual(expand(retry.body,base),expected);assert.equal(JSON.stringify(base),rawBase);
  const legacy=await call('/transition',body,'mirrors-v2');assert.equal(legacy.metrics.worker_state_delta_hit,0);assert.deepEqual(expandWorkerMirrors(legacy.body),expected);
  const missing=await call('/transition',{...body,frameKey:'sha256:'+'0'.repeat(64)});assert.equal(missing.status,409);assert.equal(missing.body.error,'frame_unavailable');
  const fallback=await call('/transition',{...body,frameKey:undefined,envelope:base});assert.equal(fallback.status,200);assert.equal(fallback.body.wireSchema,2);assert.deepEqual(expandWorkerMirrors(fallback.body),expected);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(dir),tmpdir());assert.ok(path.basename(dir).startsWith('worker-delta-http-'));await rm(dir,{recursive:true,force:true});}
});

for(const size of [1,2])test('startup prefetch prepares only an exact verified projection for party '+size,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'worker-delta-http-')),token='synthetic-delta-prefetch-only-worker-token';let server;
 try {
  await writeFile(path.join(dir,hash.slice(7)+'.cjs'),bytes);server=await createRulesWorker({artifactFile:file,artifactsDirectory:dir,token,performanceEnabled:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-performance-trace':'1','x-rules-wire':'mirrors-v3'},body:JSON.stringify(goJSONMapWireValue(body))});assert.equal(response.status,200);return {body:await response.json(),metrics:JSON.parse(response.headers.get('x-rules-performance'))};};
  const input=inputFor(size),initialized=await artifact.initializeRoguelikeCombat(input,hash),projected=size>1?artifact.projectRoguelikePartyCombatPatch(initialized.envelope,input.characters):artifact.projectRoguelikeCombatPatch(initialized.envelope,input.character),base=goJSONMapWireValue(projected.envelope),selected=nextProjectionInputs(projected,input.character,input.characters),before=snapshotHash(base);
  const prefetched=await call('/prefetch',{artifactHash:hash,envelope:base,...selected,projectionInputVersion:1});assert.equal(prefetched.body.trace.afterHash,before);
  const intent={type:'end_turn',actorId:base.state.world.scene.initiative[base.state.world.scene.activeIndex]},actual=await call('/transition',{artifactHash:hash,frameKey:before,intent,...selected,projectionInputVersion:1});
  assert.equal(actual.metrics.worker_prediction_projection_hit,1);assert.equal(actual.metrics.worker_prepared_mirror_hit,1);assert.equal(actual.metrics.worker_state_delta_hit,1);
  const stepped=artifact.stepRoguelikeCombat(base,intent,hash),expected=size>1?artifact.projectRoguelikePartyCombatPatch(stepped.envelope,selected.characters):artifact.projectRoguelikeCombatPatch(stepped.envelope,selected.character);
  assert.deepEqual(expand(actual.body,base),JSON.parse(JSON.stringify({...stepped,...expected,trace:{beforeHash:before,afterHash:snapshotHash(expected.envelope),runtimeRevision:expected.patch.runtime_revision}})));
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(dir),tmpdir());assert.ok(path.basename(dir).startsWith('worker-delta-http-'));await rm(dir,{recursive:true,force:true});}
});
