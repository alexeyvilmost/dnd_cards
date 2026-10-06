import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {retirementExecutionUnitFixture} from './retirement-state-unit-fixture.mjs';
import {createDeploymentStore,deploy,recover} from './deploy-state.mjs';
import {recordRetirementExecutionOutcome,reconcileRetirementObservation} from './retirement-outcome-journal.mjs';

function fixture(t){
 const f=retirementExecutionUnitFixture(),root=mkdtempSync(path.join(tmpdir(),'retirement-journal-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('retirement-journal-'));rmSync(root,{recursive:true,force:true});});
 f.root=root;f.store=createDeploymentStore(root);f.store.writeActive(f.active);f.observations=[];
 f.observe=async state=>{
  f.observations.push(structuredClone(state));assert.throws(()=>createDeploymentStore(root).lock());
  return {database:{schemaStatus:'verified',migrationSet:state.database.migrationSet,schemaProofHash:state.database.schemaProofHash,oldReadersSafe:true},services:Object.fromEntries(Object.entries(state.manifest.components).map(([key,c])=>[key,{healthy:true,imageDigest:c.imageDigest,identity:{component:key,provenance:'baked',sourceCommit:c.sourceCommit,inputFingerprint:c.inputFingerprint,apiProtocolVersion:state.manifest.apiProtocolVersion,...state.instances[key],...(key==='rulesWorker'?{artifactHash:state.manifest.rulesArtifactHash,workerRuntime:state.manifest.workerRuntime,workerProtocolVersion:state.manifest.workerProtocolVersion,supportedWorldSchemaVersions:state.manifest.supportedWorldSchemaVersions,capabilities:state.manifest.capabilities}:{})}}]))};
 };
 f.args=()=>({store:f.store,executorManifest:f.executorManifest,approvalHash:f.approvalHash,request:f.request,receipt:f.execution,observe:f.observe});
 return f;
}
test('receipt recording is serialized, retains application instances and completes the shared journal',async t=>{
 const f=fixture(t),result=await recordRetirementExecutionOutcome(f.args());assert.equal(result.status,'succeeded');assert.deepEqual(f.store.active().manifest,f.active.manifest);assert.deepEqual(f.store.active().instances,f.active.instances);assert.deepEqual(f.store.pending(),[]);
 const before=readFileSync(path.join(f.root,'active.json'));f.execution.result.applied=[];
 assert.equal((await recordRetirementExecutionOutcome(f.args())).repeated,true);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);assert.equal(f.observations.length,2);
});
test('failed live verification keeps a pending receipt, blocking ordinary deployment and requiring read-only reconciliation',async t=>{
 const f=fixture(t),observe=f.observe;f.observe=async()=>{throw Error('unavailable');};await assert.rejects(recordRetirementExecutionOutcome(f.args()));
 assert.equal(f.store.operation(f.request.releaseId).status,'recovery_required');assert.deepEqual(f.store.active(),f.active);
 await assert.rejects(recover({store:f.store,adapter:{},releaseId:f.request.releaseId}),/separate reconciliation/);
 await assert.rejects(deploy({store:f.store,adapter:{},candidate:{releaseId:f.request.releaseId},bundle:{}}),/separate reconciliation/);
 const reloaded=createDeploymentStore(f.root);assert.equal((await reconcileRetirementObservation({store:reloaded,releaseId:f.request.releaseId,observe})).status,'succeeded');assert.deepEqual(reloaded.pending(),[]);
});
for(const failure of ['before-active-write','after-active-write','after-success-journal-write'])test('restart after '+failure+' observes the saved outcome without any execution callback',async t=>{
 const f=fixture(t),real=f.store;let fail=true;
 f.store={...real,writeActive(state){if(fail&&failure==='before-active-write'){fail=false;throw Error('lost write');}real.writeActive(state);},writeOperation(operation){if(fail&&operation.status==='succeeded'){
  fail=false;if(failure==='after-success-journal-write')real.writeOperation(operation);throw Error('lost acknowledgement');
 }real.writeOperation(operation);}};
 await assert.rejects(recordRetirementExecutionOutcome(f.args()));
 const reloaded=createDeploymentStore(f.root);assert.equal((await reconcileRetirementObservation({store:reloaded,releaseId:f.request.releaseId,observe:f.observe})).status,'succeeded');assert.equal(reloaded.active().database.status,'verified-character-retirement');assert.deepEqual(reloaded.pending(),[]);
});
test('changed command outcome is refused before any state write or live observation',async t=>{
 const f=fixture(t);f.execution.result.request.retirement.backupHash='sha256:'+'a'.repeat(64);const before=readFileSync(path.join(f.root,'active.json'));
 await assert.rejects(recordRetirementExecutionOutcome(f.args()));assert.equal(f.observations.length,0);assert.equal(f.store.operation(f.request.releaseId),null);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
});
test('pending unrelated release and colliding journal kinds refuse receipt recording',async t=>{
 for(const operation of [{releaseId:'other',status:'recovery_required'},{releaseId:'retirement-inspector',status:'recovery_required',kind:'ordinary-deployment'}]){
  const f=fixture(t);f.store.writeOperation(operation);await assert.rejects(recordRetirementExecutionOutcome(f.args()));assert.deepEqual(f.store.active(),f.active);assert.equal(f.observations.length,0);
 }
});
test('stale completed journal cannot overwrite a later release or its database',async t=>{
 const f=fixture(t);await recordRetirementExecutionOutcome(f.args());const later=f.store.active();later.manifest.releaseId='later';f.store.writeActive(later);const before=readFileSync(path.join(f.root,'active.json'));
 await assert.rejects(reconcileRetirementObservation({store:f.store,releaseId:f.request.releaseId,observe:f.observe}),/stale/);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
});
test('changed stored request or private fields cannot be reconciled',async t=>{
 for(const mutate of [op=>{op.desired.database.request.retirement.backupHash='sha256:'+'a'.repeat(64);},op=>{op.private='PRIVATE_CANARY';},op=>{op.desired.manifest.releaseId='changed';}]){
  const f=fixture(t);await recordRetirementExecutionOutcome(f.args());const op=f.store.operation(f.request.releaseId);mutate(op);f.store.writeOperation(op);const before=readFileSync(path.join(f.root,'active.json'));
  await assert.rejects(reconcileRetirementObservation({store:f.store,releaseId:f.request.releaseId,observe:f.observe}));assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
 }
});
