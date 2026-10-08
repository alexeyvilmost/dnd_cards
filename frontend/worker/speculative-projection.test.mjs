import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';
import {withContainerCatalog} from './fixtures/container-catalog.mjs';
import {createRulesWorker,snapshotHash} from './server.mjs';
import {compileNativeHashArtifact} from './native-hash.mjs';
import {createSpeculativeTransitions} from './speculative-transitions.mjs';
import {projectionInputs,projectionKey,nextProjectionInputs} from './combat-frames.mjs';
import {goJSONMapWireValue} from './replay.mjs';
const file=fileURLToPath(new URL('artifact.cjs',workerTestBuild())),bytes=fs.readFileSync(file);
const artifact=compileNativeHashArtifact(file,bytes),hash='sha256:'+createHash('sha256').update(bytes).digest('hex');
function inputFor(size) {
  const input=withContainerCatalog(JSON.parse(fs.readFileSync('frontend/src/roguelike/pinnedFighter.fixture.json')),JSON.parse(fs.readFileSync('officials/canon/prod-snapshot/cards.json')));
  input.seed='projection-party-'+size;input.character.initiative_bonus=100;
  input.character.turn_state={...input.character.turn_state,qa_choice:{selected:'🐉'}};
  if(size>1)input.characters=Array.from({length:size},(_,i)=>({...structuredClone(input.character),id:i?'qa:projection-'+i:input.character.id,initiative_bonus:100-i}));
  input.roster=[{monster_id:'projection-enemy',quantity:1}];
  input.monsters={version:1,effects:[],actions:[],monsters:[{id:'projection-enemy',slug:'projection-enemy',name:'Synthetic enemy',size:'medium',creature_type:'humanoid',armor_class:10,max_hp:20,speed:30,initiative_bonus:-100,proficiency_bonus:2,abilities:{str:14,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[],effect_ids:[],ai:{strategy:'tactical'}}]};
  return input;
}
for(const size of [1,2,6])test(`prepared projection preserves complete results and private cache for party ${size}`,async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'prepared-projection-'));
  const speculate=createSpeculativeTransitions({artifactsDirectory:directory});
  try {
    await writeFile(path.join(directory,hash.slice(7)+'.cjs'),bytes);
    const input=inputFor(size),initialized=await artifact.initializeRoguelikeCombat(input,hash);assert.equal(initialized.status,'ready');
    const projected=size>1?artifact.projectRoguelikePartyCombatPatch(initialized.envelope,input.characters):artifact.projectRoguelikeCombatPatch(initialized.envelope,input.character);
    const selected=nextProjectionInputs(projected,input.character,input.characters),envelope=goJSONMapWireValue(projected.envelope);
    const intent={type:'end_turn',actorId:envelope.state.world.scene.initiative[envelope.state.world.scene.activeIndex]},before=JSON.stringify(envelope),key=snapshotHash(envelope);
    speculate.schedule(key,envelope,selected);
    const actual=await speculate.take(key,intent);assert.ok(actual?.projection);
    const expected=artifact.stepRoguelikeCombat(envelope,intent,hash),patch=size>1?artifact.projectRoguelikePartyCombatPatch(expected.envelope,selected.characters):artifact.projectRoguelikeCombatPatch(expected.envelope,selected.character);
    assert.deepEqual(actual.result,expected);assert.deepEqual(actual.projection.projected,patch);assert.equal(actual.projection.afterHash,snapshotHash(patch.envelope));assert.equal(JSON.stringify(envelope),before);
    assert.equal(actual.projection.key,projectionKey(selected));
    for(const changed of [{...selected,character:{...selected.character,runtime_revision:900}},{...selected,character:{...selected.character,turn_state:{...selected.character.turn_state,qa_choice:'changed'}}},...(size>1?[{...selected,characters:[...selected.characters].reverse()}]:[])])assert.notEqual(projectionKey(changed),actual.projection.key);
    actual.result.envelope.entropy.cursor=900;actual.projection.projected.patch.turn_state.qa_choice='changed';
    const retry=await speculate.take(key,intent);assert.deepEqual(retry.result,expected);assert.deepEqual(retry.projection.projected,patch);
  } finally {await speculate.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('prepared-projection-'));await rm(directory,{recursive:true,force:true});}
});
test('HTTP projection mismatch retains changed sheet choices and authoritative revision',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'projection-http-')),token='synthetic-projection-only-worker-token';let server;
  try {
    await writeFile(path.join(directory,hash.slice(7)+'.cjs'),bytes);
    server=await createRulesWorker({artifactFile:file,artifactsDirectory:directory,token,performanceEnabled:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const call=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-performance-trace':'1'},body:JSON.stringify(goJSONMapWireValue(body))});assert.equal(response.status,200);return {body:await response.json(),metrics:JSON.parse(response.headers.get('x-rules-performance'))};};
    const input=inputFor(2),initial=await call('/initialize',{artifactHash:hash,input});
    const characters=input.characters.map(c=>({...c,...initial.body.patches[c.id]})),compact=projectionInputs(characters[0],characters);
    const envelope=goJSONMapWireValue(initial.body.envelope),intent={type:'end_turn',actorId:envelope.state.world.scene.initiative[envelope.state.world.scene.activeIndex]};
    compact.characters[0].runtime_revision+=2;compact.characters[0].turn_state.qa_choice={selected:'changed 🐉'};compact.character=compact.characters[0];
    const actual=await call('/transition',{artifactHash:hash,envelope,intent,character:compact.character,characters:compact.characters,projectionInputVersion:1});
    const stepped=artifact.stepRoguelikeCombat(envelope,intent,hash),projected=artifact.projectRoguelikePartyCombatPatch(stepped.envelope,compact.characters);
    assert.equal(actual.metrics.worker_prediction_projection_hit,0);
    assert.deepEqual(actual.body,JSON.parse(JSON.stringify({...stepped,...projected,trace:{beforeHash:snapshotHash(envelope),afterHash:snapshotHash(projected.envelope),runtimeRevision:projected.patch.runtime_revision}})));
    assert.deepEqual(actual.body.patch.turn_state.qa_choice,{selected:'changed 🐉'});
  } finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('projection-http-'));await rm(directory,{recursive:true,force:true});}
});
