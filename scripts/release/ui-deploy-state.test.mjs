import test from 'node:test';import assert from 'node:assert/strict';import {uiFixture,h} from './ui-release-unit-fixture.mjs';
import {deployFrontend,recoverFrontend,planFrontendDeployment} from './ui-deploy-state.mjs';import {frontendComposition} from './docker-ui-deployment.mjs';
import {evidenceHash,compositionFingerprint,componentInputFingerprint} from './validate-manifest.mjs';import {classifyReleaseVerification} from './ui-release-policy.mjs';
const clone=structuredClone;
function setup(){
  const context=uiFixture(),previous={schemaVersion:1,status:'active',manifest:context.planning.input.previousManifest,instances:Object.fromEntries(Object.keys(context.manifest.components).map(key=>[key,{releaseId:'full-origin',releaseCommit:'a'.repeat(40)}]))};
  let active=clone(previous),running=clone(previous),lock=false,fail=null;const operations=new Map(),calls=[];
  const store={active:()=>clone(active),operation:id=>clone(operations.get(id)??null),pending:()=>[...operations.values()].filter(row=>!['succeeded','rolled_back','failed_before_cutover'].includes(row.status)),writeActive:s=>{assert.equal(lock,true);active=clone(s);},writeOperation:o=>{assert.equal(lock,true);operations.set(o.releaseId,clone(o));},lock:()=>{if(lock)throw Error('locked');lock=true;return()=>{lock=false;};}};
  const observation=state=>({scope:'whole-application',protectedRuntime:clone(context.protectedRunning),files:clone(context.bundle.rehearsalReceipt.filesBefore),databaseBindingHash:h('d'),routingSecurityHash:h('d'),databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted',services:{frontend:{healthy:true,imageDigest:state.manifest.components.frontend.imageDigest}}});
  const adapter={observe:async state=>{assert.equal(lock,true);calls.push('observe');if(running.manifest.releaseId!==state.manifest.releaseId)throw Error('different frontend');const o=observation(state);if(fail==='protected-drift')o.protectedRuntime.backend.containerId='f'.repeat(64);return o;},observeProtected:async state=>{calls.push('protected');const o=observation(state);delete o.services.frontend;if(fail==='protected-drift')o.protectedRuntime.backend.containerId='f'.repeat(64);return o;},prepare:async()=>{calls.push('prepare');if(fail==='prepare')throw Error('pull failed');},replaceFrontend:async state=>{calls.push('frontend:'+state.manifest.releaseId);running=clone(state);if(fail==='replace'){fail=null;throw Error('health failed');}if(fail==='uncertain'){fail=null;throw Object.assign(Error('lost transport'),{uncertainOutcome:true});}}};
  return {store,adapter,context,candidate:context.manifest,bundle:context.bundle,previous,calls,operations,get active(){return active;},set failure(value){fail=value;},get locked(){return lock;}};
}
test('typed operation changes frontend only, preserves backend launch and original anchor, duplicates do no work',async()=>{
  const f=setup(),result=await deployFrontend(f);assert.equal(result.status,'succeeded');assert.deepEqual(result.touched,['frontend']);assert.deepEqual(f.active.instances.backend,f.previous.instances.backend);assert.deepEqual(f.active.instances.rulesWorker,f.previous.instances.rulesWorker);assert.equal(f.active.uiProofAnchor.completedAt,f.context.planning.eligibility.binding.fullAnchor.completedAt);
  assert.equal(f.calls.filter(c=>c==='prepare').length,1);assert.equal(f.calls.filter(c=>c.startsWith('frontend:')).length,1);assert.equal((await deployFrontend(f)).repeated,true);assert.equal(f.calls.filter(c=>c==='prepare').length,1);assert.equal(f.calls.filter(c=>c.startsWith('frontend:')).length,1);assert.equal(f.locked,false);
});
test('failed pull never mutates frontend; failed known cutover restores frontend only',async()=>{
  const prepare=setup();prepare.failure='prepare';await assert.rejects(deployFrontend(prepare),/pull failed/);assert.equal(prepare.operations.get(prepare.candidate.releaseId).status,'failed_before_cutover');assert.equal(prepare.calls.some(c=>c.startsWith('frontend:')),false);
  const f=setup();f.failure='replace';await assert.rejects(deployFrontend(f),/previous frontend restored/);assert.equal(f.operations.get(f.candidate.releaseId).status,'rolled_back');assert.deepEqual(f.calls.filter(c=>c.startsWith('frontend:')),['frontend:ui-new','frontend:full-origin']);assert.deepEqual(f.active,f.previous);
});
test('lost acknowledgement records unknown; explicit recovery observes accepted frontend without resending',async()=>{
  const f=setup();f.failure='uncertain';await assert.rejects(deployFrontend(f),/unknown/);assert.equal(f.operations.get(f.candidate.releaseId).status,'recovery_required');assert.deepEqual(f.active,f.previous);await assert.rejects(deployFrontend(f),/no blind retry/);
  const result=await recoverFrontend({...f,releaseId:f.candidate.releaseId});assert.equal(result.status,'succeeded');assert.equal(f.calls.filter(c=>c.startsWith('frontend:')).length,1);assert.equal(f.locked,false);
});
test('protected drift during preparation refuses both cutover and automatic rollback',async()=>{
  const f=setup();f.adapter.prepare=async()=>{f.failure='protected-drift';};await assert.rejects(deployFrontend(f),/Protected state changed/);assert.equal(f.operations.get(f.candidate.releaseId).status,'recovery_required');assert.equal(f.calls.some(c=>c.startsWith('frontend:')),false);
});
test('wrong current active or unverified mixed OCI proof rejects before adapter preparation',async()=>{
  const f=setup();f.context.bundle.rehearsalReceipt.checks[1].status='failed';await assert.rejects(deployFrontend(f));assert.equal(f.calls.length,0);assert.equal(f.operations.size,0);
  const g=setup();const foreign=clone(g.previous);foreign.manifest.releaseId='foreign';assert.throws(()=>planFrontendDeployment(g.candidate,g.bundle,foreign,g.context),/actual active/);
});
test('composition derivation changes only frontend image plus launch fields, unchanged backend required',()=>{
  const f=setup(),plan=planFrontendDeployment(f.candidate,f.bundle,f.previous,f.context),original={name:'owned',networks:{edge:{driver:'bridge'}},services:{backend:{image:f.previous.manifest.components.backend.imageDigest,environment:{RELEASE_ID:'full-origin',RELEASE_COMMIT:'a'.repeat(40),DATABASE_URL:'private'},volumes:['/exact:/data:ro']},'rules-worker':{image:f.previous.manifest.components.rulesWorker.imageDigest,environment:{RELEASE_ID:'full-origin',RELEASE_COMMIT:'a'.repeat(40)},volumes:['/exact:/artifacts']},frontend:{image:f.previous.manifest.components.frontend.imageDigest,environment:{RELEASE_ID:'full-origin',RELEASE_COMMIT:'a'.repeat(40),PORT:'3000'}},caddy:{image:'unchanged'}}};
  const next=frontendComposition(original,plan.desired);assert.deepEqual(next.services.backend,original.services.backend);assert.deepEqual(next.services['rules-worker'],original.services['rules-worker']);assert.deepEqual(next.services.caddy,original.services.caddy);assert.equal(next.services.frontend.environment.PORT,'3000');assert.equal(next.services.frontend.environment.RELEASE_ID,'ui-new');assert.equal(original.services.frontend.environment.RELEASE_ID,'full-origin');
  plan.desired.instances.backend.releaseId='ui-new';assert.throws(()=>frontendComposition(original,plan.desired),/Protected runtime/);
});

test('full A -> successful UI B -> failed UI C restores exact B frontend and launch, retaining original full A anchor',async()=>{
  const f=setup();await deployFrontend(f);const b=clone(f.active),next=clone(f.context),i=next.planning.input;
  i.previousManifest=clone(b.manifest);i.baselineBinding.sourceCommit=b.manifest.releaseCommit;i.baselineBinding.manifestHash=evidenceHash(b.manifest);i.baselineBinding.runId++;
  i.selection.baseline.sha=b.manifest.releaseCommit;i.selection.candidate.sha='e'.repeat(40);i.candidateManifest={...clone(b.manifest),releaseId:'ui-c',releaseCommit:'e'.repeat(40),previousReleaseId:b.manifest.releaseId};
  i.matrix[0].sourceCommit=i.candidateManifest.releaseCommit;i.matrix[0].sourceFingerprint=h('e');i.matrix[0].inputFingerprint=componentInputFingerprint(i.matrix[0]);
  i.candidateManifest.components.frontend={sourceCommit:i.matrix[0].sourceCommit,inputFingerprint:i.matrix[0].inputFingerprint,imageDigest:'example.test/project/frontend@'+h('e')};i.workerInputs.sourceCommit=i.candidateManifest.releaseCommit;
  next.manifest=i.candidateManifest;next.planning.eligibility=classifyReleaseVerification(i);
  next.ciReport.candidate.sha=next.manifest.releaseCommit;next.ciReport.component_plan.candidate.sha=next.manifest.releaseCommit;next.ciReport.frontend_planning=clone(next.planning);next.ciReport.frontend_verification=clone(next.planning.eligibility);
  next.bundle.images.frontend=next.manifest.components.frontend.imageDigest;Object.assign(next.bundle.identities.frontend,{releaseId:'ui-c',releaseCommit:next.manifest.releaseCommit,sourceCommit:next.manifest.releaseCommit,source_commit:next.manifest.releaseCommit,inputFingerprint:next.manifest.components.frontend.inputFingerprint});
  const receipt=next.bundle.rehearsalReceipt;Object.assign(receipt,{candidateManifestHash:evidenceHash(next.manifest),previousManifestHash:evidenceHash(b.manifest),compositionFingerprint:compositionFingerprint(next.manifest),eligibilityHash:next.planning.eligibility.bindingHash,coreReportHash:evidenceHash(next.ciReport)});
  receipt.history.applicabilityHash=next.planning.eligibility.bindingHash;Object.assign(receipt.checks[0],{images:clone(next.bundle.images),identities:clone(next.bundle.identities)});receipt.checks.find(row=>row.id==='frontend-rollback').previousDigest=b.manifest.components.frontend.imageDigest;
  f.context=next;f.candidate=next.manifest;f.bundle=next.bundle;f.failure='replace';await assert.rejects(deployFrontend(f),/previous frontend restored/);
  assert.deepEqual(f.active,b);assert.deepEqual(f.calls.filter(row=>row.startsWith('frontend:')).slice(-2),['frontend:ui-c','frontend:ui-new']);
  const failed=f.operations.get('ui-c');assert.equal(failed.plan.previous.instances.frontend.releaseId,'ui-new');assert.equal(failed.plan.previous.manifest.components.frontend.imageDigest,b.manifest.components.frontend.imageDigest);
  assert.equal(failed.plan.anchor.manifestHash,evidenceHash(next.originalAnchor.manifest));assert.notEqual(failed.plan.anchor.manifestHash,evidenceHash(b.manifest));assert.deepEqual(failed.plan.desired.instances.backend,b.instances.backend);
});
