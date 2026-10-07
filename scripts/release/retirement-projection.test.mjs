// Synthetic retirement metadata; real filesystem/CLI authority boundaries.
// These tests do not prove DDL, production health or an accepted host workflow.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {retirementStateUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {projectRetirementObservation,validateRetirementProjection,retirementBaselineReceipt,main} from './retirement-projection.mjs';
import {verifiedRetirementBaseline,readRetirementBaselineArtifact} from './retirement-baseline.mjs';
import {verifyBaseline} from './ci-release.mjs';
import {prepareRetirementExecutionIntent,markRetirementExecutionOutcomeUnknown} from './retirement-intent.mjs';
function fixture(t){
 const f=retirementStateUnitFixture(),root=mkdtempSync(path.join(tmpdir(),'retirement-projection-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('retirement-projection-'));rmSync(root,{recursive:true,force:true});});
 const active={...structuredClone(f.active),database:retirementDatabaseStateFromInspection(f,f.inspection)},stamp='2026-10-06T00:00:00Z';
 const operation={schemaVersion:1,kind:'character-retirement-observation-302',releaseId:f.request.releaseId,status:'succeeded',previous:f.active,desired:active,transitionHash:evidenceHash({previous:f.active,desired:active}),createdAt:stamp,updatedAt:stamp};
 const store=createDeploymentStore(root);store.writeActive(active);store.writeOperation(operation);
 const request={repository:'fixture/project',runId:42,attempt:2,controlCommit:'c'.repeat(40),sourceCommit:active.manifest.releaseCommit};
 return {...f,root,store,active,operation,request,manifest:active.manifest};
}
function rehash(p){p.activeHash=evidenceHash(p.active);p.operationHash=evidenceHash(p.operation);const {projectionHash,...doc}=p;p.projectionHash=evidenceHash(doc);return p;}
test('current succeeded store projects original manifest and separate installed database identity',t=>{
 const f=fixture(t),before=readFileSync(path.join(f.root,'active.json')),p=projectRetirementObservation(f),receipt=retirementBaselineReceipt(p);
 assert.deepEqual(p.active,f.active);assert.deepEqual(p.active.manifest,f.operation.previous.manifest);assert.notDeepEqual(p.active.database.migrationSet,p.active.manifest.migrationSet);
 assert.deepEqual(projectRetirementObservation({...f,operation:{...f.operation,repeated:true}}),p);
 const run={repository:f.request.repository,id:42,runAttempt:2,controlCommit:f.request.controlCommit};
 assert.deepEqual(verifiedRetirementBaseline(f.manifest,receipt,run,p),f.active);assert.equal(verifyBaseline(f.manifest,receipt,run,p),f.manifest);
 assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);assert.equal(existsSync(path.join(f.root,'deploy.lock')),false);
 assert.equal(verifiedRetirementBaseline(f.manifest,{...receipt,retirementObservationHash:undefined},run,undefined),null);
});
test('format2 retains the durable original intent through projection and the next build baseline',async t=>{
 const f=fixture(t),root=path.join(f.root,'intent-store');mkdirSync(root,{mode:0o700});
 const store=createDeploymentStore(root);store.writeActive(f.operation.previous);
 const request=structuredClone(f.active.database.request);delete request.receiptHash;
 request.kind='execute-character-retirement-302';request.expectedCurrent=structuredClone(f.operation.previous.database.migrationSet);
 const prepared=await prepareRetirementExecutionIntent({store,executorManifest:f.executorManifest,approvalHash:f.approvalHash,request});
 const intent=await markRetirementExecutionOutcomeUnknown({store,releaseId:request.releaseId,intentHash:prepared.intentHash});
 const operation={...f.operation,schemaVersion:2,createdAt:intent.createdAt,executionIntent:intent};
 store.writeActive(f.active);store.writeOperation(operation);
 const p=projectRetirementObservation({...f,store,operation}),receipt=retirementBaselineReceipt(p);
 assert.deepEqual(p.operation.executionIntent,intent);assert.deepEqual(p.active.manifest,f.manifest);
 const run={repository:f.request.repository,id:42,runAttempt:2,controlCommit:f.request.controlCommit};
 assert.deepEqual(verifiedRetirementBaseline(f.manifest,receipt,run,p),f.active);
 assert.deepEqual(verifyBaseline(f.manifest,receipt,run,p),f.manifest);
 const before=readFileSync(path.join(root,'active.json'));
 for(const change of [x=>delete x.operation.executionIntent,x=>x.operation.executionIntent.private='PRIVATE_CANARY',x=>x.operation.executionIntent.approvalHash='sha256:'+'f'.repeat(64)]){
  const altered=structuredClone(p);change(altered);
  if(altered.operation.executionIntent){const i=altered.operation.executionIntent;i.intentHash=evidenceHash({previous:i.previous,executorManifest:i.executorManifest,approvalHash:i.approvalHash,request:i.request});}
  rehash(altered);assert.throws(()=>verifyBaseline(f.manifest,{...receipt,retirementObservationHash:evidenceHash(altered)},run,altered));
 }
 assert.deepEqual(readFileSync(path.join(root,'active.json')),before);
});
test('missing, unattested and coherently altered workflow records cannot enter baseline',t=>{
 const f=fixture(t),p=projectRetirementObservation(f),receipt=retirementBaselineReceipt(p),run={repository:f.request.repository,id:42,runAttempt:2,controlCommit:f.request.controlCommit};
 assert.throws(()=>verifyBaseline(f.manifest,receipt,run),/Exact retirement artifact/);
 assert.throws(()=>verifyBaseline(f.manifest,{...receipt,retirementObservationHash:undefined},run,p),/Unattested/);
 for(const change of [x=>x.deployment.runId++,x=>x.deployment.runAttempt++,x=>x.deployment.repository='other/project',x=>x.deployment.controlCommit='d'.repeat(40),x=>x.deployment.sourceCommit='e'.repeat(40)]){
  const altered=structuredClone(p);change(altered);rehash(altered);
  assert.throws(()=>verifyBaseline(f.manifest,{...receipt,retirementObservationHash:evidenceHash(altered)},run,altered));
 }
});
test('lock, pending operation, changed journal and stale application refuse without writes',t=>{
 const f=fixture(t),before=readFileSync(path.join(f.root,'active.json')),unlock=f.store.lock();assert.throws(()=>projectRetirementObservation(f));unlock();
 f.store.writeOperation({releaseId:'pending',status:'recovery_required'});assert.throws(()=>projectRetirementObservation(f));f.store.writeOperation({releaseId:'pending',status:'failed_before_cutover'});
 for(const mutate of [x=>x.status='recovery_required',x=>x.desired.instances.backend.releaseId='changed',x=>x.private='PRIVATE_CANARY']){
  const op=structuredClone(f.operation);mutate(op);f.store.writeOperation(op);assert.throws(()=>projectRetirementObservation({...f,operation:op}));
 }
 f.store.writeOperation(f.operation);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
 const later=structuredClone(f.active);later.instances.backend.releaseId='later';f.store.writeActive(later);assert.throws(()=>projectRetirementObservation(f));assert.deepEqual(f.store.active(),later);
});
test('nested private data and malformed retirement state fail even with rehashed documents',t=>{
 const f=fixture(t),original=projectRetirementObservation(f);
 for(const mutate of [p=>p.secret='PRIVATE_CANARY',p=>p.active.database.secret='PRIVATE_CANARY',p=>p.operation.previous.secret='PRIVATE_CANARY',p=>p.operation.desired.database.request.retirement.password='PRIVATE_CANARY',p=>p.active.manifest.components.backend.env='PRIVATE_CANARY',p=>p.operation.desired.database.migrationSet.pop()]){
  const p=structuredClone(original);mutate(p);rehash(p);assert.throws(()=>validateRetirementProjection(p,{request:f.request,manifest:f.manifest}));
 }
});
test('actual CLI emits byte-identical manifest and bound receipt into a new protected directory',t=>{
 const f=fixture(t),attempt=path.join(f.root,'attempt');mkdirSync(attempt,{mode:0o700});
 const config=path.join(f.root,'config.json'),op=path.join(attempt,'operation.json'),manifest=path.join(attempt,'manifest.json'),output=path.join(attempt,'published');
 writeFileSync(config,JSON.stringify({schemaVersion:1,root:f.root,private:'PRIVATE_CONFIG_CANARY'}));writeFileSync(op,JSON.stringify(f.operation));writeFileSync(manifest,JSON.stringify(f.manifest,null,3)+'\n');
 const env={...process.env,GITHUB_REPOSITORY:f.request.repository,GITHUB_SHA:f.request.controlCommit,DEPLOY_SOURCE_COMMIT:f.request.sourceCommit,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'2'};
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./retirement-projection.mjs',import.meta.url)),config,op,manifest,output,attempt],{env,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).status,'recorded-retirement-only');
 assert.deepEqual(readFileSync(path.join(output,'manifest.json')),readFileSync(manifest));
 const p=readRetirementBaselineArtifact(output),receipt=JSON.parse(readFileSync(path.join(output,'deployment.json'),'utf8'));
 assert.deepEqual(verifiedRetirementBaseline(f.manifest,receipt,{repository:f.request.repository,id:42,runAttempt:2,controlCommit:f.request.controlCommit},p),f.active);
 assert.ok(!JSON.stringify(p).includes('PRIVATE_CONFIG_CANARY'));assert.ok(!JSON.stringify(p).includes(f.root));
 const bytes=readFileSync(path.join(output,'retirement-observation.json'));assert.throws(()=>main([config,op,manifest,output,attempt],env));assert.deepEqual(readFileSync(path.join(output,'retirement-observation.json')),bytes);
 assert.throws(()=>main([config,op,manifest,path.join(f.root,'outside-attempt'),attempt],env));
 const alias=path.join(attempt,'alias');symlinkSync(output,alias,process.platform==='win32'?'junction':'dir');assert.throws(()=>readRetirementBaselineArtifact(alias));
});
