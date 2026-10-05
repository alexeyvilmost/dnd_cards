import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactWorkerMirrors,expandWorkerMirrors} from './mirrors.mjs';
import {createRulesWorker} from './server.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

function fixture(){
  const state={characterId:'hero',world:{actors:{hero:{name:'<Герой> & спутник',runtime:{resources:{pool:2},pending:{phase:'before-outcome',value:13}}}},padding:'я'.repeat(1000)},
    catalogActions:[{id:'one',mechanics:{effects:[{type:'operation',description:'< & >'.repeat(100)}]}}],actionPresentation:{imageUrl:'separate'}};
  const patch={runtime_revision:8,turn_state:{solo_combat_v1:structuredClone(state),other:{retained:true}}};
  patch.turn_state.solo_combat_v1.actionPresentation={imageUrl:'different preserved snapshot'};
  return {envelope:{schemaVersion:1,artifactHash:`sha256:${'a'.repeat(64)}`,entropy:{seed:'synthetic-test-seed',cursor:7},state},patch,patches:{hero:structuredClone(patch),ally:{runtime_revision:4}},randomValues:[.3]};
}
test('wire v2 expands exact mirrors without changing distinct presentation or input',()=>{
  const legacy=fixture(),before=structuredClone(legacy),wire=compactWorkerMirrors(legacy),serialized=JSON.stringify(wire);
  assert.equal(wire.wireSchema,2);assert.ok(serialized.length<JSON.stringify(legacy).length*.6);
  assert.deepEqual(expandWorkerMirrors(JSON.parse(serialized)),legacy);assert.deepEqual(legacy,before);
  const restored=expandWorkerMirrors(wire);restored.patch.turn_state.solo_combat_v1.world.actors.hero.runtime.resources.pool=0;
  assert.equal(restored.envelope.state.world.actors.hero.runtime.resources.pool,2);
  assert.equal(restored.patches.hero.turn_state.solo_combat_v1.world.actors.hero.runtime.resources.pool,2);
  assert.deepEqual(expandWorkerMirrors(legacy),legacy);
});
test('wire v2 fails closed for mismatches, unknown references, collisions and versions',()=>{
  for(const mutate of [row=>row.wireSchema=3,row=>row.mirrors.state[0].sha256=`sha256:${'0'.repeat(64)}`,
    row=>row.mirrors.state[0].field='entropy',row=>row.mirrors.state.push(row.mirrors.state[0]),
    row=>row.mirrors.leader.id='another-owner',row=>row.value.patches.hero={},
    row=>row.value.patch.turn_state.solo_combat_v1.world={},row=>delete row.value.envelope.state.world]){
    const wire=compactWorkerMirrors(fixture());mutate(wire);assert.throws(()=>expandWorkerMirrors(wire));
  }
  assert.deepEqual(compactWorkerMirrors({status:'needs_content',needs:[]}),{status:'needs_content',needs:[]});
});

test('negotiated wrapper preserves archived executables, private RNG, retries and old clients',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'worker-mirror-test-')),artifactFile=path.join(directory,'current.cjs'),artifactsDirectory=path.join(directory,'artifacts'),token='local-mirror-test-token-32-characters';
  const source=`exports.stepRoguelikeCombat=envelope=>({envelope,randomValues:[.25]});
exports.projectRoguelikeCombatPatch=envelope=>{const patch={runtime_revision:8,turn_state:{solo_combat_v1:JSON.parse(JSON.stringify(envelope.state))}};return {envelope,patch,patches:{hero:patch}}}; // old`;
  const oldHash=`sha256:${createHash('sha256').update(source).digest('hex')}`;let server;
  const start=async()=>{server=await createRulesWorker({artifactFile,artifactsDirectory,token});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;};
  const stop=()=>new Promise(resolve=>server.close(resolve));
  try{
    await writeFile(artifactFile,source);await start();await stop();await writeFile(artifactFile,source.replace('// old','// new'));const origin=await start();
    const envelope=fixture().envelope;envelope.artifactHash=oldHash;
    const post=(mirrors,hash=oldHash)=>fetch(`${origin}/transition`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(mirrors?{'x-rules-wire':'mirrors-v2'}:{})},body:JSON.stringify({artifactHash:hash,envelope,intent:{type:'resume'}})});
    const legacy=await(await post(false)).json();
    for(let i=0;i<3;i++){const response=await post(true);assert.equal(response.status,200);const wire=await response.json();assert.equal(wire.wireSchema,2);assert.deepEqual(expandWorkerMirrors(wire),legacy);}
    assert.deepEqual(legacy.envelope,envelope);assert.equal((await post(true,`sha256:${'0'.repeat(64)}`)).status,409);
    assert.equal(await readFile(path.join(artifactsDirectory,`${oldHash.slice(7)}.cjs`),'utf8'),source);
  }finally{if(server?.listening)await stop();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('worker-mirror-test-'));await rm(directory,{recursive:true,force:true});}
});
