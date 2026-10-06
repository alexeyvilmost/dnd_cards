import test from 'node:test';import assert from 'node:assert/strict';
import {safeExecutionEnvironment,validateExecutionProfile} from './ui-execution-profile.mjs';
import {verifyFrontendCIReport,revalidateFrontendCI} from './ui-release-planning.mjs';
import {dispatchVerifiedRelease} from './ui-release-dispatch.mjs';
import {assertDeploymentWorkflow} from './ui-host-release.mjs';
import {assertHostedMixedReport} from './ui-mixed-oci.mjs';
import {playwrightImage} from './docker-ui-rehearsal.mjs';
import {uiFixture,h} from './ui-release-unit-fixture.mjs';import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';
const profile=()=>({schemaVersion:1,...Object.fromEntries(['backend','rulesWorker'].map(component=>[component,{instance:{releaseId:'full-origin',releaseCommit:'a'.repeat(40)},environment:safeExecutionEnvironment(component,[])}]))});
test('public execution profile retains exact policy and bounds; never accepts credentials or ambiguous environment',()=>{
  const p=profile();assert.equal(validateExecutionProfile(p),p);assert.equal(p.backend.environment.RULES_WORKER_MAX_INFLIGHT,'4');
  const safe=safeExecutionEnvironment('backend',['JWT_SECRET=private','DATABASE_URL=private','RULES_CATALOG_BATCH_ENABLED=1']);assert.equal(safe.JWT_SECRET,undefined);assert.equal(safe.DATABASE_URL,undefined);assert.equal(safe.RULES_CATALOG_BATCH_ENABLED,'1');
  assert.throws(()=>safeExecutionEnvironment('backend',['RULES_CATALOG_BATCH_ENABLED=0','RULES_CATALOG_BATCH_ENABLED=1']));
  p.backend.environment.JWT_SECRET='private';assert.throws(()=>validateExecutionProfile(p));delete p.backend.environment.JWT_SECRET;
  p.rulesWorker.environment.RULES_WORKER_MAX_CACHED_ARTIFACTS='0';assert.throws(()=>validateExecutionProfile(p));
});
test('same UI matrix with changed runtime policy cannot reuse old core/planning receipt or publish callback',async()=>{
  const f=uiFixture();f.planning.executionProfile=profile();f.ciReport.frontend_planning=structuredClone(f.planning);
  assert.equal(verifyFrontendCIReport(f.ciReport,{...f.planning,workloadPlan:f.workloadPlan}).frontendBindingHash,f.planning.eligibility.bindingHash);
  const next=structuredClone(f.planning);next.executionProfile.backend.environment.RULES_CATALOG_BATCH_ENABLED='1';
  assert.throws(()=>verifyFrontendCIReport(f.ciReport,{...next,workloadPlan:f.workloadPlan}),/Fresh bound/);
  assert.throws(()=>revalidateFrontendCI(f.ciReport,f.planning,next,f.workloadPlan),/changed/);
  let writes=0;await assert.rejects(dispatchVerifiedRelease({...f,freshPlanning:async()=>next,prepareFrontend:()=>{writes++;}}),/new frontend verification/);assert.equal(writes,0);
});
test('deployment workflow identity is validated before host entry and must be the current trusted attempt',async()=>{
  const workflow={id:9,runAttempt:2,controlCommit:'c'.repeat(40),eventName:'workflow_run'},repository='fixture/project';let reads=0;
  const metadata={id:9,run_attempt:2,head_sha:workflow.controlCommit,path:'.github/workflows/deploy.yml',head_branch:'main',event:'workflow_run',status:'in_progress',conclusion:null,repository:{full_name:repository},head_repository:{full_name:repository}};
  const get=async route=>{reads++;assert.equal(route,'actions/runs/9');return metadata;};
  await assertDeploymentWorkflow({workflow,repository,get});assert.equal(reads,1);
  for(const bad of [{id:0},{runAttempt:NaN},{controlCommit:'bad'},{eventName:'pull_request'}])await assert.rejects(assertDeploymentWorkflow({workflow:{...workflow,...bad},repository,get}),/identity/);
  assert.equal(reads,1);metadata.run_attempt=3;await assert.rejects(assertDeploymentWorkflow({workflow,repository,get}),/trusted/);metadata.run_attempt=2;metadata.head_repository.full_name='foreign/repo';await assert.rejects(assertDeploymentWorkflow({workflow,repository,get}),/trusted/);
});
test('hosted mixed report cannot be local-only, stale attempt, wrong profile or unattested altered result',()=>{
  const f=uiFixture();f.planning.executionProfile=profile();const candidate={manifest:f.manifest,provenance:{planHash:h('b')},frontendVerification:f};
  const proof={kind:'frontend-oci-checks',status:'passed',execution:'docker',scope:'owned-synthetic',authorization:'not-produced',cleanup:{status:'stopped',errors:[]},completedAt:'2026-10-05T00:00:00Z'};
  const run={id:10,runAttempt:2,controlCommit:'c'.repeat(40)},report={schemaVersion:1,kind:'hosted-frontend-mixed-oci',status:'passed',localOnly:false,proof,proofHash:evidenceHash(proof),browserImage:playwrightImage,executionProfileHash:evidenceHash(f.planning.executionProfile),provenance:{releaseRunId:10,runAttempt:2,controlCommit:run.controlCommit,sourceCommit:f.manifest.releaseCommit,candidateManifestHash:evidenceHash(f.manifest),compositionFingerprint:compositionFingerprint(f.manifest),planHash:h('b')}};
  assert.equal(assertHostedMixedReport(report,{candidate,run}),report);
  for(const mutate of [r=>r.localOnly=true,r=>r.provenance.runAttempt=1,r=>r.executionProfileHash=h('e'),r=>r.proof.cleanup.status='failed']){const altered=structuredClone(report);mutate(altered);assert.throws(()=>assertHostedMixedReport(altered,{candidate,run}),/hosted mixed/);}
});
