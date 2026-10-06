import test from 'node:test';import assert from 'node:assert/strict';
import {classifyReleaseVerification,assertFrontendEligibility,runtimeCompatibilityHash,uiPathKind,candidateWriterPolicyFields} from './ui-release-policy.mjs';
import {uiFixture,h} from './ui-release-unit-fixture.mjs';
import {evidenceHash,componentInputFingerprint} from './validate-manifest.mjs';
import {selectCISuite} from '../testing/ci-policy.mjs';
import {suiteWorkload} from '../testing/workload.mjs';
import {verifyFrontendCIReport,revalidateFrontendCI} from './ui-release-planning.mjs';

test('pure presentation keeps full domain and adds entire adjacent UI test corpus to existing core',()=>{
  const f=uiFixture();assert.equal(f.planning.eligibility.kind,'frontend-only');
  assert.deepEqual(f.planning.eligibility.binding.affectedTests,['frontend/src/components/Button.test.tsx','frontend/src/components/Dialog.test.tsx']);
  assert.equal(selectCISuite({candidate:{sha:f.manifest.releaseCommit}},{eventName:'push',frontendPlanning:f.planning}),'core');
  assert.equal(selectCISuite({candidate:{sha:f.manifest.releaseCommit}},{eventName:'push'}),'extended');
  assert.equal(f.workload.scripts[0].id,'local-api-spine');assert.equal(f.workload.browserGroups[0].id,'local-browser-flows');
  verifyFrontendCIReport(f.ciReport,{...f.planning,workloadPlan:f.workloadPlan});
});
test('accumulated backend commit cannot be hidden by a later UI push or before/head diff',()=>{
  for(const mutate of [i=>{i.selection.changed_files.unshift('backend/main.go');},i=>{i.selection.baseline.sha='e'.repeat(40);},i=>{i.selection.mode='ci';},i=>{i.selection.full_fallback=true;},i=>{i.selection.components.worker=true;}]){
    const f=uiFixture();mutate(f.planning.input);assert.equal(classifyReleaseVerification(f.planning.input).kind,'full');
  }
});
test('API/auth/persistence/runtime/build/dependencies/tooling/shared tests and unknown paths require full',()=>{
  for(const file of ['frontend/src/api/client.ts','frontend/src/components/Login.tsx','frontend/src/hooks/useCombatCommandDispatch.ts','frontend/src/components/model.ts','frontend/src/rules/roll.ts','frontend/vite.config.ts','frontend/package-lock.json','frontend/e2e-local/combat.spec.ts','scripts/testing/manifest.json','infra/nginx.conf','odd/unknown','frontend/src/pages/../api/client.ts']){
    const f=uiFixture();f.planning.input.selection.changed_files=[file];assert.equal(classifyReleaseVerification(f.planning.input).kind,'full',file);
  }
  assert.equal(uiPathKind('frontend/src/hooks/useReducedMotion.ts'),'presentation');
});
test('worker closure wins over presentation path and must bind current source/artifact',()=>{
  for(const mutate of [i=>i.workerInputs.paths.push(i.selection.changed_files[0]),i=>{i.workerInputs.sourceCommit='d'.repeat(40);},i=>{i.workerInputs.artifactHash=h('0');},i=>{i.workerInputs.paths=[];}]){
    const f=uiFixture();mutate(f.planning.input);assert.equal(classifyReleaseVerification(f.planning.input).kind,'full');
  }
});
test('unchanged source names cannot conceal rebuilt component or config/schema/content/runtime drift',()=>{
  for(const mutate of [i=>{i.matrix[1].operation='build';},i=>{i.candidateManifest.components.backend.sourceCommit='e'.repeat(40);},i=>{i.candidateManifest.contentManifestHash=h('1');},i=>{i.candidateManifest.workerRuntime.version='24.22.0';},i=>{i.candidateManifest.migrationSet=[{id:'300',checksum:h('1')}];},i=>{i.candidateDomain.databaseBindingHash=h('1');},i=>{i.candidateDomain.frontendBuildContractHash=h('1');},i=>{i.candidateDomain.frontendReadersHash=h('1');},i=>{i.candidateDomain.routingSecurityHash=h('1');}]){
    const f=uiFixture();mutate(f.planning.input);assert.equal(classifyReleaseVerification(f.planning.input).kind,'full');
  }
  const f=uiFixture();f.planning.input.matrix[1].inputFingerprint=h('a');assert.throws(()=>classifyReleaseVerification(f.planning.input),/fingerprint/);
});
test('missing observations select full but corrupted supplied proofs reject',()=>{
  assert.equal(classifyReleaseVerification().kind,'full');
  const f=uiFixture();delete f.planning.input.fullAnchor;assert.equal(classifyReleaseVerification(f.planning.input).kind,'full');
  for(const mutate of [i=>{i.baselineBinding.runAttempt=0;},i=>{i.baselineBinding.manifestHash=h('0');},i=>{i.fullAnchor.kind='reused-anchor';},i=>{i.fullAnchor.completedAt='tomorrow';}]){
    const f=uiFixture();mutate(f.planning.input);assert.throws(()=>classifyReleaseVerification(f.planning.input));
  }
});
test('docs/tests-only exact component inputs produce no deployment and do not advance baseline',()=>{
  for(const file of ['docs/new.md','frontend/src/components/Button.test.tsx']){
    const f=uiFixture(),i=f.planning.input,old=i.previousManifest.components.frontend;
    i.selection.changed_files=[file];i.matrix[0].sourceFingerprint=h('2');i.matrix[0].inputFingerprint=componentInputFingerprint(i.matrix[0]);
    assert.equal(i.matrix[0].inputFingerprint,old.inputFingerprint);i.candidateManifest.components.frontend.inputFingerprint=old.inputFingerprint;
    const before=evidenceHash(i.baselineBinding);assert.equal(classifyReleaseVerification(i).kind,'no-deployment-needed');assert.equal(evidenceHash(i.baselineBinding),before);
    const withoutRecovery={...i};delete withoutRecovery.fullAnchor;delete withoutRecovery.workerInputs;delete withoutRecovery.testCatalog;
    assert.equal(classifyReleaseVerification(withoutRecovery).kind,'no-deployment-needed');
    i.matrix[0].sourceFingerprint=h('a');i.matrix[0].inputFingerprint=componentInputFingerprint(i.matrix[0]);i.candidateManifest.components.frontend.inputFingerprint=i.matrix[0].inputFingerprint;
    assert.notEqual(classifyReleaseVerification(i).kind,'no-deployment-needed');
  }
});
test('no test selection, stale baseline attempt, or forged core coverage cannot authorize UI release',()=>{
  const f=uiFixture();f.planning.input.testCatalog=[];assert.equal(classifyReleaseVerification(f.planning.input).kind,'full');
  for(const mutate of [r=>{delete r.frontend_verification;},r=>{r.frontend_verification.binding.baseline.runAttempt++;},r=>{r.aggregation.global_coverage_complete=false;},r=>{r.checks=r.checks.filter(x=>x.id!=='local-browser-flows');},r=>{r.aggregation.plan_sha256='changed';},r=>{r.shard={};}]){
    const f=uiFixture();mutate(f.ciReport);assert.throws(()=>verifyFrontendCIReport(f.ciReport,{...f.planning,workloadPlan:f.workloadPlan}));
  }
  const g=uiFixture(),fresh=structuredClone(g.planning);fresh.input.baselineBinding.runAttempt++;fresh.eligibility=classifyReleaseVerification(fresh.input);
  assert.throws(()=>revalidateFrontendCI(g.ciReport,g.planning,fresh,g.workloadPlan),/new verification/);
});
test('workload refuses dropping real E2E or unregistered affected UI tests',()=>{
  const f=uiFixture();assert.throws(()=>suiteWorkload({selection:{selected:[]},catalog:f.catalog,manifest:{},suite:'core',frontendPlanning:f.planning}),/real API/);
  assert.throws(()=>suiteWorkload({selection:f.selectionGroups,catalog:[],manifest:{},suite:'core',frontendPlanning:f.planning}),/mandatory catalog/);
  const changed=structuredClone(f.planning.eligibility);changed.binding.affectedTests.pop();changed.bindingHash=evidenceHash(changed.binding);
  assert.throws(()=>assertFrontendEligibility(changed,f.planning.input),/substituted/);
});
test('runtime hash excludes frontend release identity but preserves original evidence timestamps',()=>{
  const f=uiFixture(),i=f.planning.input;assert.equal(runtimeCompatibilityHash(i.previousManifest,i.previousDomain),runtimeCompatibilityHash(i.candidateManifest,i.candidateDomain));
  assert.equal(i.fullAnchor.completedAt,'2026-01-01T00:00:00.000Z');assert.notEqual(i.fullAnchor.completedAt,f.manifest.createdAt);
});

test('manual frontend build arguments or base image changes cannot reuse an unrelated protected build contract',()=>{
  for(const mutate of [row=>{row.buildArguments.VITE_API_URL='https://other.invalid';},row=>{row.baseImages.NGINX_IMAGE='example.test/nginx@'+h('f');}]){
    const f=uiFixture(),i=f.planning.input;mutate(i.matrix[0]);i.matrix[0].inputFingerprint=componentInputFingerprint(i.matrix[0]);i.candidateManifest.components.frontend.inputFingerprint=i.matrix[0].inputFingerprint;
    assert.equal(classifyReleaseVerification(i).kind,'full');
  }
});
test('second UI release points directly to original full anchor, without reuse-of-reuse metadata',()=>{
  const f=uiFixture(),i=f.planning.input,anchor=structuredClone(i.fullAnchor),previous=structuredClone(f.manifest);
  i.previousManifest=previous;i.baselineBinding.sourceCommit=previous.releaseCommit;i.baselineBinding.manifestHash=evidenceHash(previous);i.baselineBinding.runId++;
  i.selection.baseline.sha=previous.releaseCommit;i.selection.candidate.sha='e'.repeat(40);i.candidateManifest={...structuredClone(previous),releaseId:'ui-next',releaseCommit:'e'.repeat(40),previousReleaseId:previous.releaseId};
  i.matrix[0].sourceCommit=i.candidateManifest.releaseCommit;i.matrix[0].sourceFingerprint=h('e');i.matrix[0].inputFingerprint=componentInputFingerprint(i.matrix[0]);
  i.candidateManifest.components.frontend={...previous.components.frontend,sourceCommit:i.matrix[0].sourceCommit,inputFingerprint:i.matrix[0].inputFingerprint};
  i.workerInputs.sourceCommit=i.candidateManifest.releaseCommit;
  const result=classifyReleaseVerification(i);assert.equal(result.kind,'frontend-only');assert.deepEqual(result.binding.fullAnchor,anchor);assert.notEqual(result.binding.previousManifestHash,anchor.manifestHash);
});
test('future writer-policy integration projects actual configured OFF/ON, never inherited enabled writers',()=>{
  const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false},on={...off,compactReceipts:true};
  assert.deepEqual(candidateWriterPolicyFields({},{}),{});
  assert.deepEqual(candidateWriterPolicyFields({writerPolicy:on},{}),{writerPolicy:off});
  assert.deepEqual(candidateWriterPolicyFields({writerPolicy:off},{writerPolicy:on}),{writerPolicy:on});
  assert.throws(()=>candidateWriterPolicyFields({},{writerPolicy:{...on,frozenCatalogs:true}}));
});
