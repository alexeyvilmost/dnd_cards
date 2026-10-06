// Unit-only proof inputs; actual filesystem journal/lock and canonical apply path.
// No Docker, SQL, GitHub or deployment success claim is made by this fixture.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {uiFixture,h} from './ui-release-unit-fixture.mjs';
import {createDeploymentStore} from './deploy-state.mjs';import {deployFrontend} from './ui-deploy-state.mjs';
import {writeSucceededFrontendReceipt} from './ui-host-release.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {projectSucceededActive,validateActiveProjection,validatePublicActive} from './active-projection.mjs';
import {createUIProofProjection} from './ui-proof-projection.mjs';import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
import {validatePublicReceipt} from './ssh-transport.mjs';
const clone=structuredClone,read=file=>JSON.parse(readFileSync(file,'utf8'));
async function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'ui-active-projection-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('ui-active-projection-'));rmSync(root,{recursive:true,force:true});});
 const context=uiFixture(),manifest=context.manifest,previous={schemaVersion:1,status:'active',manifest:context.planning.input.previousManifest,
  instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:'full-origin',releaseCommit:'a'.repeat(40)}]))};
 // Valid persisted additive identity from a previous expansion, not a new SQL proof.
 const target=[{id:'298_compact_command_receipts',checksum:h('9')}];
 previous.database={schemaVersion:1,status:'verified-additive',migrationSet:target,schemaProofHash:h('d'),approvalHash:h('e'),
  request:{schemaVersion:1,releaseId:'prior-schema-expansion',expectedCurrent:[],target:clone(target),candidateSourceCommit:'a'.repeat(40),candidateInputFingerprint:manifest.components.backend.inputFingerprint},executorImageDigest:manifest.components.backend.imageDigest};
 const store=createDeploymentStore(root);store.writeActive(previous);let running=clone(previous);const calls=[];
 const observe=async state=>{assert.ok(existsSync(path.join(root,'deploy.lock')));assert.deepEqual(running,state);calls.push('observe');return {scope:'whole-application',protectedRuntime:clone(context.protectedRunning),files:clone(context.bundle.rehearsalReceipt.filesBefore),databaseBindingHash:h('d'),routingSecurityHash:h('d'),databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted',services:{frontend:{healthy:true,imageDigest:state.manifest.components.frontend.imageDigest}}};};
 const adapter={observe,prepare:async()=>calls.push('prepare'),replaceFrontend:async state=>{assert.ok(existsSync(path.join(root,'deploy.lock')));calls.push('replace:frontend');running=clone(state);}};
 const operation=await deployFrontend({store,adapter,candidate:manifest,bundle:context.bundle,context});
 const workflow={id:42,runAttempt:2,controlCommit:'c'.repeat(40)},repository='example/project';
 const request={schemaVersion:1,repository,runId:42,attempt:2,controlCommit:workflow.controlCommit,sourceCommit:manifest.releaseCommit,actor:'github-actions[bot]',eventName:'workflow_run',mode:'apply',attemptRoot:'/owned/attempts',hostConfig:'/owned/host.json',rehearsalConfig:'/owned/rehearsal.json',nodePath:'/usr/bin/node',productionEnabled:'true'};
 const executionProfile={schemaVersion:1,...Object.fromEntries(['backend','rulesWorker'].map(component=>[component,{instance:clone(previous.instances[component]),environment:safeExecutionEnvironment(component,[])}]))};
 const projection=createUIProofProjection({kind:'protected-full-ui-anchor',status:'captured-after-success',binding:context.planning.input.fullAnchor,anchor:context.originalAnchor,observedAt:'2026-10-06T00:00:00.000Z',executionProfile},{manifest,run:workflow});
 return {root,store,context,manifest,previous,operation,workflow,repository,request,projection,calls};
}
test('actual filesystem UI success publishes full recorded state, compact anchor and unchanged reused launches/database',async t=>{
 const f=await setup(t),output=path.join(f.root,'public');
 const before=readFileSync(path.join(f.root,'active.json'));
 assert.equal(writeSucceededFrontendReceipt({...f,output}).status,'succeeded');
 const active=f.store.active(),p=read(path.join(output,'active-projection.json'));
 assert.deepEqual(p.active,active);assert.equal(p.activeHash,evidenceHash(active));assert.deepEqual(p.active.uiProofAnchor,f.context.planning.input.fullAnchor);
 assert.notEqual(p.activeHash,evidenceHash(Object.fromEntries(Object.entries(active).filter(([key])=>key!=='uiProofAnchor'))));
 for(const key of ['backend','rulesWorker'])assert.deepEqual(p.active.instances[key],f.previous.instances[key]);
 assert.deepEqual(p.active.database,f.previous.database);assert.equal(p.active.instances.frontend.releaseId,f.manifest.releaseId);
 assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);assert.equal(existsSync(path.join(f.root,'deploy.lock')),false);
 assert.equal(f.calls.filter(x=>x.startsWith('replace:')).length,1);
 assert.deepEqual(projectSucceededActive({...f,operation:{...f.operation,repeated:true}}),p);
 const result={status:'succeeded',sourceCommit:f.request.sourceCommit,controlCommit:f.request.controlCommit,manifest:f.manifest,deployment:read(path.join(output,'deployment.json')),activeProjection:p,frontendProof:{status:'published',projection:f.projection}};
 validatePublicReceipt(result,f.request);
 for(const mutate of [r=>r.deployment.operationHash=h('0'),r=>r.deployment.originalFullAnchorHash=h('0'),r=>r.deployment.completedAt='2026-02-30T00:00:00.000Z',r=>r.deployment.privatePath='/owned/private',r=>r.frontendProof={status:'unavailable',reason:'anchor_publication_failed'}]){const copy=clone(result);mutate(copy);assert.throws(()=>validatePublicReceipt(copy,f.request));}
});
test('compact UI anchor rejects private nested profiles and forged external identities even after full rehash',async t=>{
 const f=await setup(t),p=projectSucceededActive(f);
 for(const mutate of [a=>a.path='/private',a=>a.executionProfile={DATABASE_URL:'PRIVATE'},a=>a.domain={secret:'PRIVATE'},a=>a.backupHash='invalid',a=>a.kind='invented']){
  const copy=clone(p);mutate(copy.active.uiProofAnchor);copy.activeHash=evidenceHash(copy.active);const {projectionHash,...document}=copy;copy.projectionHash=evidenceHash(document);
  assert.throws(()=>validateActiveProjection(copy,{request:f.request,manifest:f.manifest,expectedActive:f.store.active()}));assert.throws(()=>validatePublicActive(copy.active));
 }
 const changed=clone(p);changed.active.uiProofAnchor.backupHash=h('0');changed.activeHash=evidenceHash(changed.active);const {projectionHash,...document}=changed;changed.projectionHash=evidenceHash(document);
 assert.throws(()=>validateActiveProjection(changed,{request:f.request,manifest:f.manifest,expectedActive:f.store.active()}));
 assert.throws(()=>projectSucceededActive({...f,request:{...f.request,sourceCommit:'f'.repeat(40)}}));
 const badProjection=clone(f.projection);badProjection.originalAnchor.backupHash=h('0');
 assert.throws(()=>writeSucceededFrontendReceipt({...f,projection:badProjection,output:path.join(f.root,'refused')}),/anchor differs/);assert.equal(existsSync(path.join(f.root,'refused')),false);
});
