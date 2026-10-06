import test from 'node:test';import assert from 'node:assert/strict';import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';import path from 'node:path';
import {readDeployedUIBaseline,prepareFrontendVerification} from './ui-release-planning.mjs';
import {assembleCandidateManifest,calculateBuildMatrix,validateBuildPlan} from './ci-release.mjs';
import {runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {uiFixture} from './ui-release-unit-fixture.mjs';
import {fixture,recordsFor,publishedFor} from './ui-planning-unit-fixture.mjs';

function metadata(manifest){
  const control='c'.repeat(40),repository='fixture/project';
  const receipt={schemaVersion:1,status:'succeeded',releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit,controlCommit:control,manifestHash:evidenceHash(manifest)};
  const run={id:71,run_attempt:2,path:'.github/workflows/deploy.yml',head_sha:control,head_branch:'main',event:'workflow_run',status:'completed',conclusion:'success',repository:{full_name:repository},head_repository:{full_name:repository}};
  const job={id:711,run_id:71,run_attempt:2,head_sha:control,name:'deploy',status:'completed',conclusion:'success',started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:10:00Z'};
  const artifact={id:712,name:'deployed-release',expired:false,size_in_bytes:2048,created_at:'2026-01-01T00:09:00Z',expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:71,head_sha:control}};
  const get=async route=>{const url=new URL(route,'https://fixture.invalid/');
    if(url.pathname==='/actions/workflows/deploy.yml/runs')return {total_count:1,workflow_runs:[structuredClone(run)]};
    if(url.pathname==='/actions/runs/71/jobs')return {total_count:1,jobs:[structuredClone(job)]};
    if(url.pathname==='/actions/runs/71/artifacts')return {total_count:1,artifacts:[structuredClone(artifact)]};
    if(url.pathname==='/actions/runs/71')return structuredClone(run);throw Error(`Unexpected route ${route}`);};
  return {run,job,artifact,get,receipt,repository,readArtifact:async id=>{assert.equal(id,artifact.id);return {manifest,receipt};}};
}
test('baseline reads exact executed-deploy artifact and rechecks rerun attempt after download',async()=>{
  const f=uiFixture(),m=metadata(f.planning.input.previousManifest);
  const got=await readDeployedUIBaseline(m.get,m);assert.equal(got.binding.runAttempt,2);assert.equal(got.binding.artifactId,712);assert.equal(got.binding.sourceCommit,f.planning.input.previousManifest.releaseCommit);
  m.readArtifact=async()=>{m.run.run_attempt++;m.job.run_attempt++;return {manifest:f.planning.input.previousManifest,receipt:m.receipt};};
  await assert.rejects(readDeployedUIBaseline(m.get,m),/changed while/);
});
test('skipped deploy is not a baseline; corrupt or expired actual latest artifact is a hard error',async()=>{
  const f=uiFixture(),m=metadata(f.planning.input.previousManifest);m.job.conclusion='skipped';assert.equal(await readDeployedUIBaseline(m.get,m),null);
  m.job.conclusion='success';m.artifact.expired=true;await assert.rejects(readDeployedUIBaseline(m.get,m));
  m.artifact.expired=false;m.receipt.manifestHash='wrong';await assert.rejects(readDeployedUIBaseline(m.get,m),/attested/);
});
test('actual clean Git accumulated plan and build matrix share canonical producer; API/base pin drift is full',async t=>{
  const f=fixture(t),first=f.plan(f.candidate),old=assembleCandidateManifest(first,recordsFor(first),publishedFor(first)).manifest;
  const m=metadata(old),baseline=await readDeployedUIBaseline(m.get,m),baselineFile=path.join(f.directory,'baseline.json');writeFileSync(baselineFile,JSON.stringify(old));
  const unit=uiFixture(),domain=unit.planning.input.previousDomain;
  const frontend=first.matrix.find(row=>row.component==='frontend');domain.frontendBuildContractHash=evidenceHash({baseImages:frontend.baseImages,buildArguments:frontend.buildArguments,platform:frontend.platform});
  const fullAnchor={...unit.planning.input.fullAnchor,manifestHash:evidenceHash(old),runtimeCompatibilityHash:runtimeCompatibilityHash(old,domain)};
  mkdirSync(path.join(f.repo,'frontend/src/components'));writeFileSync(path.join(f.repo,'frontend/src/components/Button.tsx'),'export const Button=()=>null;\n');writeFileSync(path.join(f.repo,'frontend/src/components/Button.test.tsx'),'// adjacent test\n');
  let candidate=f.commit();
  const options=()=>({repo:f.repo,candidate,repository:m.repository,config:{...first.config,contentManifestHash:evidenceHash(JSON.parse(readFileSync(path.join(f.repo,'infra/release-content-manifest.json'),'utf8')))},baseline,baselineFile,fullAnchor,previousDomain:domain,candidateDomain:domain,
    workerInputs:{sourceCommit:candidate,artifactHash:old.rulesArtifactHash,paths:['frontend/worker/server.mjs']},testCatalog:['frontend/src/components/Button.test.tsx']});
  const selected=prepareFrontendVerification(options());assert.equal(selected.eligibility.kind,'frontend-only');
  assert.deepEqual(selected.input.matrix,calculateBuildMatrix({repo:f.repo,candidate,repository:m.repository,config:first.config,selection:selected.input.selection,baseline:old}));
  assert.deepEqual(Object.fromEntries(selected.input.matrix.map(row=>[row.component,row.operation])),{frontend:'build',backend:'reuse',rulesWorker:'reuse'});
  const core=structuredClone(unit.ciReport);core.candidate.sha=candidate;core.component_plan.candidate.sha=candidate;core.frontend_planning=selected;core.frontend_verification=selected.eligibility;
  const verification={planning:selected,ciReport:core,workloadPlan:unit.workloadPlan};
  const built=f.plan(candidate,{baseline:old,baselineReceipt:m.receipt,baselineRun:{controlCommit:baseline.binding.controlCommit},baselineFile,suiteReport:core,frontendVerification:verification});
  assert.equal(validateBuildPlan(built),built);const published=assembleCandidateManifest(built,recordsFor(built),publishedFor(built));assert.deepEqual(published.frontendVerification,verification);assert.equal(published.buildPlan.planHash,built.planHash);
  assert.equal(Object.hasOwn(published.manifest,'writerPolicy'),Object.hasOwn(selected.input.candidateManifest,'writerPolicy'));
  assert.deepEqual(published.manifest.writerPolicy,selected.input.candidateManifest.writerPolicy);
  const introduced=options();introduced.config={...introduced.config,writerPolicy:{compactReceipts:false,imageJobs:false,frozenCatalogs:false}};
  assert.equal(prepareFrontendVerification(introduced).eligibility.kind,'full');
  assert.throws(()=>f.plan(candidate,{config:introduced.config,baseline:old,baselineReceipt:m.receipt,baselineRun:{controlCommit:baseline.binding.controlCommit},baselineFile,suiteReport:core,frontendVerification:verification}),/extended/);
  const changedProof=structuredClone(built);changedProof.frontendVerification.ciReport.frontend_planning.input.baselineBinding.runAttempt++;
  assert.throws(()=>validateBuildPlan(changedProof),/hash mismatch/);
  const altered=options();altered.config={...first.config,baseImages:{...first.config.baseImages,GO_IMAGE:'example.test/go@sha256:'+'e'.repeat(64)}};
  assert.equal(prepareFrontendVerification(altered).eligibility.kind,'full');
  writeFileSync(path.join(f.repo,'backend/main.go'),'package main\nfunc main(){println("new backend")}\n');f.commit();
  writeFileSync(path.join(f.repo,'frontend/src/components/Button.tsx'),'export const Button=()=>"latest push is only UI";\n');candidate=f.commit();
  const accumulated=prepareFrontendVerification(options());assert.ok(accumulated.input.selection.changed_files.includes('backend/main.go'));assert.equal(accumulated.eligibility.kind,'full');
});
