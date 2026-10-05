import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {profileFreshProtocol} from './fresh-worker.mjs';
import {snapshotHash} from '../../frontend/worker/server.mjs';
import {runsRoot} from '../testing/runtime.mjs';
import {assertRealOwnedPath} from '../testing/guards.mjs';

test('fresh profiler observes unloaded artifacts, explicit wire format and bounded numeric windows',async()=>{
  const runId=`test_${randomBytes(12).toString('hex')}`,directory=path.join(runsRoot,runId);
  await mkdir(directory,{recursive:false});
  const artifactFile=path.join(directory,'fixture.cjs');
  const source=`exports.stepRoguelikeCombat=envelope=>({envelope,randomValues:[.25]});
exports.projectRoguelikeCombatPatch=envelope=>({envelope,patch:{runtime_revision:8,turn_state:{solo_combat_v1:structuredClone(envelope.state)}}});`;
  await writeFile(artifactFile,source);
  const artifactHash=`sha256:${createHash('sha256').update(source).digest('hex')}`;
  const envelope={artifactHash,entropy:{seed:'private-test-only-marker',cursor:7},state:{characterId:'hero',world:{actors:{hero:{resources:{charges:2}}},padding:'numeric-boundary-test'.repeat(100)},catalogActions:[],log:[]}};
  const body={artifactHash,envelope,intent:{type:'synthetic-noop'},character:{id:'hero'}};
  const expected={envelope,randomValues:[.25],patch:{runtime_revision:8,turn_state:{solo_combat_v1:structuredClone(envelope.state)}},trace:{beforeHash:snapshotHash(envelope),afterHash:snapshotHash(envelope),runtimeRevision:8}};
  const stack={registry:{runId,directory}};
  try{
    const full=await profileFreshProtocol({stack,body,expected,artifactFile,protocol:'full',rounds:1});
    const mirrors=await profileFreshProtocol({stack,body,expected,artifactFile,protocol:'mirrors-v2',rounds:1});
    for(const profile of [full,mirrors]){
      assert.equal(profile.cold.metrics.worker_artifact_cache_hit,0);
      assert.equal(profile.fullResultEquality,true);assert.equal(profile.resultHash,snapshotHash(expected));
      assert.deepEqual(profile.loads.map(row=>row.requests),[1,4,16]);
      assert.ok(!JSON.stringify(profile).includes('private-test-only-marker'));
      for(const load of profile.loads){
        assert.equal(load.protocol,profile.protocol);assert.ok(load.samples.every(row=>row.metrics.worker_artifact_cache_hit===1));
        assert.equal(load.window.handlerBoundary.callbacksEntered,load.requests);assert.equal(load.window.handlerBoundary.callbacksClosed,load.requests);assert.equal(load.window.handlerBoundary.activeAtFinish,0);
        assert.ok(load.window.before.rssBytes>0);assert.ok(load.window.observedPeak.rssBytes>=load.window.before.rssBytes);
        assert.ok(Number.isFinite(load.window.processWindowCPUms));assert.ok(load.window.eventLoopDelay.samples>0);
        assert.equal(load.window.admission.queueTimeMeasured,false);assert.equal(load.window.admission.enforcedGlobalLimit,null);
      }
    }
    assert.ok(mirrors.cold.responseBytes<full.cold.responseBytes);
    const alternateSource=`// Second immutable artifact\n${source}`,alternateHash=createHash('sha256').update(alternateSource).digest('hex'),alternateFile=path.join(directory,`${alternateHash}.cjs`);
    await writeFile(alternateFile,alternateSource);
    const reloaded=await profileFreshProtocol({stack,body,expected,artifactFile,rounds:1,evictingArtifactFiles:[alternateFile]});
    assert.equal(reloaded.evictionProbe.reloaded.metrics.worker_artifact_cache_hit,0);
    assert.equal(reloaded.evictionProbe.fullResultEquality,true);
    await assert.rejects(profileFreshProtocol({stack,body,expected:{...expected,randomValues:[.75]},artifactFile,rounds:1}),{message:'owned_worker_probe_full_result_mismatch'});
    await assert.rejects(profileFreshProtocol({stack,body:{...body,artifactHash:`sha256:${'0'.repeat(64)}`},expected,artifactFile,rounds:1}));
  }finally{
    await assertRealOwnedPath(runsRoot,directory);
    assert.equal(path.basename(directory),runId);
    await rm(directory,{recursive:true,force:true});
  }
});
