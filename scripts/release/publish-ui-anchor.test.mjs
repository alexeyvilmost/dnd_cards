import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {publishCapturedUIAnchor,recheckPublishedAnchor} from './publish-ui-anchor.mjs';
import {uiFixture} from './ui-release-unit-fixture.mjs';import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
import {checksum} from './backup-manifest.mjs';import {evidenceHash} from './validate-manifest.mjs';
async function fixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'ui-publication-unit-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('ui-publication-unit-'));rmSync(root,{recursive:true,force:true});});
  mkdirSync(path.join(root,'full-anchors'));const runtimeFile=path.join(root,'runtime.json');writeFileSync(runtimeFile,'{}');
  const f=uiFixture(),manifest=f.manifest,run={id:57,runAttempt:2,controlCommit:'a'.repeat(40)},active={manifest},operation={status:'succeeded'};
  const executionProfile={schemaVersion:1,...Object.fromEntries(['backend','rulesWorker'].map(component=>[component,{instance:{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit},environment:safeExecutionEnvironment(component,[])}]))};
  const observation={protectedRuntime:f.protectedRunning,files:f.bundle.rehearsalReceipt.filesBefore,executionProfile,services:{frontend:{healthy:true}},routingSecurityHash:f.originalAnchor.domain.routingSecurityHash,databaseBindingHash:f.originalAnchor.domain.databaseBindingHash};
  const document={kind:'protected-full-ui-anchor',status:'captured-after-success',binding:f.planning.input.fullAnchor,anchor:f.originalAnchor,
    observedAt:'2026-10-06T00:00:00.000Z',executionProfile,activeHash:evidenceHash(active),operationHash:evidenceHash(operation),observation,runtimeDocument:{file:runtimeFile,sha256:await checksum(runtimeFile)}};
  let locked=false,observations=0;const store={lock:()=>{assert.equal(locked,false);locked=true;return()=>{locked=false;};},active:()=>active,operation:()=>operation,pending:()=>[]};
  const options={config:{root},document,manifest,run,output:path.join(root,'public.json'),store,recheck:options=>recheckPublishedAnchor({...options,observe:async()=>{assert.equal(locked,true);observations++;return structuredClone(observation);}})};
  return {...options,options,root,observation,active,operation,observations:()=>observations,isLocked:()=>locked};
}
test('post-success publication writes only validated projection and preserves original proof dates',async t=>{
  const f=await fixture(t),result=await publishCapturedUIAnchor(f.options);assert.equal(result.status,'published');assert.equal(f.observations(),1);assert.equal(f.isLocked(),false);
  assert.deepEqual(JSON.parse(readFileSync(f.output,'utf8')),result.projection);assert.equal(result.projection.originalAnchor.completedAt,f.document.binding.completedAt);
  assert.equal(JSON.parse(readFileSync(path.join(f.root,'full-anchors/current.json'),'utf8')).anchorHash,evidenceHash(f.document));
});
test('only publication IO failure can return unavailable after another fresh protected recheck',async t=>{
  const f=await fixture(t),result=await publishCapturedUIAnchor({...f.options,publish:()=>{throw Object.assign(Error('secret canary'),{code:'ENOSPC'});}});
  assert.deepEqual(result,{status:'unavailable',reason:'anchor_publication_failed'});assert.equal(f.observations(),2);assert.equal(f.isLocked(),false);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('integrity drift before publication never becomes success-without-projection',async t=>{
  const f=await fixture(t);f.observation.routingSecurityHash='sha256:'+'0'.repeat(64);
  // The captured document is immutable and independently owned from observation.
  f.document.observation=structuredClone(f.document.observation);f.document.observation.routingSecurityHash='sha256:'+'d'.repeat(64);
  let writes=0;await assert.rejects(publishCapturedUIAnchor({...f.options,publish:()=>{writes++;}}),/Protected runtime changed/);assert.equal(writes,0);assert.equal(f.isLocked(),false);
});
test('unknown write errors and drift after an IO failure remain failures',async t=>{
  const f=await fixture(t);await assert.rejects(publishCapturedUIAnchor({...f.options,publish:()=>{throw Object.assign(Error('collision'),{code:'EEXIST'});}}),/collision/);
  await assert.rejects(publishCapturedUIAnchor({...f.options,publish:()=>{f.active.changed=true;throw Object.assign(Error('write unavailable'),{code:'EIO'});}}),/Deployment changed/);assert.equal(f.isLocked(),false);
});
