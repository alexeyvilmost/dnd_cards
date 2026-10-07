import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,unlinkSync,rmdirSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {retirementExecutionUnitFixture} from './retirement-state-unit-fixture.mjs';
import {createDeploymentStore,deploy,recover} from './deploy-state.mjs';
import {recordRetirementExecutionOutcome,reconcileRetirementObservation} from './retirement-outcome-journal.mjs';
import {prepareRetirementExecutionIntent,markRetirementExecutionOutcomeUnknown,validateRetirementExecutionIntent} from './retirement-intent.mjs';
import {evidenceHash} from './validate-manifest.mjs';

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
test('a complete ordinary application can finish retirement observation after current-format writes appear',async t=>{
 const f=fixture(t),observe=f.observe;f.execution.result.inspection.rollbackReadersSafe=false;
 f.observe=async state=>{const result=await observe(state);result.database.oldReadersSafe=false;return result;};
 const result=await recordRetirementExecutionOutcome(f.args());assert.equal(result.status,'succeeded');assert.equal(f.store.active().database.migrationSet.length,f.active.database.migrationSet.length+1);
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

const intentArgs=f=>({store:f.store,executorManifest:f.executorManifest,approvalHash:f.approvalHash,request:f.request});
test('pre-execution intent is durable, contains the original request and blocks ordinary deploy/recover before any command',async t=>{
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));assert.equal(intent.status,'retirement_prepared');assert.equal(f.observations.length,0);assert.deepEqual(f.store.active(),f.active);
 const reloaded=createDeploymentStore(f.root);assert.deepEqual(validateRetirementExecutionIntent(reloaded.operation(f.request.releaseId)),intent);assert.equal(reloaded.pending().length,1);
 await assert.rejects(deploy({store:reloaded,adapter:{},candidate:{releaseId:f.request.releaseId},bundle:{}}),/separate reconciliation/);await assert.rejects(recover({store:reloaded,adapter:{},releaseId:f.request.releaseId}),/separate reconciliation/);
 await assert.rejects(deploy({store:reloaded,adapter:{},candidate:{releaseId:'another'},bundle:{}}),/Another release outcome/);
 assert.equal((await prepareRetirementExecutionIntent({...intentArgs(f),store:reloaded})).repeated,true);assert.deepEqual(reloaded.operation(f.request.releaseId),intent);
});
test('uncertainty is persisted before sending the command and has no execution callback',async t=>{
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));const marked=await markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash});assert.equal(marked.status,'retirement_outcome_unknown');assert.equal(marked.intentHash,intent.intentHash);assert.deepEqual(marked.request,f.request);assert.equal(f.observations.length,0);
 const reloaded=createDeploymentStore(f.root),again=await markRetirementExecutionOutcomeUnknown({store:reloaded,releaseId:f.request.releaseId,intentHash:intent.intentHash});assert.equal(again.repeated,true);assert.deepEqual(reloaded.operation(f.request.releaseId),marked);
});
test('prepared state cannot masquerade as a dispatched command outcome',async t=>{const f=fixture(t);await prepareRetirementExecutionIntent(intentArgs(f));await assert.rejects(recordRetirementExecutionOutcome(f.args()),/uncertainty must be persisted/);assert.equal(f.store.operation(f.request.releaseId).status,'retirement_prepared');assert.equal(f.observations.length,0);});
test('verified outcome atomically replaces the intent journal while retaining the complete original intent',async t=>{
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));const dispatched=await markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash});const result=await recordRetirementExecutionOutcome(f.args());assert.equal(result.status,'succeeded');assert.equal(result.schemaVersion,2);assert.deepEqual(result.executionIntent,dispatched);assert.equal(result.createdAt,intent.createdAt);assert.deepEqual(f.store.pending(),[]);
 f.execution.result.applied=[];assert.equal((await recordRetirementExecutionOutcome(f.args())).repeated,true);assert.deepEqual(f.store.operation(f.request.releaseId).executionIntent,dispatched);
});
test('lost intent write acknowledgement leaves a reloadable identical pending command without execution',async t=>{
 const f=fixture(t),real=f.store;f.store={...real,writeOperation(value){real.writeOperation(value);throw Error('lost acknowledgement');}};await assert.rejects(prepareRetirementExecutionIntent(intentArgs(f)));const reloaded=createDeploymentStore(f.root);const saved=reloaded.operation(f.request.releaseId);validateRetirementExecutionIntent(saved);assert.equal(saved.status,'retirement_prepared');assert.equal(f.observations.length,0);assert.equal((await prepareRetirementExecutionIntent({...intentArgs(f),store:reloaded})).repeated,true);
});
test('lost uncertainty write acknowledgement cannot reset the persisted command to prepared',async t=>{
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f)),real=f.store;f.store={...real,writeOperation(value){real.writeOperation(value);throw Error('lost acknowledgement');}};await assert.rejects(markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash}));const reloaded=createDeploymentStore(f.root);assert.equal(reloaded.operation(f.request.releaseId).status,'retirement_outcome_unknown');assert.equal((await prepareRetirementExecutionIntent({...intentArgs(f),store:reloaded})).status,'retirement_outcome_unknown');
});
test('failed outcome observation preserves both the original intent and the receipt for read-only reconciliation',async t=>{
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));await markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash});const observe=f.observe;f.observe=async()=>{throw Error('connection unavailable');};await assert.rejects(recordRetirementExecutionOutcome(f.args()));const saved=f.store.operation(f.request.releaseId);assert.equal(saved.status,'recovery_required');assert.equal(saved.executionIntent.intentHash,intent.intentHash);
 const reloaded=createDeploymentStore(f.root);const result=await reconcileRetirementObservation({store:reloaded,releaseId:f.request.releaseId,observe});assert.equal(result.status,'succeeded');assert.deepEqual(result.executionIntent,saved.executionIntent);assert.deepEqual(reloaded.pending(),[]);
});
for(const [name,mutate]of [
 ['changed request',f=>{f.request.retirement.backupHash='sha256:'+'f'.repeat(64);}],
 ['another executor image',f=>{f.executorManifest.components.backend.imageDigest='example.test/backend@sha256:'+'f'.repeat(64);}],
 ['changed approval',f=>{f.approvalHash='sha256:'+'f'.repeat(64);}],
])test('persisted intent refuses '+name+' before any observation',async t=>{const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));await markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash});mutate(f);await assert.rejects(prepareRetirementExecutionIntent(intentArgs(f)),/Changed retirement intent/);await assert.rejects(recordRetirementExecutionOutcome(f.args()),/Changed retirement intent/);assert.equal(f.observations.length,0);assert.equal(f.store.operation(intent.releaseId).intentHash,intent.intentHash);});
test('coherently rehashed mutation of the original request inside a completed intent is refused',async t=>{const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));await markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash});await recordRetirementExecutionOutcome(f.args());const op=f.store.operation(f.request.releaseId);op.executionIntent.request.retirement.backupHash='sha256:'+'f'.repeat(64);const i=op.executionIntent;i.intentHash=evidenceHash({previous:i.previous,executorManifest:i.executorManifest,approvalHash:i.approvalHash,request:i.request});f.store.writeOperation(op);await assert.rejects(reconcileRetirementObservation({store:f.store,releaseId:f.request.releaseId,observe:f.observe}),/original execution intent/);});
test('the new journal format cannot omit its intent and old journals are not silently upgraded',async t=>{
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));await markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash});await recordRetirementExecutionOutcome(f.args());const changed=f.store.operation(f.request.releaseId);delete changed.executionIntent;f.store.writeOperation(changed);await assert.rejects(reconcileRetirementObservation({store:f.store,releaseId:f.request.releaseId,observe:f.observe}),/Exact retirement observation/);
 const old=fixture(t);assert.equal((await recordRetirementExecutionOutcome(old.args())).schemaVersion,1);assert.equal(old.store.operation(old.request.releaseId).executionIntent,undefined);
});
test('unknown fields, stale baselines, changed ledger or another pending operation cannot authorize an intent',async t=>{
 for(const mutate of [f=>{f.request.private='PRIVATE_CANARY';},f=>{f.request.expectedCurrent.pop();},f=>{f.request.expectedAdditiveSchemaProofHash='sha256:'+'f'.repeat(64);},f=>{f.store.writeOperation({releaseId:'other',status:'recovery_required'});}]){const f=fixture(t);mutate(f);await assert.rejects(prepareRetirementExecutionIntent(intentArgs(f)));assert.equal(f.store.operation(f.request.releaseId),null);assert.equal(f.observations.length,0);}
 const f=fixture(t),intent=await prepareRetirementExecutionIntent(intentArgs(f));const changed=f.store.active();changed.manifest.releaseId='later';f.store.writeActive(changed);await assert.rejects(markRetirementExecutionOutcomeUnknown({store:f.store,releaseId:f.request.releaseId,intentHash:intent.intentHash}),/stale/);assert.equal(f.store.operation(f.request.releaseId).status,'retirement_prepared');
});
for(const phase of ['retirement_prepared','retirement_outcome_unknown'])test('actual child-process exit after durable '+phase+' preserves the exact request and requires explicit owned lock recovery',async t=>{
 const f=fixture(t),args=intentArgs(f);delete args.store;
 const program=`import fs from 'node:fs';const input=JSON.parse(fs.readFileSync(0,'utf8'));
 const {createDeploymentStore}=await import(${JSON.stringify(new URL('./deploy-state.mjs',import.meta.url).href)});
 const {prepareRetirementExecutionIntent,markRetirementExecutionOutcomeUnknown}=await import(${JSON.stringify(new URL('./retirement-intent.mjs',import.meta.url).href)});
 const real=createDeploymentStore(input.root),store={...real,writeOperation(value){real.writeOperation(value);if(value.status===input.phase)process.exit(73);}};
 const intent=await prepareRetirementExecutionIntent({store,...input.args});await markRetirementExecutionOutcomeUnknown({store,releaseId:intent.releaseId,intentHash:intent.intentHash});throw Error('Expected interruption did not happen');`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',program],{input:JSON.stringify({root:f.root,args,phase}),encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(child.status,73);assert.equal(child.stderr,'');
 const reloaded=createDeploymentStore(f.root),saved=validateRetirementExecutionIntent(reloaded.operation(f.request.releaseId));assert.equal(saved.status,phase);assert.deepEqual(saved.request,f.request);assert.deepEqual(reloaded.active(),f.active);assert.throws(()=>reloaded.lock(),/Deployment lock exists/);assert.equal(f.observations.length,0);
 // Only this terminated fixture child's exact local lock is removed. The
 // production store itself never silently breaks a lock or retries commands.
 const lock=path.join(f.root,'deploy.lock');assert.equal(realpathSync(lock),lock);assert.equal(path.dirname(lock),f.root);const owner=JSON.parse(readFileSync(path.join(lock,'owner.json')));assert.equal(owner.pid,child.pid);unlinkSync(path.join(lock,'owner.json'));rmdirSync(lock);
 const continued=await prepareRetirementExecutionIntent({...args,store:reloaded});assert.equal(continued.repeated,true);assert.equal(continued.status,phase);assert.deepEqual(reloaded.operation(f.request.releaseId),saved);
 if(phase==='retirement_outcome_unknown'){assert.equal((await recordRetirementExecutionOutcome({...f.args(),store:reloaded})).status,'succeeded');assert.deepEqual(reloaded.operation(f.request.releaseId).executionIntent,saved);}
});
